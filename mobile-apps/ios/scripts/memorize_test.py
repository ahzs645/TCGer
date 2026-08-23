"""Memorization test: 200 classes, clean images (no augs), many passes.
A healthy pipeline overfits this in minutes (acc -> ~1.0, loss << ln(200)=5.3).
Also logs the AMP GradScaler scale to expose silently-skipped steps, and runs
a no-AMP control.
"""
import json, math, random, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import timm
import torchvision.transforms.functional as TF
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from pathlib import Path

IMNET_MEAN = [0.485, 0.456, 0.406]; IMNET_STD = [0.229, 0.224, 0.225]
IMG_SIZE = 224; EMBED_DIM = 384
CACHE = Path("/content/card-images")

entries = json.load(open("/content/CardsIndexMetadata.json"))
valid = [e["annIndex"] for e in entries[:220]
         if (CACHE / f"{e['annIndex']:05d}.img").exists()][:200]
label_of = {ann: k for k, ann in enumerate(valid)}
print("classes:", len(valid), flush=True)

def contract_resize(img):
    w, h = img.size
    s = max(256 / min(w, h), IMG_SIZE / w, IMG_SIZE / h)
    rw, rh = math.ceil(w * s), math.ceil(h * s)
    img = img.resize((rw, rh), Image.BICUBIC)
    l, t = (rw - IMG_SIZE) // 2, (rh - IMG_SIZE) // 2
    return img.crop((l, t, l + IMG_SIZE, t + IMG_SIZE))

# Preload the 200 tensors once — no augs, no loader variance.
tensors = []
for ann in valid:
    img = Image.open(CACHE / f"{ann:05d}.img").convert("RGB")
    tensors.append(TF.normalize(TF.to_tensor(contract_resize(img)), IMNET_MEAN, IMNET_STD))
X = torch.stack(tensors)
Y = torch.arange(len(valid))
print("data:", X.shape, flush=True)

def run(name, use_amp, s_scale=16.0, lr=3e-4, steps=120, batch=100):
    torch.manual_seed(22)
    backbone = timm.create_model("fastvit_t8.apple_in1k", pretrained=True, num_classes=0).cuda()
    proj = nn.Linear(backbone.num_features, EMBED_DIM).cuda()
    w = nn.Parameter(torch.empty(len(valid), EMBED_DIM).cuda())
    nn.init.xavier_uniform_(w)
    opt = torch.optim.AdamW([*backbone.parameters(), *proj.parameters(), w],
                            lr=lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler(enabled=use_amp)
    backbone.train()
    for step in range(steps):
        idx = torch.randperm(len(valid))[:batch]
        x, y = X[idx].cuda(), Y[idx].cuda()
        opt.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda", enabled=use_amp):
            emb = F.normalize(proj(backbone(x)), dim=-1)
            logits = s_scale * (emb @ F.normalize(w, dim=-1).t())
            loss = F.cross_entropy(logits, y)
        scaler.scale(loss).backward()
        scaler.step(opt)
        scaler.update()
        if step % 20 == 0 or step == steps - 1:
            acc = (logits.argmax(1) == y).float().mean().item()
            print(f"[{name}] step {step} loss {loss.item():.3f} acc {acc:.3f} "
                  f"scale {scaler.get_scale() if use_amp else 'n/a'}", flush=True)
    del backbone, proj, w, opt
    torch.cuda.empty_cache()

run("AMP", True)
run("NOAMP", False)
print("MEMORIZE TEST COMPLETE", flush=True)
