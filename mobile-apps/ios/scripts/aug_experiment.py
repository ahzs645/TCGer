"""Isolate the blocker: augmentation severity vs class count.
2,000 classes, 200 steps, head LR 3x, margin 0. Config E = mild augs,
config F = the full run's heavy augs. If E lifts off and F doesn't, the
augs are the blocker and the fix is an aug curriculum, not the optimizer.
"""
import json, math, random, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import timm
import torchvision.transforms as T
import torchvision.transforms.functional as TF
from PIL import Image, ImageEnhance, ImageFilter
from torch.utils.data import Dataset, DataLoader
from pathlib import Path

IMNET_MEAN = [0.485, 0.456, 0.406]; IMNET_STD = [0.229, 0.224, 0.225]
IMG_SIZE = 224; EMBED_DIM = 384
CACHE = Path("/content/card-images")

entries = json.load(open("/content/CardsIndexMetadata.json"))
valid = [e["annIndex"] for e in entries[:2100]
         if (CACHE / f"{e['annIndex']:05d}.img").exists()][:2000]
label_of = {ann: k for k, ann in enumerate(valid)}
print("classes:", len(valid), flush=True)

def contract_resize(img):
    w, h = img.size
    s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
    rw, rh = math.ceil(w * s), math.ceil(h * s)
    img = img.resize((rw, rh), Image.BICUBIC)
    l, t = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
    return img.crop((l, t, l + IMG_SIZE, t + IMG_SIZE))

class Views(Dataset):
    def __init__(self, heavy):
        self.heavy = heavy
    def __len__(self): return len(valid) * 30   # effectively infinite for 200 steps
    def __getitem__(self, k):
        ann = valid[k % len(valid)]
        img = Image.open(CACHE / f"{ann:05d}.img").convert("RGB")
        if self.heavy:
            if random.random() < 0.85:
                img = T.RandomPerspective(0.35, p=1.0, fill=random.randint(0, 255))(img)
            if random.random() < 0.8:
                img = ImageEnhance.Brightness(img).enhance(random.uniform(0.55, 1.45))
                img = ImageEnhance.Color(img).enhance(random.uniform(0.6, 1.4))
                img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
            if random.random() < 0.5:
                img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 2.2)))
        else:
            if random.random() < 0.5:
                img = T.RandomPerspective(0.12, p=1.0, fill=128)(img)
            if random.random() < 0.5:
                img = ImageEnhance.Brightness(img).enhance(random.uniform(0.85, 1.15))
        x = TF.to_tensor(contract_resize(img))
        if self.heavy and random.random() < 0.5:
            x = (x + torch.randn_like(x) * random.uniform(0.005, 0.03)).clamp(0, 1)
        return TF.normalize(x, IMNET_MEAN, IMNET_STD), label_of[ann]

def run(name, heavy, steps=200):
    torch.manual_seed(22); random.seed(22); np.random.seed(22)
    backbone = timm.create_model("fastvit_t8.apple_in1k", pretrained=True, num_classes=0).cuda()
    proj = nn.Linear(backbone.num_features, EMBED_DIM).cuda()
    w = nn.Parameter(torch.empty(len(valid), EMBED_DIM).cuda())
    nn.init.xavier_uniform_(w)
    opt = torch.optim.AdamW([
        {"params": backbone.parameters(), "lr": 3e-4},
        {"params": proj.parameters(), "lr": 9e-4},
        {"params": [w], "lr": 9e-4},
    ], weight_decay=1e-4)
    scaler = torch.amp.GradScaler()
    loader = DataLoader(Views(heavy), batch_size=256, shuffle=True, num_workers=8,
                        pin_memory=True, drop_last=True)
    backbone.train()
    step = 0
    for x, y in loader:
        if step >= steps: break
        x, y = x.cuda(non_blocking=True), y.cuda(non_blocking=True)
        opt.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda"):
            emb = F.normalize(proj(backbone(x)), dim=-1)
            logits = 16.0 * (emb @ F.normalize(w, dim=-1).t())
            loss = F.cross_entropy(logits, y)
        scaler.scale(loss).backward()
        scaler.step(opt)
        scaler.update()
        if step % 25 == 0 or step == steps - 1:
            acc = (logits.argmax(1) == y).float().mean().item()
            print(f"[{name}] step {step} loss {loss.item():.3f} acc {acc:.4f}", flush=True)
        step += 1
    del backbone, proj, w, opt
    torch.cuda.empty_cache()

run("E_mild", heavy=False)
run("F_heavy", heavy=True)
print("AUG EXPERIMENT COMPLETE", flush=True)
