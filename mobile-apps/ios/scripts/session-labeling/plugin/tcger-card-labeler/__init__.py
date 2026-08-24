"""FiftyOne plugin: five-button labeling for TCGer scan sessions.

The sample in the modal is the REAL frame image (with the detection-quad
polyline overlay toggleable in the sidebar). This panel supplies the rest as
separate interface elements, refreshed on every sample change:
  - the pipeline crop (what the encoder actually saw)
  - the top-5 retrieval candidates as individual catalog thumbnails
  - the five verdict buttons + corrected-card-ID input

Verdicts (written to the sample's `verdict` field, consumed by writeback.py):
  true          — prediction correct
  false         — prediction wrong (fill in the actual card ID)
  true_margin   — correct, but the crop needs margin edits
  false_margin  — wrong AND the crop needs margin edits
  no_card       — frame contains no identifiable card (accidental shutter etc.)

Fallback: the `apply_card_verdict` operator (backtick key) on grid selections.
"""

import base64
import io
from pathlib import Path

import fiftyone.operators as foo
import fiftyone.operators.types as types

VERDICTS = [
    ("true", "✓ Correct"),
    ("true_margin", "✓ Correct — needs margin edit"),
    ("false", "✗ Wrong card"),
    ("false_margin", "✗ Wrong — needs margin edit"),
    ("no_card", "∅ No card"),
]
WRONG = {"false", "false_margin"}
N_CANDS = 5
CROP_H = 380
THUMB_H = 230
POCKET_H = 190


def _data_uri(pil_image, quality=82):
    buf = io.BytesIO()
    pil_image.convert("RGB").save(buf, format="JPEG", quality=quality)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _scaled(img, height):
    w = max(1, round(img.width * height / img.height))
    return img.resize((w, height))


def _captioned_thumb(path, line1, line2, highlight, height=THUMB_H):
    """Thumbnail with a two-line caption strip baked under it; green border
    when highlighted (the accepted/matched pick)."""
    from PIL import Image, ImageDraw, ImageFont

    try:
        img = _scaled(Image.open(path).convert("RGB"), height)
    except Exception:
        img = Image.new("RGB", (int(height * 0.72), height), (60, 60, 65))
    canvas = Image.new("RGB", (img.width, height + 40), (24, 24, 27))
    canvas.paste(img, (0, 0))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
    except OSError:
        font = ImageFont.load_default()
    color = (52, 199, 89) if highlight else (225, 225, 225)
    draw.text((4, height + 3), str(line1), fill=color, font=font)
    if line2:
        draw.text((4, height + 21), str(line2), fill=(150, 150, 150), font=font)
    if highlight:
        draw.rectangle([0, 0, img.width - 1, height - 1], outline=(52, 199, 89), width=3)
    return canvas


def _apply(dataset, sample_id, verdict, corrected_id):
    sample = dataset[sample_id]
    sample["verdict"] = verdict
    sample["corrected_card_id"] = (corrected_id or None) if verdict in WRONG else None
    if "verdict-applied" not in sample.tags:
        sample.tags.append("verdict-applied")
    sample.save()
    return sample["key"] if sample.has_field("key") else sample_id


