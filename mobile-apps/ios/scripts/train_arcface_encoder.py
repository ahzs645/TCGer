#!/usr/bin/env python3
"""ArcFace student encoder for TCGer — headless Colab CLI variant.

Same recipe as train-arcface-encoder-colab.ipynb (TCG-AR: one class per
catalog card, ArcFace s=30 m=0.5, synthetic views; FastViT-T8 student, 384-d,
iOS preprocessing contract), but with zero Drive/browser dependencies so it
runs under `colab exec`/`colab run`:

- catalog metadata is read from /content/CardsIndexMetadata.json
  (push it first: `colab upload -s <name> CardsIndexMetadata.json /content/`)
- card images download from each entry's imageURL into /content/card-images
  (resumable; skips files already cached)
- everything the Mac needs lands in /content/outputs:
    arcface-checkpoint.pt        (resumable, per epoch)
    status.json                  (cheap to poll with `colab download`)
    CardEmbeddings-arcface.mlpackage.zip
    CardsIndexVectors-arcface.bin
    arcface-eval.json

Run remotely:
    colab new -s tcger-arcface --gpu L4
    colab install -s tcger-arcface torch torchvision timm coremltools pillow numpy
    colab upload -s tcger-arcface CardsIndexMetadata.json /content/
    colab exec -s tcger-arcface -f train_arcface_encoder.py
    colab download -s tcger-arcface /content/outputs/CardEmbeddings-arcface.mlpackage.zip .
    colab download -s tcger-arcface /content/outputs/CardsIndexVectors-arcface.bin .
    colab stop -s tcger-arcface
"""
import argparse
import concurrent.futures as cf
import json
import math
import os
import random
import shutil
import struct
import time
import urllib.request
from pathlib import Path

META_PATH = "/content/CardsIndexMetadata.json"
CACHE_DIR = Path("/content/card-images")
OUT_DIR = Path("/content/outputs")
CKPT = OUT_DIR / "arcface-checkpoint.pt"
STATUS = OUT_DIR / "status.json"

IMNET_MEAN = [0.485, 0.456, 0.406]
IMNET_STD = [0.229, 0.224, 0.225]
IMG_SIZE = 224
EMBED_DIM = 384
ARC_S, ARC_M = 16.0, 0.50  # s=16: s=30 with AdamW saturates and never lifts off (measured)
SEED = 22


def write_status(**kwargs):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **kwargs}
    tmp = STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=1))
    os.replace(tmp, STATUS)
    print(f"[status] {payload}", flush=True)


def load_entries():
    entries = json.load(open(META_PATH))
    entries.sort(key=lambda e: e["annIndex"])
    for i, e in enumerate(entries):
        assert e["annIndex"] == i, "annIndex order must be contiguous"
    return entries


def cached_path(i: int) -> Path:
    return CACHE_DIR / f"{i:05d}.img"