class CardVerdictPanel(foo.Panel):
    @property
    def config(self):
        return foo.PanelConfig(
            name="tcger_card_verdict",
            label="Card Verdict",
            surfaces="modal",
            icon="fact_check",
        )

    def on_load(self, ctx):
        ctx.panel.state.corrected_id = ""
        ctx.panel.state.last = ""
        self._refresh(ctx)

    def on_change_current_sample(self, ctx):
        self._refresh(ctx)

    def _refresh(self, ctx):
        import json

        from PIL import Image

        ctx.panel.state.cands = {}
        ctx.panel.state.crop_img = None
        ctx.panel.state.header = ""
        ctx.panel.state.n_pockets = 0
        ctx.panel.state.pocket_labels = []
        ctx.panel.state.pocket_crops = {}
        sample_id = ctx.current_sample
        if not sample_id:
            return
        try:
            sample = ctx.dataset[sample_id]
        except Exception:
            return

        if sample["frame_type"] == "binder":
            self._refresh_binder(ctx, sample)
            return

        device_id = sample["device_card_id"]
        decision = device_id or "noMatch"
        conf = sample["device_confidence"]
        header = f"**{sample['key']}** — device: `{decision}`"
        if conf is not None and device_id:
            header += f" @{conf:.2f}"
        if sample["outcome"]:
            header += f" — {sample['outcome']}"
        if sample["existing_expected_card_id"] or sample["existing_expected_no_match"]:
            known = sample["existing_expected_card_id"] or "noMatch"
            header += f"\n\nAlready labeled (`{sample['label_source']}`): **{known}**"
        if sample["verdict"]:
            header += f"\n\nVerdict: **{sample['verdict']}**" + (
                f" → {sample['corrected_card_id']}" if sample["corrected_card_id"] else ""
            )
        ctx.panel.state.header = header

        crop_path = sample["crop_path"]
        if crop_path and Path(crop_path).exists():
            try:
                ctx.panel.state.crop_img = _data_uri(
                    _scaled(Image.open(crop_path), CROP_H)
                )
            except Exception:
                pass

        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", ""))
        ids = sample["top5_card_ids"] or []
        sims = sample["top5_similarities"] or []
        cands = {}
        for i, (cid, sim) in enumerate(zip(ids[:N_CANDS], sims[:N_CANDS])):
            thumb = _captioned_thumb(
                cache_dir / f"{cid.replace('/', '_')}.webp",
                cid, f"{sim:.3f}", cid == device_id,
            )
            cands[f"cand{i}"] = _data_uri(thumb)
        ctx.panel.state.cands = cands

    def _refresh_binder(self, ctx, sample):
        """Binder pages show the two pipeline stages separately: first the
        page carve (all pocket crops in one strip), then the recognition
        results per pocket."""
        import json

        from PIL import Image

        header = f"**{sample['key']}** — {sample['outcome'] or 'binder page'}"
        ctx.panel.state.header = header
        pockets = json.loads(sample["binder_pockets_json"] or "[]")
        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", ""))

        crops = {}
        for i, p in enumerate(pockets):
            crop = p.get("crop_path")
            if crop and Path(crop).exists():
                thumb = _captioned_thumb(
                    crop, f"P{p['pocket'] + 1}", p.get("outcome"),
                    bool(p.get("matched_card_id")), height=POCKET_H,
                )
                crops[f"p{i}"] = _data_uri(thumb)
        ctx.panel.set_state("pocket_crops", crops)

        labels = []
        for i, p in enumerate(pockets):
            status = p.get("matched_card_id") or p.get("outcome") or "?"
            labels.append(f"**Pocket {p['pocket'] + 1}** — `{status}`")
            row = {}
            for j, c in enumerate(p.get("cands") or []):
                thumb = _captioned_thumb(
                    cache_dir / f"{c['id'].replace('/', '_')}.webp",
                    c["id"], f"{c['sim']:.3f}", c["id"] == p.get("matched_card_id"),
                    height=POCKET_H - 40,
                )
                row[f"c{j}"] = _data_uri(thumb)
            ctx.panel.set_state(f"pocket{i}", row)
        ctx.panel.state.pocket_labels = labels
        ctx.panel.state.n_pockets = len(pockets)

    def _verdict(self, ctx, verdict):
        sample_id = ctx.current_sample
        if not sample_id:
            ctx.panel.state.last = "no sample open"
            return
        corrected = (ctx.panel.get_state("corrected_id") or "").strip() or None
        key = _apply(ctx.dataset, sample_id, verdict, corrected)
        note = f" -> {corrected}" if verdict in WRONG and corrected else ""
        if verdict in WRONG and not corrected:
            note = "  (no ID given — flagged for a second pass)"
        ctx.panel.state.last = f"{verdict}{note}: {key}"
        ctx.panel.state.corrected_id = ""

    def on_true(self, ctx):
        self._verdict(ctx, "true")

    def on_true_margin(self, ctx):
        self._verdict(ctx, "true_margin")

    def on_false(self, ctx):
        self._verdict(ctx, "false")

    def on_false_margin(self, ctx):
        self._verdict(ctx, "false_margin")

    def on_no_card(self, ctx):
        self._verdict(ctx, "no_card")

    def on_clear(self, ctx):
        sample_id = ctx.current_sample
        if not sample_id:
            return
        sample = ctx.dataset[sample_id]
        sample["verdict"] = None
        sample["corrected_card_id"] = None
        if "verdict-applied" in sample.tags:
            sample.tags.remove("verdict-applied")
        sample.save()
        ctx.panel.state.last = "cleared"

    def render(self, ctx):
        panel = types.Object()
        panel.md(ctx.panel.get_state("header") or "", name="header")

        n_pockets = ctx.panel.get_state("n_pockets") or 0
        if n_pockets:
            crops = ctx.panel.get_state("pocket_crops") or {}
            if crops:
                panel.md("### 1 — Page carve (pocket crops)", name="carve_label")
                strip = types.Object()
                for key in sorted(crops, key=lambda k: int(k[1:])):
                    strip.str(key, view=types.ImageView())
                panel.define_property(
                    "pocket_crops", strip,
                    view=types.GridView(orientation="horizontal", gap=1),
                )
            panel.md("### 2 — Recognition per pocket", name="recog_label")
            labels = ctx.panel.get_state("pocket_labels") or []
            for i in range(n_pockets):
                if i < len(labels):
                    panel.md(labels[i], name=f"pocket_label{i}")
                imgs = ctx.panel.get_state(f"pocket{i}") or {}
                if not imgs:
                    continue
                row = types.Object()
                for key in sorted(imgs):
                    row.str(key, view=types.ImageView())
                panel.define_property(
                    f"pocket{i}", row,
                    view=types.GridView(orientation="horizontal", gap=1),
                )
            panel.md(
                "_Binder page — single-card verdicts are disabled here; "
                "pocket labeling comes with the margin-edit workflow._",
                name="binder_note",
            )
            return types.Property(
                panel, view=types.GridView(gap=2, align_x="left", orientation="vertical")
            )

        if ctx.panel.get_state("crop_img"):
            panel.md("**Pipeline crop**", name="crop_label")
            panel.str("crop_img", view=types.ImageView())

        cands = ctx.panel.get_state("cands") or {}
        if cands:
            panel.md("**Top-5 candidates**", name="cand_label")
            row = types.Object()
            for name in sorted(cands):
                row.str(name, view=types.ImageView())
            panel.define_property(
                "cands", row,
                view=types.GridView(orientation="horizontal", gap=1),
            )

        panel.md("**Verdict**", name="verdict_label")
        row = types.Object()
        row.btn("btn_true", label="✓ Correct", on_click=self.on_true, variant="contained")
        row.btn("btn_true_margin", label="✓ margin", on_click=self.on_true_margin,
                variant="outlined")
        row.btn("btn_false", label="✗ Wrong", on_click=self.on_false, variant="contained")
        row.btn("btn_false_margin", label="✗ margin", on_click=self.on_false_margin,
                variant="outlined")
        row.btn("btn_no_card", label="∅ No card", on_click=self.on_no_card,
                variant="outlined")
        panel.define_property(
            "verdict_row", row, view=types.GridView(orientation="horizontal", gap=1)
        )
        panel.md("`✓/✗ margin` = verdict + the crop needs margin edits", name="margin_note")
        panel.str("corrected_id", label="Actual card ID (for ✗ verdicts, e.g. me05-043)")
        panel.btn("btn_clear", label="Clear verdict", on_click=self.on_clear)
        last = ctx.panel.get_state("last") or ""
        if last:
            panel.md(f"Last: `{last}`", name="last_info")
        return types.Property(
            panel, view=types.GridView(gap=2, align_x="left", orientation="vertical")
        )


class ApplyCardVerdict(foo.Operator):
    """Grid-selection fallback if the modal panel misbehaves."""

    @property
    def config(self):
        return foo.OperatorConfig(
            name="apply_card_verdict",
            label="Apply card verdict to selected",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        n = len(ctx.selected)
        inputs.md(
            f"Applies to **{n}** selected sample(s)."
            if n
            else "Select samples in the grid first.",
            name="count",
        )
        choices = types.Choices()
        for value, label in VERDICTS:
            choices.add_choice(value, label=label)
        inputs.enum("verdict", choices.values(), view=choices, required=True, label="Verdict")
        inputs.str("corrected_card_id", label="Actual card ID (wrong-card verdicts)")
        return types.Property(inputs)

    def execute(self, ctx):
        verdict = ctx.params["verdict"]
        corrected = (ctx.params.get("corrected_card_id") or "").strip() or None
        keys = [_apply(ctx.dataset, sid, verdict, corrected) for sid in ctx.selected]
        return {"applied": len(keys), "verdict": verdict}


def register(p):
    p.register(CardVerdictPanel)
    p.register(ApplyCardVerdict)