def materialize_images(entries, workers=24):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def fetch(i_entry):
        i, e = i_entry
        dst = cached_path(i)
        if dst.exists() and dst.stat().st_size > 0:
            return None
        url = e.get("imageURL")
        if not url:
            return i
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "TCGer-trainer"})
                with urllib.request.urlopen(req, timeout=30) as r, open(dst, "wb") as f:
                    shutil.copyfileobj(r, f)
                return None
            except Exception:
                time.sleep(1 + attempt)
        return i

    done = 0
    missing = []
    with cf.ThreadPoolExecutor(workers) as ex:
        for result in ex.map(fetch, enumerate(entries)):
            done += 1
            if result is not None:
                missing.append(result)
            if done % 2000 == 0:
                write_status(phase="caching-images", cached=done, total=len(entries),
                             missing=len(missing))
    write_status(phase="images-ready", total=len(entries), missing=len(missing))
    assert len(missing) < len(entries) * 0.02, f"too many missing images: {len(missing)}"
    return [i for i in range(len(entries)) if i not in set(missing)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--views-per-card", type=int, default=3)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--backbone", default="fastvit_t8.apple_in1k")
    parser.add_argument("--workers", type=int, default=8)
    # parse_known_args: under `colab exec` the code runs in a Jupyter kernel
    # whose sys.argv carries kernel flags that argparse must not choke on.
    args, _ = parser.parse_known_args()

    import numpy as np
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    import timm
    import torchvision.transforms as T
    import torchvision.transforms.functional as TF
    from PIL import Image, ImageEnhance, ImageFilter
    from torch.utils.data import Dataset, DataLoader

    assert torch.cuda.is_available(), "needs a GPU runtime (colab new --gpu L4/T4)"
    device = "cuda"
    torch.manual_seed(SEED)
    random.seed(SEED)
    np.random.seed(SEED)
    print("GPU:", torch.cuda.get_device_name(0), flush=True)

    entries = load_entries()
    valid = materialize_images(entries)

    def contract_resize(img):
        # Mirrors CardEmbeddingEncoder.swift: shortest edge >= 256 (both sides
        # cover 224), bicubic with ceil, center-crop 224.
        w, h = img.size
        s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
        rw, rh = math.ceil(w * s), math.ceil(h * s)
        img = img.resize((rw, rh), Image.BICUBIC)
        left, top = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
        return img.crop((left, top, left + IMG_SIZE, top + IMG_SIZE))

    class CardViews(Dataset):
        def __init__(self, indices, train=True):
            self.indices = indices
            self.train = train

        def __len__(self):
            return len(self.indices) * (args.views_per_card if self.train else 1)

        def __getitem__(self, k):
            i = self.indices[k % len(self.indices)]
            img = Image.open(cached_path(i)).convert("RGB")
            if self.train:
                if random.random() < 0.85:
                    img = T.RandomPerspective(distortion_scale=0.35, p=1.0,
                                              fill=random.randint(0, 255))(img)
                if random.random() < 0.8:
                    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.55, 1.45))
                    img = ImageEnhance.Color(img).enhance(random.uniform(0.6, 1.4))
                    img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
                if random.random() < 0.5:
                    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 2.2)))
                elif random.random() < 0.3:
                    img = ImageEnhance.Sharpness(img).enhance(random.uniform(1.2, 2.5))
            x = TF.to_tensor(contract_resize(img))
            if self.train and random.random() < 0.5:
                x = (x + torch.randn_like(x) * random.uniform(0.005, 0.03)).clamp(0, 1)
            return TF.normalize(x, IMNET_MEAN, IMNET_STD), i

    class Encoder(nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = timm.create_model(args.backbone, pretrained=True, num_classes=0)
            self.proj = nn.Linear(self.backbone.num_features, EMBED_DIM)

        def forward(self, x):
            return F.normalize(self.proj(self.backbone(x)), dim=-1)

    class ArcFace(nn.Module):
        # Margin warm-up: m=0.5 from step zero on a randomly-initialized head
        # over 21.8k classes measurably fails to train (epoch-3 loss pinned at
        # ln(N) ≈ 10.0, chance-level accuracy — observed 2026-08-23). Start as
        # plain scaled softmax and ramp the margin in; the epoch loop sets
        # `margin` each epoch.
        def __init__(self, classes):
            super().__init__()
            self.w = nn.Parameter(torch.empty(classes, EMBED_DIM))
            nn.init.xavier_uniform_(self.w)
            self.margin = 0.0

        def forward(self, emb, labels):
            cos = emb @ F.normalize(self.w, dim=-1).t()
            if self.margin <= 0:
                return ARC_S * cos  # plain scaled softmax
            theta = torch.acos(cos.clamp(-1 + 1e-7, 1 - 1e-7))
            target = torch.cos(theta + self.margin)
            onehot = F.one_hot(labels, self.w.shape[0]).to(cos.dtype)
            return ARC_S * (onehot * target + (1 - onehot) * cos)

    model, head = Encoder().to(device), ArcFace(len(entries)).to(device)
    # The head must organize 21.8k class vectors from scratch while the
    # pretrained backbone only fine-tunes; a memorization probe showed the
    # head organizes quickly given adequate step size. 3x LR on proj+head
    # (10x measured to thrash at full scale).
    opt = torch.optim.AdamW([
        {"params": model.backbone.parameters(), "lr": args.lr},
        {"params": model.proj.parameters(), "lr": args.lr * 3},
        {"params": head.parameters(), "lr": args.lr * 3},
    ], weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)
    scaler = torch.amp.GradScaler()
    start_epoch = 0
    if CKPT.exists():
        ck = torch.load(CKPT, map_location=device)
        model.load_state_dict(ck["model"])
        head.load_state_dict(ck["head"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        start_epoch = ck["epoch"] + 1
        print(f"resumed after epoch {ck['epoch']}", flush=True)

    loader = DataLoader(CardViews(valid, train=True), batch_size=args.batch, shuffle=True,
                        num_workers=args.workers, pin_memory=True, drop_last=True,
                        persistent_workers=True)

    for epoch in range(start_epoch, args.epochs):
        # Margin ramp: margin-free through epoch 3 — at 21.8k classes the head
        # needs ~300+ plain-softmax steps before liftoff (measured; a ramp
        # starting at epoch 1 froze training at chance) — then linear to the
        # full ArcFace margin over epochs 4-8.
        head.margin = ARC_M * min(1.0, max(0.0, (epoch - 3) / 5.0))
        model.train(); head.train()
        t0, seen, loss_sum, correct = time.time(), 0, 0.0, 0
        window_loss, window_correct, window_seen, step = 0.0, 0, 0, 0
        for x, y in loader:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda"):
                logits = head(model(x), y)
                loss = F.cross_entropy(logits, y)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            seen += y.numel()
            loss_sum += loss.item() * y.numel()
            correct += (logits.argmax(1) == y).sum().item()
            window_seen += y.numel()
            window_loss += loss.item() * y.numel()
            window_correct += (logits.argmax(1) == y).sum().item()
            step += 1
            if step % 100 == 0:
                # Step-level visibility: epoch averages hid whether the model
                # was lifting off or sitting flat at chance.
                write_status(phase="training-step", epoch=epoch, step=step,
                             window_loss=round(window_loss / window_seen, 3),
                             window_acc=round(window_correct / window_seen, 4),
                             margin=round(head.margin, 3))
                window_loss, window_correct, window_seen = 0.0, 0, 0
        sched.step()
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        torch.save({"model": model.state_dict(), "head": head.state_dict(),
                    "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "epoch": epoch,
                    "config": {"backbone": args.backbone, "dim": EMBED_DIM}}, CKPT)
        write_status(phase="training", epoch=epoch, epochs=args.epochs,
                     loss=round(loss_sum / seen, 4), train_acc=round(correct / seen, 4),
                     margin=round(head.margin, 3),
                     minutes=round((time.time() - t0) / 60, 1))

    # ---- Eval: catalog self-retrieval -------------------------------------
    @torch.no_grad()
    def embed_all(ds, bs=512):
        model.eval()
        out = torch.empty(len(ds), EMBED_DIM)
        row = 0
        for x, _ in DataLoader(ds, batch_size=bs, num_workers=args.workers):
            e = model(x.to(device))
            out[row:row + len(e)] = e.cpu()
            row += len(e)
        return out

    gallery = embed_all(CardViews(valid, train=False))
    queries = embed_all(CardViews(valid, train=True))
    qlabels = torch.tensor([valid[k % len(valid)]
                            for k in range(len(valid) * args.views_per_card)])
    glabels = torch.tensor(valid)
    sims = queries @ gallery.t()
    top = sims.topk(5, dim=1).indices
    hits = glabels[top] == qlabels[:, None]
    student = {f"recall@{k}": hits[:, :k].any(1).float().mean().item() for k in (1, 5)}
    json.dump({"student": student, "epochs": args.epochs, "backbone": args.backbone},
              open(OUT_DIR / "arcface-eval.json", "w"), indent=1)
    write_status(phase="evaluated", **{k: round(v, 4) for k, v in student.items()})

    # ---- Export: Core ML + int8 index -------------------------------------
    import coremltools as ct

    class Deploy(nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
            self.register_buffer("mean", torch.tensor(IMNET_MEAN).view(1, 3, 1, 1))
            self.register_buffer("std", torch.tensor(IMNET_STD).view(1, 3, 1, 1))

        def forward(self, x):
            return self.m((x - self.mean) / self.std)

    deploy = Deploy(model.float().cpu()).eval()
    example = torch.rand(1, 3, IMG_SIZE, IMG_SIZE)
    traced = torch.jit.trace(deploy, example)
    ml = ct.convert(
        traced,
        convert_to="mlprogram",
        minimum_deployment_target=ct.target.iOS18,
        compute_units=ct.ComputeUnit.ALL,
        inputs=[ct.ImageType(name="image", shape=example.shape, scale=1 / 255.0,
                             color_layout=ct.colorlayout.RGB)],
        outputs=[ct.TensorType(name="embedding")],
    )
    ml.save("/content/CardEmbeddings-arcface.mlpackage")
    shutil.make_archive(str(OUT_DIR / "CardEmbeddings-arcface.mlpackage"), "zip",
                        "/content", "CardEmbeddings-arcface.mlpackage")

    import torch.nn.functional as F2  # noqa: F401  (quantize below is torch-only)
    full = torch.zeros(len(entries), EMBED_DIM)
    full[torch.tensor(valid)] = gallery
    q = torch.clamp(torch.round(full * 127), -127, 127).to(torch.int8).numpy()
    with open(OUT_DIR / "CardsIndexVectors-arcface.bin", "wb") as f:
        f.write(struct.pack("<ii", len(entries), EMBED_DIM))
        f.write(q.tobytes())
    write_status(phase="done", outputs=sorted(p.name for p in OUT_DIR.iterdir()))


if __name__ == "__main__":
    main()
