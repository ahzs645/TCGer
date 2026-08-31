"""FiftyOne plugin: single-card and binder-pocket TCGer session labeling.

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

Binder pages keep independent human judgments in `binder_labels_json`, keyed
by recorded pocket number. These labels never replace recorded device crops or
candidates and are also captured by the append-only journal.
"""

import base64
import io
import os
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
N_SEARCH_RESULTS = 12
CROP_H = 380
THUMB_H = 230
POCKET_H = 190
BINDER_PAGE_H = 320
BINDER_OVERVIEW_H = 110
BINDER_FOCUS_H = 360
_CATALOG_CACHE = {}


def _normalized_game(game):
    value = str(game or "pokemon").strip().lower()
    return {"mtg": "magic", "pokémon": "pokemon"}.get(value, value)


def _game_label(game):
    game = _normalized_game(game)
    return {
        "magic": "Magic",
        "pokemon": "Pokémon",
        "yugioh": "Yu-Gi-Oh!",
    }.get(game, game.replace("-", " ").title())


def _game_catalog(dataset, game):
    """Load and cache exact-print metadata for one sample's active game."""
    import json

    game = _normalized_game(game)
    paths = tuple(dataset.info.get("card_metadata_paths") or [])
    key = (game, paths)
    if key in _CATALOG_CACHE:
        return _CATALOG_CACHE[key]

    by_id = {}
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists():
            continue
        path_hint = str(path).lower()
        try:
            with path.open(encoding="utf-8") as source:
                rows = json.load(source)
        except Exception:
            continue
        for row in rows:
            row_game = _normalized_game(row.get("game")) if row.get("game") else (
                "magic" if "magic" in path_hint else "pokemon"
            )
            if row_game != game:
                continue
            image_url = str(row.get("imageURL") or "").lower()
            if game == "pokemon" and (
                row.get("series") == "tcgp"
                or row.get("format") == "pocket"
                or "/tcgp/" in image_url
            ):
                continue
            card_id = row.get("cardId")
            if card_id:
                normalized = dict(row)
                normalized["setName"] = (
                    row.get("setName") or row.get("setCode")
                )
                normalized["collectorNumber"] = (
                    row.get("collectorNumber")
                    or (card_id.rsplit("-", 1)[-1] if "-" in card_id else None)
                )
                by_id[card_id] = normalized

    rows = list(by_id.values())
    _CATALOG_CACHE[key] = rows
    return rows


def _search_catalog(rows, query, limit=N_SEARCH_RESULTS):
    """Rank name/set/collector/ID matches without fuzzy false positives."""
    query = " ".join(str(query or "").strip().lower().split())
    if not query:
        return []
    words = query.split()
    matches = []
    for row in rows:
        card_id = str(row.get("cardId") or "")
        name = str(row.get("name") or "")
        set_name = str(row.get("setName") or "")
        set_code = str(row.get("setCode") or "")
        collector = str(row.get("collectorNumber") or "")
        values = [card_id, name, set_name, set_code, collector]
        lowered = [value.lower() for value in values]
        haystack = " ".join(lowered)
        if not all(word in haystack for word in words):
            continue
        if query == lowered[0]:
            rank = 0
        elif query == lowered[4]:
            rank = 1
        elif query == lowered[1]:
            rank = 2
        elif lowered[1].startswith(query):
            rank = 3
        elif query in lowered[1]:
            rank = 4
        elif query in lowered[2] or query == lowered[3]:
            rank = 5
        else:
            rank = 6
        release_digits = "".join(
            character
            for character in str(row.get("releaseDate") or "")
            if character.isdigit()
        )
        release_rank = -int(release_digits or "0")
        matches.append((
            rank,
            name.lower(),
            release_rank,
            set_name.lower(),
            collector.lower(),
            row,
        ))
    matches.sort(key=lambda item: item[:-1])
    return [item[-1] for item in matches[:limit]]


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


def _journal_path(sample):
    """Place durable labels outside immutable captured session evidence."""
    override = os.environ.get("TCGER_LABELING_STATE_DIR")
    if override:
        return Path(override).expanduser() / "journal.jsonl"
    try:
        frame_path = Path(sample.filepath).expanduser().resolve()
        sessions_dir = frame_path.parents[1]
        if sessions_dir.name == "sessions":
            session_root = sessions_dir.parent
            if session_root.name == "TCGer-Session-Reference":
                return (
                    session_root.parent
                    / "TCGer-Labeling/fiftyone-sessions/journal.jsonl"
                )
            return session_root / "labeling/journal.jsonl"
    except Exception:
        pass
    return Path.home() / ".local/share/TCGer/labeling/journal.jsonl"


def _journal(sample):
    """Append-only durable record of every labeling action, written the
    moment it happens. Nothing in the tooling ever truncates or rewrites this
    file; restore = replay last line per key (backup_labels.py --restore)."""
    import datetime
    import json as _json

    try:
        rec = {"ts": datetime.datetime.now().isoformat(timespec="seconds"),
               "key": sample["key"]}
        for f in ("verdict", "corrected_card_id",
                  "fixed_quad_json", "fixed_quad_source", "rerun_top5_json",
                  "binder_rerun_json", "binder_labels_json"):
            rec[f] = sample[f] if sample.has_field(f) else None
        try:
            mq = sample["manual_quad"]
            if mq and mq.polylines and mq.polylines[-1].points:
                rec["manual_quad_points"] = [
                    [float(x), float(y)] for x, y in mq.polylines[-1].points[0]
                ]
        except Exception:
            pass
        journal = _journal_path(sample)
        journal.parent.mkdir(parents=True, exist_ok=True)
        with open(journal, "a") as f:
            f.write(_json.dumps(rec) + "\n")
    except Exception:
        pass


def _apply(dataset, sample_id, verdict, corrected_id):
    sample = dataset[sample_id]
    sample["verdict"] = verdict
    sample["corrected_card_id"] = (corrected_id or None) if verdict in WRONG else None
    if "verdict-applied" not in sample.tags:
        sample.tags.append("verdict-applied")
    sample.save()
    _journal(sample)
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
        if ctx.panel.get_state("auto_confirm") is None:
            ctx.panel.state.auto_confirm = False
            ctx.panel.state.auto_count = 0
        self._refresh(ctx)

    def on_toggle_auto(self, ctx):
        ctx.panel.state.auto_confirm = not bool(ctx.panel.get_state("auto_confirm"))
        ctx.panel.state.last_sample_id = ctx.current_sample

    def _auto_confirm_previous(self, ctx):
        """Auto-confirm mode: leaving a frame without objecting marks the
        scanner pick correct. Only unlabeled, device-accepted single frames
        qualify — existing ground truth and explicit verdicts are never
        touched."""
        prev = ctx.panel.get_state("last_sample_id")
        current = ctx.current_sample
        if prev and prev != current and ctx.panel.get_state("auto_confirm"):
            try:
                sample = ctx.dataset[prev]
                if (sample["frame_type"] == "single"
                        and sample["device_identified"]
                        and sample["verdict"] is None
                        and sample["label_source"] is None):
                    sample["verdict"] = "true"
                    sample["corrected_card_id"] = None
                    if "verdict-applied" not in sample.tags:
                        sample.tags.append("verdict-applied")
                    sample.save()
                    _journal(sample)
                    ctx.panel.state.auto_count = \
                        (ctx.panel.get_state("auto_count") or 0) + 1
            except Exception:
                pass
        ctx.panel.state.last_sample_id = current

    def on_change_current_sample(self, ctx):
        self._refresh(ctx)

    def _refresh(self, ctx):
        import json

        from PIL import Image

        self._auto_confirm_previous(ctx)
        ctx.panel.state.cands = {}
        ctx.panel.state.crop_img = None
        ctx.panel.state.crop_section = {}
        ctx.panel.state.header = ""
        ctx.panel.state.n_pockets = 0
        ctx.panel.state.pocket_labels = []
        ctx.panel.state.pocket_crops = {}
        ctx.panel.state.binder_page = {}
        ctx.panel.state.binder_pockets = []
        ctx.panel.state.focus_pocket_index = 0
        ctx.panel.state.focus_pocket_label = ""
        ctx.panel.state.focus_pocket_crop = {}
        ctx.panel.state.focus_candidates = {}
        ctx.panel.state.focus_candidate_ids = []
        ctx.panel.state.focus_candidate_sims = []
        ctx.panel.state.focus_candidate_names = []
        ctx.panel.state.focus_candidate_sets = []
        ctx.panel.state.focus_candidate_collectors = []
        ctx.panel.state.focus_matched_id = None
        ctx.panel.state.focus_label_base = None
        ctx.panel.state.focus_label_margin = False
        ctx.panel.state.focus_has_label = False
        ctx.panel.state.focus_saved_corrected = None
        ctx.panel.state.focus_saved_line = ""
        ctx.panel.state.binder_library_query = ""
        ctx.panel.state.binder_library_results = {}
        ctx.panel.state.binder_library_ids = []
        ctx.panel.state.binder_library_names = []
        ctx.panel.state.binder_library_sets = []
        ctx.panel.state.binder_library_collectors = []
        ctx.panel.state.binder_library_status = ""
        ctx.panel.state.pick_ids = []
        ctx.panel.state.pick_sims = []
        ctx.panel.state.pick_names = []
        ctx.panel.state.pick_sets = []
        ctx.panel.state.pick_collectors = []
        ctx.panel.state.device_id = None
        ctx.panel.state.base = None
        ctx.panel.state.margin = False
        ctx.panel.state.saved_corrected = None
        ctx.panel.state.saved_line = ""
        ctx.panel.state.alt_crops = {}
        ctx.panel.state.alt_labels = []
        ctx.panel.state.alt_quads = []
        ctx.panel.state.rerun_cands = {}
        ctx.panel.state.rerun_ids = []
        ctx.panel.state.rerun_sims = []
        ctx.panel.state.rerun_names = []
        ctx.panel.state.rerun_sets = []
        ctx.panel.state.rerun_collectors = []
        ctx.panel.state.rerun_game = None
        ctx.panel.state.rerun_source = None
        ctx.panel.state.library_query = ""
        ctx.panel.state.library_results = {}
        ctx.panel.state.library_ids = []
        ctx.panel.state.library_names = []
        ctx.panel.state.library_sets = []
        ctx.panel.state.library_collectors = []
        ctx.panel.state.library_status = ""
        ctx.panel.state.rescan_crops = {}
        ctx.panel.state.rescan_n = 0
        ctx.panel.state.picking = False
        ctx.panel.state.corners = []
        ctx.panel.state.corner_plot = []
        try:
            ctx.panel.state.fixed_source = \
                ctx.dataset[ctx.current_sample]["fixed_quad_source"]
        except Exception:
            ctx.panel.state.fixed_source = None
        try:
            mq = ctx.dataset[ctx.current_sample]["manual_quad"]
            ctx.panel.state.has_manual = bool(mq and mq.polylines)
        except Exception:
            ctx.panel.state.has_manual = False
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
        ctx.panel.state.header = header
        verdict = sample["verdict"]
        ctx.panel.state.base = verdict.replace("_margin", "") if verdict else None
        ctx.panel.state.margin = bool(verdict and verdict.endswith("_margin"))
        ctx.panel.state.saved_corrected = sample["corrected_card_id"]
        ctx.panel.state.saved_line = self._saved_line(verdict, sample["corrected_card_id"])
        ctx.panel.state.device_id = device_id

        crop_path = sample["crop_path"]
        section = {}
        if crop_path and Path(crop_path).exists():
            try:
                uri = _data_uri(_scaled(Image.open(crop_path), CROP_H))
                ctx.panel.state.crop_img = uri
                section["img"] = uri
            except Exception:
                pass
        # A chosen fix boundary persists beside the pipeline crop.
        try:
            fq = sample["fixed_quad_json"]
        except Exception:
            fq = None
        if fq:
            try:
                import sys

                sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
                import cv2

                import alt_detectors

                image = cv2.imread(sample.filepath)
                crop = alt_detectors.warp_quad_crop(
                    image, json.loads(fq), ordered=True
                )
                pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                section["fixedcol"] = {"fimg": _data_uri(_scaled(pil, CROP_H))}
            except Exception:
                pass
        if section:
            ctx.panel.set_state("crop_section", section)

        # Restore a persisted re-run (survives sample navigation / app restart).
        try:
            rr = json.loads(sample["rerun_top5_json"] or "null") \
                if sample.has_field("rerun_top5_json") else None
        except Exception:
            rr = None
        sample_game = sample["game"] or "pokemon"
        rerun_game = rr.get("game") if rr else None
        if rr and rr.get("cands") and (
            rerun_game == sample_game
            or (rerun_game is None and sample_game == "pokemon")
        ):
            self._show_rerun(
                ctx,
                rr["cands"],
                rr.get("source"),
                fetch_missing=False,
                game=sample_game,
            )

        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", ""))
        ids = sample["top5_card_ids"] or []
        sims = sample["top5_similarities"] or []
        names = sample["top5_names"] or []
        sets = sample["top5_set_names"] or [] \
            if sample.has_field("top5_set_names") else []
        collectors = sample["top5_collector_numbers"] or [] \
            if sample.has_field("top5_collector_numbers") else []
        cands = {}
        for i, cid in enumerate(ids[:N_CANDS]):
            path = cache_dir / f"{cid.replace('/', '_')}.webp"
            try:
                img = _scaled(Image.open(path).convert("RGB"), THUMB_H)
            except Exception:
                img = Image.new("RGB", (int(THUMB_H * 0.72), THUMB_H), (60, 60, 65))
            cands[f"c{i}"] = {"img": _data_uri(img)}
        ctx.panel.state.cands = cands
        ctx.panel.state.pick_ids = list(ids[:N_CANDS])
        ctx.panel.state.pick_sims = [float(s) for s in sims[:N_CANDS]]
        ctx.panel.state.pick_names = list(names[:N_CANDS])
        ctx.panel.state.pick_sets = list(sets[:N_CANDS])
        ctx.panel.state.pick_collectors = list(collectors[:N_CANDS])

    def _refresh_binder(self, ctx, sample):
        """Show the full binder page, then one recorded pocket at a time.

        The compact crop strip remains a complete map of all detected pockets,
        while the focused crop and candidates are large enough to judge. Page
        and pocket navigation only change panel state; recorded scanner data
        and the verdict journal are untouched.
        """
        import json

        from PIL import Image

        header = f"**{sample['key']}** — {sample['outcome'] or 'binder page'}"
        ctx.panel.state.header = header
        pockets = json.loads(sample["binder_pockets_json"] or "[]")
        ctx.panel.state.binder_pockets = pockets
        ctx.panel.state.n_pockets = len(pockets)

        if sample.filepath and Path(sample.filepath).exists():
            try:
                page = _scaled(Image.open(sample.filepath), BINDER_PAGE_H)
                ctx.panel.set_state("binder_page", {"img": _data_uri(page, quality=75)})
            except Exception:
                pass

        self._set_binder_focus(ctx, sample, pockets, 0)

        # Restore a persisted page re-scan (survives navigation/restarts).
        try:
            rescan = json.loads(sample["binder_rerun_json"] or "null") \
                if sample.has_field("binder_rerun_json") else None
        except Exception:
            rescan = None
        if rescan:
            self._show_binder_rescan(ctx, sample, rescan)

    def _set_binder_focus(self, ctx, sample, pockets, index):
        """Populate the selected-pocket state and refresh the compact map."""
        from PIL import Image

        if not pockets:
            ctx.panel.state.focus_pocket_index = 0
            ctx.panel.state.focus_pocket_label = "No recorded pockets"
            return

        index = max(0, min(int(index), len(pockets) - 1))
        pocket = pockets[index]
        ctx.panel.state.focus_pocket_index = index
        ctx.panel.state.focus_matched_id = pocket.get("matched_card_id")

        status = pocket.get("matched_card_id") or pocket.get("outcome") or "unknown"
        ctx.panel.state.focus_pocket_label = (
            f"**Pocket {pocket.get('pocket', index) + 1} of {len(pockets)}** "
            f"— recorded result: `{status}`"
        )

        focus_crop = {}
        crop_path = pocket.get("crop_path")
        if crop_path and Path(crop_path).exists():
            try:
                crop = _scaled(Image.open(crop_path), BINDER_FOCUS_H)
                focus_crop["img"] = _data_uri(crop)
            except Exception:
                pass
        ctx.panel.set_state("focus_pocket_crop", focus_crop)

        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", ""))
        candidates = pocket.get("cands") or []
        images = {}
        for candidate_index, candidate in enumerate(candidates):
            path = cache_dir / f"{candidate['id'].replace('/', '_')}.webp"
            try:
                card = _scaled(Image.open(path).convert("RGB"), THUMB_H)
            except Exception:
                card = Image.new(
                    "RGB", (int(THUMB_H * 0.72), THUMB_H), (60, 60, 65)
                )
            images[f"c{candidate_index}"] = {"img": _data_uri(card)}
        ctx.panel.set_state("focus_candidates", images)
        ctx.panel.state.focus_candidate_ids = [c["id"] for c in candidates]
        ctx.panel.state.focus_candidate_sims = [float(c["sim"]) for c in candidates]
        ctx.panel.state.focus_candidate_names = [c.get("name") for c in candidates]
        ctx.panel.state.focus_candidate_sets = [c.get("setName") for c in candidates]
        ctx.panel.state.focus_candidate_collectors = [
            c.get("collectorNumber") for c in candidates
        ]

        labels = self._binder_labels(sample)
        saved = labels.get(str(pocket.get("pocket", index))) or {}
        ctx.panel.state.focus_has_label = bool(saved)
        ctx.panel.state.focus_label_base = saved.get("verdict")
        ctx.panel.state.focus_label_margin = bool(saved.get("crop_needs_edit"))
        ctx.panel.state.focus_saved_corrected = saved.get("corrected_card_id")
        ctx.panel.state.focus_saved_line = self._binder_saved_line(saved)
        ctx.panel.state.binder_library_query = ""
        ctx.panel.set_state("binder_library_results", {})
        ctx.panel.state.binder_library_ids = []
        ctx.panel.state.binder_library_names = []
        ctx.panel.state.binder_library_sets = []
        ctx.panel.state.binder_library_collectors = []
        ctx.panel.state.binder_library_status = ""

        overview = {}
        overview_labels = []
        for pocket_index, item in enumerate(pockets):
            item_status = item.get("matched_card_id") or item.get("outcome") or "?"
            pocket_number = item.get("pocket", pocket_index)
            human = self._binder_saved_line(labels.get(str(pocket_number)) or {})
            overview_labels.append(
                f"**Pocket {pocket_number + 1}** — `{item_status}`"
                + (f" — {human}" if human else "")
            )
            path = item.get("crop_path")
            if not path or not Path(path).exists():
                continue
            thumb = _captioned_thumb(
                path,
                ("▶ " if pocket_index == index else "")
                + f"P{item.get('pocket', pocket_index) + 1}",
                item.get("outcome"),
                pocket_index == index,
                height=BINDER_OVERVIEW_H,
            )
            overview[f"p{pocket_index}"] = _data_uri(thumb)
        ctx.panel.set_state("pocket_crops", overview)
        ctx.panel.state.pocket_labels = overview_labels

    @staticmethod
    def _binder_labels(sample):
        """Return the versioned per-pocket human-label mapping."""
        import json

        try:
            raw = sample["binder_labels_json"] \
                if sample.has_field("binder_labels_json") else None
            payload = json.loads(raw or "{}")
        except Exception:
            payload = {}
        pockets = payload.get("pockets") if isinstance(payload, dict) else None
        return pockets if isinstance(pockets, dict) else {}

    @staticmethod
    def _binder_saved_line(label):
        verdict = label.get("verdict") if label else None
        corrected = label.get("corrected_card_id") if label else None
        margin = bool(label and label.get("crop_needs_edit"))
        if verdict == "true":
            identity = "✅ recorded match correct"
        elif verdict == "false":
            identity = f"❌ wrong → `{corrected}`" if corrected else "❌ wrong"
        elif verdict == "no_card":
            identity = "∅ no card"
        else:
            identity = ""
        if not identity and not label:
            return ""
        crop = "needs crop edit" if margin else "crop OK"
        return f"{identity} · {crop}" if identity else crop

    def _save_binder_label(self, ctx, verdict=None, corrected_id=None):
        """Atomically replace one pocket's human label and journal it."""
        import json

        if not ctx.current_sample:
            return
        sample = ctx.dataset[ctx.current_sample]
        pockets = json.loads(sample["binder_pockets_json"] or "[]")
        if not pockets:
            return
        index = max(0, min(
            int(ctx.panel.get_state("focus_pocket_index") or 0),
            len(pockets) - 1,
        ))
        pocket = pockets[index]
        pocket_key = str(pocket.get("pocket", index))
        labels = self._binder_labels(sample)
        current = labels.get(pocket_key) or {}
        if verdict is None:
            verdict = current.get("verdict")
            corrected_id = current.get("corrected_card_id")
        label = {
            "verdict": verdict,
            "corrected_card_id": corrected_id if verdict == "false" else None,
            "crop_needs_edit": bool(
                ctx.panel.get_state("focus_label_margin")
            ),
            # Captures what was being judged without changing device evidence.
            "recorded_card_id": pocket.get("matched_card_id"),
        }
        labels[pocket_key] = label
        sample["binder_labels_json"] = json.dumps(
            {"version": 1, "pockets": labels}, sort_keys=True
        )
        if "binder-labels-applied" not in sample.tags:
            sample.tags.append("binder-labels-applied")
        sample.save()
        _journal(sample)
        library_state = {
            key: ctx.panel.get_state(key)
            for key in (
                "binder_library_query",
                "binder_library_results",
                "binder_library_ids",
                "binder_library_names",
                "binder_library_sets",
                "binder_library_collectors",
                "binder_library_status",
            )
        }
        self._set_binder_focus(ctx, sample, pockets, index)
        # Keep search results visible so an exact-library selection remains
        # visibly selected after it is saved. Moving pockets still clears them.
        for key, value in library_state.items():
            ctx.panel.set_state(key, value)

    def on_binder_correct(self, ctx):
        if not ctx.panel.get_state("focus_matched_id"):
            return
        self._save_binder_label(ctx, "true", None)

    def on_binder_no_card(self, ctx):
        self._save_binder_label(ctx, "no_card", None)

    def on_binder_candidate_pick(self, ctx):
        ids = ctx.panel.get_state("focus_candidate_ids") or []
        index = int(ctx.params.get("candidate_index", -1))
        if index < 0 or index >= len(ids):
            return
        card_id = ids[index]
        if card_id == ctx.panel.get_state("focus_matched_id"):
            self._save_binder_label(ctx, "true", None)
        else:
            self._save_binder_label(ctx, "false", card_id)

    def on_binder_library_search(self, ctx):
        """Search the focused pocket's active-game exact-print catalog."""
        query = (ctx.panel.get_state("binder_library_query") or "").strip()
        if not ctx.current_sample or not query:
            ctx.panel.state.binder_library_status = (
                "Enter a card name, set, number, or ID."
            )
            return

        import requests
        from PIL import Image

        sample = ctx.dataset[ctx.current_sample]
        game = sample["game"] or "pokemon"
        results = _search_catalog(_game_catalog(ctx.dataset, game), query)
        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", "."))
        images = {}
        for index, row in enumerate(results):
            card_id = row["cardId"]
            cached = cache_dir / f"{card_id.replace('/', '_')}.webp"
            if not cached.exists() and row.get("imageURL"):
                try:
                    response = requests.get(
                        row["imageURL"],
                        timeout=15,
                        headers={
                            "User-Agent": "TCGer/1.0 (+https://tcger.ahmadjalil.com)",
                            "Accept": "image/*",
                        },
                    )
                    response.raise_for_status()
                    cached.write_bytes(response.content)
                except Exception:
                    pass
            try:
                image = _scaled(Image.open(cached).convert("RGB"), THUMB_H)
            except Exception:
                image = Image.new(
                    "RGB", (int(THUMB_H * 0.72), THUMB_H), (60, 60, 65)
                )
            images[f"s{index}"] = {"img": _data_uri(image)}

        ctx.panel.set_state("binder_library_results", images)
        ctx.panel.state.binder_library_ids = [row["cardId"] for row in results]
        ctx.panel.state.binder_library_names = [row.get("name") for row in results]
        ctx.panel.state.binder_library_sets = [row.get("setName") for row in results]
        ctx.panel.state.binder_library_collectors = [
            row.get("collectorNumber") for row in results
        ]
        game_label = _game_label(game)
        ctx.panel.state.binder_library_status = (
            f"{len(results)} {game_label} result{'s' if len(results) != 1 else ''}"
            if results
            else f"No {game_label} cards matched `{query}`."
        )

    def on_binder_library_pick(self, ctx):
        ids = ctx.panel.get_state("binder_library_ids") or []
        index = int(ctx.params.get("result_index", -1))
        if index < 0 or index >= len(ids):
            return
        card_id = ids[index]
        if card_id == ctx.panel.get_state("focus_matched_id"):
            self._save_binder_label(ctx, "true", None)
        else:
            self._save_binder_label(ctx, "false", card_id)

    def on_binder_crop_ok(self, ctx):
        ctx.panel.state.focus_label_margin = False
        self._save_binder_label(ctx)

    def on_binder_crop_margin(self, ctx):
        ctx.panel.state.focus_label_margin = True
        self._save_binder_label(ctx)

    def on_binder_clear_label(self, ctx):
        import json

        if not ctx.current_sample:
            return
        sample = ctx.dataset[ctx.current_sample]
        pockets = json.loads(sample["binder_pockets_json"] or "[]")
        if not pockets:
            return
        index = max(0, min(
            int(ctx.panel.get_state("focus_pocket_index") or 0),
            len(pockets) - 1,
        ))
        pocket_key = str(pockets[index].get("pocket", index))
        labels = self._binder_labels(sample)
        labels.pop(pocket_key, None)
        sample["binder_labels_json"] = (
            json.dumps({"version": 1, "pockets": labels}, sort_keys=True)
            if labels else None
        )
        if not labels and "binder-labels-applied" in sample.tags:
            sample.tags.remove("binder-labels-applied")
        sample.save()
        _journal(sample)
        self._set_binder_focus(ctx, sample, pockets, index)

    def _move_binder_focus(self, ctx, index):
        if not ctx.current_sample:
            return
        sample = ctx.dataset[ctx.current_sample]
        if sample["frame_type"] != "binder":
            return
        import json

        try:
            pockets = json.loads(sample["binder_pockets_json"] or "[]")
        except Exception:
            pockets = []
        self._set_binder_focus(ctx, sample, pockets, index)

    def on_binder_previous(self, ctx):
        current = ctx.panel.get_state("focus_pocket_index") or 0
        self._move_binder_focus(ctx, current - 1)

    def on_binder_next(self, ctx):
        current = ctx.panel.get_state("focus_pocket_index") or 0
        self._move_binder_focus(ctx, current + 1)

    def on_binder_jump(self, ctx):
        self._move_binder_focus(ctx, ctx.params.get("pocket_index", 0))

    ACCEPT_SIM = 0.60  # arcface strong-accept: green border = would-accept

    def on_binder_rescan(self, ctx):
        """Re-detect every card on a binder page with webobb+sam and re-run
        the current encoder per detection. Additive, like the single-frame
        re-run: recorded pocket data is never modified; results persist to
        `binder_rerun_json`."""
        import json
        import sys

        sample_id = ctx.current_sample
        if not sample_id:
            return
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import cv2
        from PIL import Image

        import alt_detectors
        import rerun_candidates

        sample = ctx.dataset[sample_id]
        ctx.panel.state.saved_line = "🔁 re-scanning page (webobb+sam)…"
        try:
            image = cv2.imread(sample.filepath)
            dets = alt_detectors.webobb_sam_page(sample.filepath, image)
        except Exception as e:
            ctx.panel.state.saved_line = f"page re-scan failed: {type(e).__name__}: {e}"
            return
        if not dets:
            ctx.panel.state.saved_line = "page re-scan: webobb found no cards"
            return

        entries = []
        for det in dets:
            quad = alt_detectors.order_quad(det["quad"])
            crop = alt_detectors.warp_quad_crop(image, quad, ordered=True)
            pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            try:
                cands = rerun_candidates.top_k(
                    pil, 3, game=sample["game"] or "pokemon"
                )
            except Exception as e:
                ctx.panel.state.saved_line = f"re-run failed: {type(e).__name__}: {e}"
                return
            entries.append({
                "quad": [[float(x), float(y)] for x, y in quad],
                "obb_confidence": float(det["obb_confidence"]),
                "cands": [
                    {"cardID": c["cardID"], "similarity": float(c["similarity"])}
                    for c in cands
                ],
            })

        sample["binder_rerun_json"] = json.dumps(entries)
        sample.save()
        _journal(sample)
        self._show_binder_rescan(ctx, sample, entries)
        accepted = sum(
            1 for e in entries
            if e["cands"] and e["cands"][0]["similarity"] >= self.ACCEPT_SIM
        )
        ctx.panel.state.saved_line = (
            f"🔁 page re-scan: {len(entries)} cards, {accepted} at/above the "
            f"{self.ACCEPT_SIM:.2f} accept (saved; device data untouched)"
        )

    def _show_binder_rescan(self, ctx, sample, entries):
        """Render persisted page re-scan entries: each detection's warped
        crop captioned with its top pick; green border = would-accept."""
        import json
        import sys

        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import cv2
        from PIL import Image, ImageDraw, ImageFont

        import alt_detectors

        image = cv2.imread(sample.filepath)
        crops = {}
        for i, e in enumerate(entries):
            top = (e.get("cands") or [{}])[0]
            sim = top.get("similarity")
            crop = alt_detectors.warp_quad_crop(image, e["quad"], ordered=True)
            pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            thumb = _scaled(pil, POCKET_H)
            canvas = Image.new("RGB", (thumb.width, POCKET_H + 40), (24, 24, 27))
            canvas.paste(thumb, (0, 0))
            draw = ImageDraw.Draw(canvas)
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
            except OSError:
                font = ImageFont.load_default()
            ok = sim is not None and sim >= self.ACCEPT_SIM
            color = (52, 199, 89) if ok else (225, 225, 225)
            draw.text((4, POCKET_H + 3), str(top.get("cardID") or "?"),
                      fill=color, font=font)
            draw.text((4, POCKET_H + 21),
                      f"{sim:.3f} · obb {e.get('obb_confidence', 0):.2f}"
                      if sim is not None else "no candidates",
                      fill=(150, 150, 150), font=font)
            if ok:
                draw.rectangle([0, 0, thumb.width - 1, POCKET_H - 1],
                               outline=(52, 199, 89), width=3)
            crops[f"s{i}"] = _data_uri(canvas)
        ctx.panel.set_state("rescan_crops", crops)
        ctx.panel.state.rescan_n = len(entries)

    @staticmethod
    def _saved_line(verdict, corrected):
        if not verdict:
            return ""
        line = f"✅ Saved: **{verdict}**"
        if corrected:
            line += f" → `{corrected}`"
        return line

    def _apply_current(self, ctx, clear_corrected=False):
        """Persist the current identity+crop selection to the sample and
        surface the result prominently."""
        sample_id = ctx.current_sample
        base = ctx.panel.get_state("base")
        if not sample_id or not base:
            return
        margin = bool(ctx.panel.get_state("margin")) and base in ("true", "false")
        verdict = f"{base}_margin" if margin else base
        sample = ctx.dataset[sample_id]
        corrected = None if clear_corrected else (
            (ctx.panel.get_state("corrected_id") or "").strip()
            or sample["corrected_card_id"]
        )
        sample["verdict"] = verdict
        sample["corrected_card_id"] = corrected if base == "false" else None
        if "verdict-applied" not in sample.tags:
            sample.tags.append("verdict-applied")
        sample.save()
        _journal(sample)
        ctx.panel.state.saved_corrected = sample["corrected_card_id"]
        line = self._saved_line(verdict, sample["corrected_card_id"])
        if base == "false" and not sample["corrected_card_id"]:
            line += " — no actual ID yet (pick a candidate or type one)"
        ctx.panel.state.saved_line = line

    def on_correct(self, ctx):
        ctx.panel.state.base = "true"
        self._apply_current(ctx)

    def on_wrong(self, ctx):
        ctx.panel.state.base = "false"
        self._apply_current(ctx)

    def on_no_card(self, ctx):
        ctx.panel.state.base = "no_card"
        ctx.panel.state.margin = False
        self._apply_current(ctx)

    def on_crop_ok(self, ctx):
        ctx.panel.state.margin = False
        self._apply_current(ctx)

    def on_crop_margin(self, ctx):
        ctx.panel.state.margin = True
        self._apply_current(ctx)

    def _pick(self, ctx, index):
        """The correct card was one of the shown candidates — one click sets
        the whole identity verdict."""
        ids = ctx.panel.get_state("pick_ids") or []
        if index >= len(ids):
            return
        cid = ids[index]
        device_id = ctx.panel.get_state("device_id")
        if cid == device_id:
            ctx.panel.state.base = "true"
            ctx.panel.state.corrected_id = ""
        else:
            ctx.panel.state.base = "false"
            ctx.panel.state.corrected_id = cid
        self._apply_current(ctx)
        ctx.panel.state.corrected_id = ""

    def on_none_of_these(self, ctx):
        """The true card is not among the candidates: wrong-card verdict with
        the correction still owed (typed ID or a second pass)."""
        ctx.panel.state.base = "false"
        ctx.panel.state.corrected_id = ""
        self._apply_current(ctx, clear_corrected=True)

    def on_library_search(self, ctx):
        """Search exact printings in the current sample's game catalog."""
        sample_id = ctx.current_sample
        query = (ctx.panel.get_state("library_query") or "").strip()
        if not sample_id or not query:
            ctx.panel.state.library_status = "Enter a card name, set, number, or ID."
            return

        import requests
        from PIL import Image

        sample = ctx.dataset[sample_id]
        game = sample["game"] or "pokemon"
        results = _search_catalog(_game_catalog(ctx.dataset, game), query)
        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", "."))
        images = {}
        for index, row in enumerate(results):
            card_id = row["cardId"]
            cached = cache_dir / f"{card_id.replace('/', '_')}.webp"
            if not cached.exists() and row.get("imageURL"):
                try:
                    response = requests.get(
                        row["imageURL"],
                        timeout=15,
                        headers={
                            "User-Agent": "TCGer/1.0 (+https://tcger.ahmadjalil.com)",
                            "Accept": "image/*",
                        },
                    )
                    response.raise_for_status()
                    cached.write_bytes(response.content)
                except Exception:
                    pass
            try:
                image = _scaled(Image.open(cached).convert("RGB"), THUMB_H)
            except Exception:
                image = Image.new(
                    "RGB", (int(THUMB_H * 0.72), THUMB_H), (60, 60, 65)
                )
            images[f"s{index}"] = {"img": _data_uri(image)}

        ctx.panel.set_state("library_results", images)
        ctx.panel.state.library_ids = [row["cardId"] for row in results]
        ctx.panel.state.library_names = [row.get("name") for row in results]
        ctx.panel.state.library_sets = [row.get("setName") for row in results]
        ctx.panel.state.library_collectors = [
            row.get("collectorNumber") for row in results
        ]
        label = _game_label(game)
        ctx.panel.state.library_status = (
            f"{len(results)} {label} result{'s' if len(results) != 1 else ''}"
            if results
            else f"No {label} cards matched `{query}`."
        )

    def _library_pick(self, ctx, index):
        ids = ctx.panel.get_state("library_ids") or []
        if index >= len(ids):
            return
        card_id = ids[index]
        if card_id == ctx.panel.get_state("device_id"):
            ctx.panel.state.base = "true"
            ctx.panel.state.corrected_id = ""
        else:
            ctx.panel.state.base = "false"
            ctx.panel.state.corrected_id = card_id
        self._apply_current(ctx)
        ctx.panel.state.corrected_id = ""
        ctx.panel.state.library_status = f"Selected `{card_id}` as the card truth."

    def on_library_pick0(self, ctx):
        self._library_pick(ctx, 0)

    def on_library_pick1(self, ctx):
        self._library_pick(ctx, 1)

    def on_library_pick2(self, ctx):
        self._library_pick(ctx, 2)

    def on_library_pick3(self, ctx):
        self._library_pick(ctx, 3)

    def on_library_pick4(self, ctx):
        self._library_pick(ctx, 4)

    def on_library_pick5(self, ctx):
        self._library_pick(ctx, 5)

    def on_library_pick6(self, ctx):
        self._library_pick(ctx, 6)

    def on_library_pick7(self, ctx):
        self._library_pick(ctx, 7)

    def on_library_pick8(self, ctx):
        self._library_pick(ctx, 8)

    def on_library_pick9(self, ctx):
        self._library_pick(ctx, 9)

    def on_library_pick10(self, ctx):
        self._library_pick(ctx, 10)

    def on_library_pick11(self, ctx):
        self._library_pick(ctx, 11)

    def on_alt_detect(self, ctx):
        """Run the alternative boundary detectors (TCGscanner YOLO, pagescan
        YOLO + doc-seg) on this frame and show each proposed boundary's warped
        crop IN THE PANEL ONLY. Nothing is written to the sample — drawing the
        boxes on the image is a separate, explicit action (on_alt_overlay)."""
        sample_id = ctx.current_sample
        if not sample_id:
            return
        import sys

        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import cv2
        from PIL import Image

        import alt_detectors

        sample = ctx.dataset[sample_id]
        try:
            results = alt_detectors.run_all(sample.filepath, conf_threshold=0.25)
        except Exception as e:
            ctx.panel.state.saved_line = f"alt detectors failed: {e}"
            return

        quads, crops, labels = [], {}, []
        image = cv2.imread(sample.filepath)
        n = 0
        n_found = 0
        for model, dets in results.items():
            found = [d for d in dets[:2] if "quad" in d]
            for det in found:
                quads.append({
                    "label": f"{model} {det['confidence']:.2f}",
                    "quad": [[float(x), float(y)] for x, y in det["quad"]],
                })
                crop = alt_detectors.warp_quad_crop(image, det["quad"])
                thumb = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                crops[f"b{n}"] = {"img": _data_uri(_scaled(thumb, POCKET_H))}
                labels.append(f"`{model}` @{det['confidence']:.2f}")
                n += 1
                n_found += 1
            if not found:
                # Every model gets a column — an absent one reads as "covered
                # everything", a placeholder reads as what it is.
                error = next((d["error"] for d in dets if "error" in d), None)
                quads.append({"label": f"{model} (none)", "quad": None})
                ph = Image.new("RGB", (int(POCKET_H * 0.72), POCKET_H), (45, 45, 50))
                crops[f"b{n}"] = {"img": _data_uri(ph)}
                labels.append(
                    f"`{model}` — {'error' if error else 'no detection'}"
                )
                n += 1
        ctx.panel.state.alt_quads = quads
        ctx.panel.state.alt_crops = crops
        ctx.panel.state.alt_labels = labels
        ctx.panel.state.saved_line = (
            f"🔍 {n_found} boundaries from {len(results)} models (panel only)"
        )

    def on_alt_overlay(self, ctx):
        """Explicitly draw the last alt-detect boundaries on the image as the
        `alt_boundaries` overlay field."""
        sample_id = ctx.current_sample
        quads = ctx.panel.get_state("alt_quads") or []
        if not sample_id or not quads:
            return
        import fiftyone as fo

        sample = ctx.dataset[sample_id]
        sample["alt_boundaries"] = fo.Polylines(polylines=[
            fo.Polyline(
                label=q["label"],
                points=[[(x, y) for x, y in q["quad"]]],
                closed=True,
                filled=False,
            )
            for q in quads
        ])
        sample.save()
        ctx.panel.state.saved_line = (
            "boxes drawn on image (`alt_boundaries` in the sidebar; "
            "re-open the sample if they don't appear)"
        )

    def _use_alt(self, ctx, index):
        """Record which alt boundary fixes this frame's crop. Clicking the
        chosen one again clears it. Stored as fixed_quad_json/-source and
        written to results.json by writeback.py as fixedQuad/fixedQuadSource."""
        import json

        quads = ctx.panel.get_state("alt_quads") or []
        if index >= len(quads) or not ctx.current_sample:
            return
        chosen = quads[index]
        if not chosen.get("quad"):
            return
        self._set_fix(ctx, chosen["quad"], chosen["label"])

    def _pin_fix_crop(self, ctx, sample, quad):
        section = dict(ctx.panel.get_state("crop_section") or {})
        try:
            import sys

            sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
            import cv2
            from PIL import Image

            import alt_detectors

            image = cv2.imread(sample.filepath)
            crop = alt_detectors.warp_quad_crop(image, quad, ordered=True)
            pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            section["fixedcol"] = {"fimg": _data_uri(_scaled(pil, CROP_H))}
        except Exception:
            pass
        ctx.panel.set_state("crop_section", section)

    def _set_fix(self, ctx, quad, label, force=False):
        """Set/toggle the chosen fix boundary and pin its crop. All stored
        quads are TL,TR,BR,BL of the card (manual = click order; models get a
        geometric best-effort ordering), so rotation is just a corner roll."""
        import json
        import sys

        sample = ctx.dataset[ctx.current_sample]
        if not force and ctx.panel.get_state("fixed_source") == label:
            sample["fixed_quad_json"] = None
            sample["fixed_quad_source"] = None
            self._clear_rerun(ctx, sample)
            sample.save()
            _journal(sample)
            ctx.panel.state.fixed_source = None
            ctx.panel.state.saved_line = "boundary fix cleared"
            section = dict(ctx.panel.get_state("crop_section") or {})
            section.pop("fixedcol", None)
            ctx.panel.set_state("crop_section", section)
            return
        if label != "manual":
            sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
            import alt_detectors

            quad = alt_detectors.order_quad(quad)
        sample["fixed_quad_json"] = json.dumps(quad)
        sample["fixed_quad_source"] = label
        self._clear_rerun(ctx, sample)
        sample.save()
        _journal(sample)
        ctx.panel.state.fixed_source = label
        ctx.panel.state.saved_line = f"🛠 fix boundary: **{label}**"
        self._pin_fix_crop(ctx, sample, quad)

    def on_rotate_fix(self, ctx):
        """Rotate the fixed crop 90°: roll which corner counts as the card's
        top-left. Cycles through all four orientations."""
        import json

        sample = ctx.dataset[ctx.current_sample]
        try:
            quad = json.loads(sample["fixed_quad_json"] or "null")
        except Exception:
            quad = None
        if not quad:
            return
        quad = quad[1:] + quad[:1]
        sample["fixed_quad_json"] = json.dumps(quad)
        self._clear_rerun(ctx, sample)
        sample.save()
        _journal(sample)
        self._pin_fix_crop(ctx, sample, quad)
        ctx.panel.state.saved_line = "↻ rotated fixed crop 90°"

    @staticmethod
    def _clear_rerun_state(ctx):
        ctx.panel.state.rerun_cands = {}
        ctx.panel.state.rerun_ids = []
        ctx.panel.state.rerun_sims = []
        ctx.panel.state.rerun_names = []
        ctx.panel.state.rerun_sets = []
        ctx.panel.state.rerun_collectors = []
        ctx.panel.state.rerun_game = None
        ctx.panel.state.rerun_source = None

    def _clear_rerun(self, ctx, sample):
        """A persisted re-run belongs to one exact boundary; any boundary
        change invalidates it. Caller saves the sample."""
        if sample.has_field("rerun_top5_json") and sample["rerun_top5_json"]:
            sample["rerun_top5_json"] = None
        self._clear_rerun_state(ctx)

    PICK_STEPS = 90
    # Clickable margin beyond the image bounds, so corners of slightly
    # cut-off cards can be placed outside the frame (the warp handles
    # out-of-bounds coords; missing pixels render black in the crop).
    PICK_MARGIN = 0.2

    def _enter_picking(self, ctx, corners, mode):
        from PIL import Image

        sample = ctx.dataset[ctx.current_sample]
        img = Image.open(sample.filepath)
        w0, h0 = img.size
        H = 560
        W = round(H * w0 / h0)
        ctx.panel.state.pick_bg = _data_uri(img.resize((W, H)), quality=72)
        ctx.panel.state.pick_w = W
        ctx.panel.state.pick_h = H
        ctx.panel.state.corners = corners
        ctx.panel.state.pick_mode = mode
        ctx.panel.state.picking = True
        self._update_pick_plot(ctx)

    def on_start_picking(self, ctx):
        """In-panel manual mask: show the frame as a clickable plot and
        collect the four card corners — no Annotate tab required."""
        self._enter_picking(ctx, [], "new")
        ctx.panel.state.saved_line = (
            "✏️ click the CARD's corners in order: top-left → top-right → "
            "bottom-right → bottom-left"
        )

    def on_adjust_corners(self, ctx):
        """Edit the existing fix boundary: each click moves the nearest
        corner; apply when happy."""
        import json

        sample = ctx.dataset[ctx.current_sample]
        try:
            corners = json.loads(sample["fixed_quad_json"] or "null")
        except Exception:
            corners = None
        if not corners:
            return
        self._enter_picking(ctx, [list(p) for p in corners], "adjust")
        ctx.panel.state.saved_line = (
            "✎ click where a corner SHOULD be — the nearest corner moves "
            "there; then apply"
        )

    @staticmethod
    def _normalize_clicked_quad(corners):
        """Make the 4 clicked points a simple (non-crossing) cycle with the
        same handedness as the warp target, keeping the FIRST click as the
        card's top-left. Kills mirrored crops from Z-order or counter-
        clockwise clicking."""
        import math

        first = corners[0]
        cx = sum(p[0] for p in corners) / 4
        cy = sum(p[1] for p in corners) / 4
        pts = sorted(corners, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
        shoelace = sum(
            pts[i][0] * pts[(i + 1) % 4][1] - pts[(i + 1) % 4][0] * pts[i][1]
            for i in range(4)
        )
        if shoelace < 0:
            pts = pts[::-1]
        start = min(
            range(4),
            key=lambda i: (pts[i][0] - first[0]) ** 2 + (pts[i][1] - first[1]) ** 2,
        )
        return pts[start:] + pts[:start]

    def on_apply_corners(self, ctx):
        import fiftyone as fo

        corners = ctx.panel.get_state("corners") or []
        if len(corners) != 4:
            return
        corners = self._normalize_clicked_quad([list(p) for p in corners])
        ctx.panel.state.corners = corners
        ctx.panel.state.picking = False
        sample = ctx.dataset[ctx.current_sample]
        sample["manual_quad"] = fo.Polylines(polylines=[fo.Polyline(
            label="card",
            points=[[(p[0], p[1]) for p in corners]],
            closed=True,
            filled=False,
        )])
        sample.save()
        ctx.panel.state.has_manual = True
        self._set_fix(ctx, corners, "manual", force=True)

    def _update_pick_plot(self, ctx):
        n = self.PICK_STEPS
        m = self.PICK_MARGIN
        grid = [-m + i * (1 + 2 * m) / (n - 1) for i in range(n)]
        heat = {
            "type": "heatmap",
            "z": [[0] * n for _ in range(n)],
            "x": grid,
            "y": grid,
            "opacity": 0.03,
            "showscale": False,
            "hoverinfo": "none",
            "colorscale": [[0, "#000000"], [1, "#000000"]],
        }
        corners = ctx.panel.get_state("corners") or []
        pts = corners + ([corners[0]] if len(corners) == 4 else [])
        outline = {
            "type": "scatter",
            "x": [p[0] for p in pts],
            "y": [p[1] for p in pts],
            "mode": "markers+lines",
            "marker": {"size": 11, "color": "#34c759"},
            "line": {"color": "#34c759", "width": 2},
            "hoverinfo": "none",
        }
        ctx.panel.set_state("corner_plot", [heat, outline])

    def on_plot_click(self, ctx):
        x = ctx.params.get("x")
        y = ctx.params.get("y")
        if x is None or y is None or not ctx.panel.get_state("picking"):
            return
        x, y = float(x), float(y)
        corners = [list(p) for p in ctx.panel.get_state("corners") or []]
        if ctx.panel.get_state("pick_mode") == "adjust":
            nearest = min(
                range(len(corners)),
                key=lambda i: (corners[i][0] - x) ** 2 + (corners[i][1] - y) ** 2,
            )
            corners[nearest] = [x, y]
            ctx.panel.state.corners = corners
            self._update_pick_plot(ctx)
            ctx.panel.state.saved_line = f"✎ moved corner {nearest + 1} — apply when happy"
            return
        corners.append([x, y])
        ctx.panel.state.corners = corners
        if len(corners) >= 4:
            ctx.panel.state.corners = corners[:4]
            self.on_apply_corners(ctx)
        else:
            self._update_pick_plot(ctx)
            ctx.panel.state.saved_line = f"✏️ {len(corners)}/4 corners"

    def on_reset_corners(self, ctx):
        ctx.panel.state.corners = []
        self._update_pick_plot(ctx)
        ctx.panel.state.saved_line = "✏️ corners reset — click 4 again"

    def on_cancel_picking(self, ctx):
        ctx.panel.state.picking = False
        ctx.panel.state.corners = []
        ctx.panel.state.saved_line = "corner picking cancelled"

    def on_seed_manual(self, ctx):
        """One-click start for a manual mask: seed `manual_quad` with the best
        boundary we already know (saved fix > pipeline quad > centered rect),
        so the Annotate tab becomes drag-4-corners instead of draw-from-
        scratch. (FiftyOne exposes no op to enter drawing mode directly.)"""
        import json

        import fiftyone as fo

        sample = ctx.dataset[ctx.current_sample]
        quad = None
        try:
            quad = json.loads(sample["fixed_quad_json"] or "null")
        except Exception:
            pass
        if quad is None:
            try:
                lines = sample["detection_quads"].polylines
                decisive = next((l for l in lines if l.label == "decisive"), None)
                if decisive and decisive.points:
                    quad = [list(p) for p in decisive.points[0]]
            except Exception:
                pass
        if quad is None:
            quad = [[0.2, 0.15], [0.8, 0.15], [0.8, 0.85], [0.2, 0.85]]
        sample["manual_quad"] = fo.Polylines(polylines=[fo.Polyline(
            label="card",
            points=[[(float(x), float(y)) for x, y in quad]],
            closed=True,
            filled=False,
        )])
        sample.save()
        ctx.panel.state.has_manual = True
        ctx.panel.state.saved_line = (
            "✏️ seeded `manual_quad` — Annotate tab: drag its corners onto the "
            "card, save, then click 'Use manual quad'"
        )

    def on_use_manual(self, ctx):
        """Use a hand-drawn quad from the Annotate tab (the `manual_quad`
        polylines field) as the fix boundary. 4 vertices are used directly;
        more get a minimum-area-rectangle fit."""
        sample = ctx.dataset[ctx.current_sample]
        try:
            lines = sample["manual_quad"].polylines
        except Exception:
            lines = []
        if not lines or not lines[-1].points or len(lines[-1].points[0]) < 3:
            ctx.panel.state.saved_line = (
                "draw a quad first: Annotate tab → manual_quad → polyline"
            )
            return
        points = [(float(x), float(y)) for x, y in lines[-1].points[0]]
        if len(points) != 4:
            import cv2
            import numpy as np

            rect = cv2.minAreaRect(np.array(points, np.float32))
            points = [tuple(map(float, p)) for p in cv2.boxPoints(rect)]
        points = self._normalize_clicked_quad([list(p) for p in points])
        self._set_fix(ctx, points, "manual")

    def on_use_alt0(self, ctx):
        self._use_alt(ctx, 0)

    def on_use_alt1(self, ctx):
        self._use_alt(ctx, 1)

    def on_use_alt2(self, ctx):
        self._use_alt(ctx, 2)

    def on_use_alt3(self, ctx):
        self._use_alt(ctx, 3)

    def on_use_alt4(self, ctx):
        self._use_alt(ctx, 4)

    def on_use_alt5(self, ctx):
        self._use_alt(ctx, 5)

    def on_use_alt6(self, ctx):
        self._use_alt(ctx, 6)

    def on_use_alt7(self, ctx):
        self._use_alt(ctx, 7)

    def on_use_alt8(self, ctx):
        self._use_alt(ctx, 8)

    def on_use_alt9(self, ctx):
        self._use_alt(ctx, 9)

    def on_rerun_candidates(self, ctx):
        """Re-run the CURRENT encoder + index on the chosen fix boundary's
        crop. Purely additive: recorded device candidates are never modified —
        this answers 'what would the scanner say now, with the right crop?'"""
        import json
        import sys

        sample_id = ctx.current_sample
        if not sample_id:
            return
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import cv2
        from PIL import Image

        import alt_detectors
        import rerun_candidates

        sample = ctx.dataset[sample_id]
        quad = None
        fixed_source = ctx.panel.get_state("fixed_source")
        for q in ctx.panel.get_state("alt_quads") or []:
            if q["label"] == fixed_source:
                quad = q["quad"]
        if quad is None:
            try:
                quad = json.loads(sample["fixed_quad_json"] or "null")
            except Exception:
                quad = None
        if quad is None:
            ctx.panel.state.saved_line = "choose a fix boundary first (🛠)"
            return

        image = cv2.imread(sample.filepath)
        crop = alt_detectors.warp_quad_crop(image, quad, ordered=True)
        pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        try:
            game = sample["game"] or "pokemon"
            cands = rerun_candidates.top_k(pil, 5, game=game)
        except Exception as e:
            ctx.panel.state.saved_line = f"re-run failed: {type(e).__name__}: {e}"
            return

        source = fixed_source or "saved fix"
        # Persist: re-runs must survive sample navigation and app restarts.
        # The quad is stored with the result so a later boundary change can't
        # silently present a stale re-run as current (_set_fix clears it).
        sample["rerun_top5_json"] = json.dumps({
            "game": game,
            "source": source,
            "quad": [[float(x), float(y)] for x, y in quad],
            "cands": [
                {
                    "cardID": c["cardID"],
                    "name": c.get("name"),
                    "setName": c.get("setName"),
                    "collectorNumber": c.get("collectorNumber"),
                    "similarity": float(c["similarity"]),
                }
                for c in cands
            ],
        })
        sample.save()
        _journal(sample)

        self._show_rerun(
            ctx, cands, source, fetch_missing=True, game=game
        )
        ctx.panel.state.saved_line = (
            f"🔁 re-ran current encoder on `{source}` boundary (saved)"
        )

    def _show_rerun(self, ctx, cands, source, fetch_missing, game):
        """Render re-run candidates into panel state from a cands list
        ([{cardID, similarity}]), fetching missing catalog thumbnails only on
        a live re-run (never during a refresh restore)."""
        import sys

        from PIL import Image

        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        import rerun_candidates

        cache_dir = Path(ctx.dataset.info.get("card_cache_dir", "."))
        _, _, cards = rerun_candidates._index(game)
        by_id = {c["cardId"]: c for c in cards if c}
        thumbs = {}
        names = []
        sets = []
        collectors = []
        for i, cand in enumerate(cands):
            cid = cand["cardID"]
            meta = by_id.get(cid) or {}
            names.append(cand.get("name") or meta.get("name"))
            sets.append(cand.get("setName") or meta.get("setName"))
            collectors.append(
                cand.get("collectorNumber") or meta.get("collectorNumber")
            )
            cached = cache_dir / f"{cid.replace('/', '_')}.webp"
            if not cached.exists() and fetch_missing:
                import requests
                url = (by_id.get(cid) or {}).get("imageURL")
                if url:
                    try:
                        resp = requests.get(
                            url,
                            timeout=15,
                            headers={
                                "User-Agent": "TCGer/1.0 (+https://tcger.ahmadjalil.com)",
                                "Accept": "image/*",
                            },
                        )
                        resp.raise_for_status()
                        cached.write_bytes(resp.content)
                    except Exception:
                        pass
            try:
                img = _scaled(Image.open(cached).convert("RGB"), THUMB_H)
            except Exception:
                img = Image.new("RGB", (int(THUMB_H * 0.72), THUMB_H), (60, 60, 65))
            thumbs[f"r{i}"] = {"img": _data_uri(img)}
        ctx.panel.set_state("rerun_cands", thumbs)
        ctx.panel.state.rerun_ids = [c["cardID"] for c in cands]
        ctx.panel.state.rerun_sims = [float(c["similarity"]) for c in cands]
        ctx.panel.state.rerun_names = names
        ctx.panel.state.rerun_sets = sets
        ctx.panel.state.rerun_collectors = collectors
        ctx.panel.state.rerun_game = game
        ctx.panel.state.rerun_source = source

    def _rpick(self, ctx, index):
        ids = ctx.panel.get_state("rerun_ids") or []
        if index >= len(ids):
            return
        cid = ids[index]
        if cid == ctx.panel.get_state("device_id"):
            ctx.panel.state.base = "true"
            ctx.panel.state.corrected_id = ""
        else:
            ctx.panel.state.base = "false"
            ctx.panel.state.corrected_id = cid
        self._apply_current(ctx)
        ctx.panel.state.corrected_id = ""

    def on_rpick0(self, ctx):
        self._rpick(ctx, 0)

    def on_rpick1(self, ctx):
        self._rpick(ctx, 1)

    def on_rpick2(self, ctx):
        self._rpick(ctx, 2)

    def on_rpick3(self, ctx):
        self._rpick(ctx, 3)

    def on_rpick4(self, ctx):
        self._rpick(ctx, 4)

    def on_alt_overlay_clear(self, ctx):
        sample_id = ctx.current_sample
        if not sample_id:
            return
        sample = ctx.dataset[sample_id]
        sample["alt_boundaries"] = None
        sample.save()
        ctx.panel.state.saved_line = "alt boxes removed from image"

    def on_pick0(self, ctx):
        self._pick(ctx, 0)

    def on_pick1(self, ctx):
        self._pick(ctx, 1)

    def on_pick2(self, ctx):
        self._pick(ctx, 2)

    def on_pick3(self, ctx):
        self._pick(ctx, 3)

    def on_pick4(self, ctx):
        self._pick(ctx, 4)

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
        _journal(sample)
        ctx.panel.state.base = None
        ctx.panel.state.margin = False
        ctx.panel.state.saved_corrected = None
        ctx.panel.state.saved_line = "cleared"

    def _render_alt_section(self, ctx, panel):
        """'Fix card box with other models': run alt detectors on demand and
        compare each proposed boundary's warped crop."""
        panel.md("#### Boundary tools", name="alt_label")
        panel.btn(
            "btn_alt_detect",
            label="🔍 Try other detectors on this frame",
            on_click=self.on_alt_detect,
            variant="outlined",
        )
        manual_sel = ctx.panel.get_state("fixed_source") == "manual"
        if ctx.panel.get_state("picking"):
            corners = ctx.panel.get_state("corners") or []
            panel.md(
                f"**✏️ Click the card's corners in order** — top-left → "
                f"top-right → bottom-right → bottom-left ({len(corners)}/4)",
                name="pick_label",
            )
            panel.plot(
                "corner_plot",
                layout={
                    "images": [{
                        "source": ctx.panel.get_state("pick_bg"),
                        "xref": "x", "yref": "y",
                        "x": 0, "y": 0,
                        "sizex": 1, "sizey": 1,
                        "xanchor": "left", "yanchor": "top",
                        "sizing": "stretch", "layer": "below",
                    }],
                    "xaxis": {
                        "range": [-self.PICK_MARGIN, 1 + self.PICK_MARGIN],
                        "visible": False, "fixedrange": True,
                    },
                    "yaxis": {
                        "range": [1 + self.PICK_MARGIN, -self.PICK_MARGIN],
                        "visible": False, "fixedrange": True,
                    },
                    "shapes": [{
                        "type": "rect",
                        "x0": 0, "y0": 0, "x1": 1, "y1": 1,
                        "line": {"color": "#888888", "width": 1, "dash": "dot"},
                    }],
                    "width": ctx.panel.get_state("pick_w") or 420,
                    "height": ctx.panel.get_state("pick_h") or 560,
                    "margin": {"l": 0, "r": 0, "t": 0, "b": 0},
                    "showlegend": False,
                    "paper_bgcolor": "rgba(0,0,0,0)",
                    "plot_bgcolor": "rgba(0,0,0,0)",
                },
                config={"displayModeBar": False, "scrollZoom": False},
                on_click=self.on_plot_click,
            )
            prow = types.Object()
            if ctx.panel.get_state("pick_mode") == "adjust":
                prow.btn("btn_apply_corners", label="✓ apply corners",
                         on_click=self.on_apply_corners, variant="contained")
            else:
                prow.btn("btn_reset_corners", label="reset corners",
                         on_click=self.on_reset_corners, variant="outlined")
            prow.btn("btn_cancel_picking", label="cancel",
                     on_click=self.on_cancel_picking, variant="outlined")
            panel.define_property(
                "pick_row", prow,
                view=types.GridView(orientation="horizontal", gap=1),
            )
        else:
            mrow = types.Object()
            mrow.btn(
                "btn_start_picking",
                label="✏️ Pick corners on image",
                on_click=self.on_start_picking,
                variant="outlined",
            )
            if ctx.panel.get_state("fixed_source"):
                mrow.btn(
                    "btn_adjust_corners",
                    label="✎ adjust corners",
                    on_click=self.on_adjust_corners,
                    variant="outlined",
                )
            if ctx.panel.get_state("has_manual"):
                mrow.btn(
                    "btn_use_manual",
                    label=("● " if manual_sel else "") + "use manual quad",
                    on_click=self.on_use_manual,
                    variant="contained" if manual_sel else "outlined",
                )
            panel.define_property(
                "manual_row", mrow,
                view=types.GridView(orientation="horizontal", gap=1),
            )
        alt_crops = ctx.panel.get_state("alt_crops") or {}
        alt_labels = ctx.panel.get_state("alt_labels") or []
        fixed_source = ctx.panel.get_state("fixed_source")
        alt_quads = ctx.panel.get_state("alt_quads") or []
        if alt_crops:
            outer = types.Object()
            for key in sorted(alt_crops, key=lambda k: int(k[1:])):
                i = int(key[1:])
                col = types.Object()
                col.str("img", view=types.ImageView())
                label = alt_labels[i] if i < len(alt_labels) else "?"
                sel = (
                    i < len(alt_quads)
                    and fixed_source == alt_quads[i]["label"]
                )
                col.md(label + ("  \n🛠 chosen fix" if sel else ""), name="cap")
                if i < len(alt_quads) and alt_quads[i].get("quad"):
                    col.btn(
                        "use",
                        label="● chosen fix" if sel else "use this boundary",
                        on_click=getattr(self, f"on_use_alt{i}"),
                        variant="contained" if sel else "outlined",
                    )
                outer.define_property(
                    f"b{i}", col,
                    view=types.GridView(orientation="vertical", gap=0),
                )
            panel.define_property(
                "alt_crops", outer,
                view=types.GridView(orientation="horizontal", gap=1),
            )
            actions = types.Object()
            actions.btn("btn_alt_overlay", label="Draw boxes on image",
                        on_click=self.on_alt_overlay, variant="outlined")
            actions.btn("btn_alt_overlay_clear", label="Remove boxes",
                        on_click=self.on_alt_overlay_clear, variant="outlined")
            panel.define_property(
                "alt_actions", actions,
                view=types.GridView(orientation="horizontal", gap=1),
            )
        elif fixed_source:
            panel.md(f"🛠 chosen fix boundary: **{fixed_source}** "
                     "(re-run 🔍 to change)", name="fixed_note")

        if fixed_source:
            panel.btn(
                "btn_rerun",
                label="🔁 Re-run candidates on fix boundary",
                on_click=self.on_rerun_candidates,
                variant="outlined",
            )
        rerun = ctx.panel.get_state("rerun_cands") or {}
        rerun_ids = ctx.panel.get_state("rerun_ids") or []
        rerun_sims = ctx.panel.get_state("rerun_sims") or []
        rerun_names = ctx.panel.get_state("rerun_names") or []
        rerun_sets = ctx.panel.get_state("rerun_sets") or []
        rerun_collectors = ctx.panel.get_state("rerun_collectors") or []
        if rerun:
            src = ctx.panel.get_state("rerun_source")
            rerun_game = ctx.panel.get_state("rerun_game") or "pokemon"
            game_label = "Magic" if rerun_game == "magic" else "Pokémon"
            panel.md(
                f"**Re-run candidates** — {game_label} encoder and index on "
                "the fixed crop"
                + (f" (`{src}`)" if src else "")
                + "; recorded device data untouched · saved with the sample",
                name="rerun_label",
            )
            base = ctx.panel.get_state("base")
            device_id = ctx.panel.get_state("device_id")
            saved_corrected = ctx.panel.get_state("saved_corrected")
            picked = saved_corrected if base == "false" \
                else (device_id if base == "true" else None)
            outer = types.Object()
            for key in sorted(rerun, key=lambda k: int(k[1:])):
                i = int(key[1:])
                if i >= len(rerun_ids):
                    continue
                cid = rerun_ids[i]
                sel = cid == picked
                col = types.Object()
                col.str("img", view=types.ImageView())
                sim = f"{rerun_sims[i]:.3f}" if i < len(rerun_sims) else "?"
                name = rerun_names[i] if i < len(rerun_names) else None
                set_name = rerun_sets[i] if i < len(rerun_sets) else None
                collector = (
                    rerun_collectors[i]
                    if i < len(rerun_collectors)
                    else None
                )
                cap = f"**{name or 'Unknown card'}** · {sim}"
                printing = " · ".join(filter(None, [
                    set_name,
                    f"#{collector}" if collector else None,
                ]))
                if printing:
                    cap += f"  \n{printing}"
                cap += f"  \n`{cid}`"
                if cid == device_id:
                    cap += "  \n🟢 scanner pick"
                col.md(cap, name="cap")
                col.btn(
                    "pick",
                    label="● selected" if sel else "select",
                    on_click=getattr(self, f"on_rpick{i}"),
                    variant="contained" if sel else "outlined",
                )
                outer.define_property(
                    f"r{i}", col,
                    view=types.GridView(orientation="vertical", gap=0),
                )
            panel.define_property(
                "rerun_cands", outer,
                view=types.GridView(orientation="horizontal", gap=1),
            )

    def render(self, ctx):
        panel = types.Object()
        panel.md(ctx.panel.get_state("header") or "", name="header")

        auto = bool(ctx.panel.get_state("auto_confirm"))
        auto_count = ctx.panel.get_state("auto_count") or 0
        panel.btn(
            "btn_auto",
            label=f"Auto-confirm: {'ON' if auto else 'OFF'}"
            + (f" ({auto_count} confirmed)" if auto_count else ""),
            on_click=self.on_toggle_auto,
            variant="contained" if auto else "outlined",
        )
        if auto:
            panel.md(
                "_Moving to the next frame marks this one ✓ correct — only "
                "click when something is wrong._",
                name="auto_note",
            )

        n_pockets = ctx.panel.get_state("n_pockets") or 0
        if n_pockets:
            page = ctx.panel.get_state("binder_page") or {}
            if page:
                panel.md("### 1 — Binder page overview", name="page_overview_label")
                page_view = types.Object()
                page_view.str("img", view=types.ImageView())
                panel.define_property(
                    "binder_page",
                    page_view,
                    view=types.GridView(orientation="vertical", gap=0),
                )
                panel.md(
                    "_Use the full page to check placement and ordering before "
                    "reviewing individual pockets._",
                    name="page_overview_note",
                )

            crops = ctx.panel.get_state("pocket_crops") or {}
            if crops:
                panel.md(
                    f"### 2 — Pocket map ({n_pockets} detected)",
                    name="carve_label",
                )
                strip = types.Object()
                for key in sorted(crops, key=lambda k: int(k[1:])):
                    strip.str(key, view=types.ImageView())
                panel.define_property(
                    "pocket_crops", strip,
                    view=types.GridView(orientation="horizontal", gap=1),
                )

            focus_index = ctx.panel.get_state("focus_pocket_index") or 0
            jump = types.Object()
            for i in range(n_pockets):
                jump.btn(
                    f"p{i}",
                    label=("● " if i == focus_index else "") + str(i + 1),
                    on_click=self.on_binder_jump,
                    params={"pocket_index": i},
                    variant="contained" if i == focus_index else "outlined",
                )
            panel.define_property(
                "binder_jump",
                jump,
                view=types.GridView(orientation="horizontal", gap=1),
            )

            panel.md("### 3 — Focused pocket", name="focus_label")
            navigation = types.Object()
            navigation.btn(
                "previous",
                label="← Previous",
                on_click=self.on_binder_previous,
                disabled=focus_index <= 0,
                variant="outlined",
            )
            navigation.md(
                ctx.panel.get_state("focus_pocket_label") or "",
                name="current",
            )
            navigation.btn(
                "next",
                label="Next →",
                on_click=self.on_binder_next,
                disabled=focus_index >= n_pockets - 1,
                variant="outlined",
            )
            panel.define_property(
                "binder_navigation",
                navigation,
                view=types.GridView(orientation="horizontal", gap=1),
            )

            focus_crop = ctx.panel.get_state("focus_pocket_crop") or {}
            if focus_crop:
                focused = types.Object()
                focused.str("img", view=types.ImageView())
                panel.define_property(
                    "focus_pocket_crop",
                    focused,
                    view=types.GridView(orientation="vertical", gap=0),
                )

            focus_base = ctx.panel.get_state("focus_label_base")
            focus_margin = bool(ctx.panel.get_state("focus_label_margin"))
            focus_has_label = bool(ctx.panel.get_state("focus_has_label"))
            matched_id = ctx.panel.get_state("focus_matched_id")
            identity = types.Object()
            identity.btn(
                "correct",
                label=("● " if focus_base == "true" else "")
                + "✓ Recorded match correct",
                on_click=self.on_binder_correct,
                disabled=not bool(matched_id),
                variant="contained" if focus_base == "true" else "outlined",
            )
            identity.btn(
                "no_card",
                label=("● " if focus_base == "no_card" else "") + "∅ No card",
                on_click=self.on_binder_no_card,
                variant="contained" if focus_base == "no_card" else "outlined",
            )
            panel.define_property(
                "binder_identity",
                identity,
                view=types.GridView(orientation="horizontal", gap=1),
            )

            crop_quality = types.Object()
            crop_quality.btn(
                "ok",
                label=("● " if focus_has_label and not focus_margin else "")
                + "Crop OK",
                on_click=self.on_binder_crop_ok,
                variant=(
                    "contained" if focus_has_label and not focus_margin else "outlined"
                ),
            )
            crop_quality.btn(
                "margin",
                label=("● " if focus_margin else "") + "Needs crop edit",
                on_click=self.on_binder_crop_margin,
                variant="contained" if focus_margin else "outlined",
            )
            panel.define_property(
                "binder_crop_quality",
                crop_quality,
                view=types.GridView(orientation="horizontal", gap=1),
            )

            candidates = ctx.panel.get_state("focus_candidates") or {}
            candidate_ids = ctx.panel.get_state("focus_candidate_ids") or []
            candidate_sims = ctx.panel.get_state("focus_candidate_sims") or []
            candidate_names = ctx.panel.get_state("focus_candidate_names") or []
            candidate_sets = ctx.panel.get_state("focus_candidate_sets") or []
            candidate_collectors = (
                ctx.panel.get_state("focus_candidate_collectors") or []
            )
            saved_corrected = ctx.panel.get_state("focus_saved_corrected")
            if candidates:
                panel.md(
                    "**Recorded candidates for this pocket** — choose the true "
                    "card to save a correction",
                    name="recog_label",
                )
                row = types.Object()
                for key in sorted(candidates, key=lambda value: int(value[1:])):
                    i = int(key[1:])
                    if i >= len(candidate_ids):
                        continue
                    card_id = candidate_ids[i]
                    column = types.Object()
                    column.str("img", view=types.ImageView())
                    similarity = (
                        f"{candidate_sims[i]:.3f}" if i < len(candidate_sims) else "?"
                    )
                    name = candidate_names[i] if i < len(candidate_names) else None
                    set_name = candidate_sets[i] if i < len(candidate_sets) else None
                    collector = (
                        candidate_collectors[i]
                        if i < len(candidate_collectors)
                        else None
                    )
                    caption = f"**{name or 'Unknown card'}** · {similarity}"
                    printing = " · ".join(filter(None, [
                        set_name,
                        f"#{collector}" if collector else None,
                    ]))
                    if printing:
                        caption += f"  \n{printing}"
                    caption += f"  \n`{card_id}`"
                    if card_id == matched_id:
                        caption += "  \n🟢 recorded match"
                    selected = (
                        (focus_base == "true" and card_id == matched_id)
                        or (focus_base == "false" and card_id == saved_corrected)
                    )
                    if selected:
                        caption += "  \n✅ human truth"
                    column.md(caption, name="caption")
                    column.btn(
                        "pick",
                        label="● selected" if selected else "select as truth",
                        on_click=self.on_binder_candidate_pick,
                        params={"candidate_index": i},
                        variant="contained" if selected else "outlined",
                    )
                    row.define_property(
                        key,
                        column,
                        view=types.GridView(orientation="vertical", gap=0),
                    )
                panel.define_property(
                    "focus_candidates",
                    row,
                    view=types.GridView(orientation="horizontal", gap=1),
                )
            else:
                panel.md(
                    "_No recorded candidates for this pocket._",
                    name="no_focus_candidates",
                )

            panel.md(
                "**Not in the candidates? Search this game's exact-print library.**",
                name="binder_library_search_label",
            )
            panel.str(
                "binder_library_query",
                label="Card name, set, collector number, or card ID",
            )
            panel.btn(
                "btn_binder_library_search",
                label="Search card library",
                on_click=self.on_binder_library_search,
                variant="outlined",
            )
            binder_library_status = (
                ctx.panel.get_state("binder_library_status") or ""
            )
            if binder_library_status:
                panel.md(binder_library_status, name="binder_library_status_md")
            binder_library_results = (
                ctx.panel.get_state("binder_library_results") or {}
            )
            binder_library_ids = ctx.panel.get_state("binder_library_ids") or []
            binder_library_names = (
                ctx.panel.get_state("binder_library_names") or []
            )
            binder_library_sets = (
                ctx.panel.get_state("binder_library_sets") or []
            )
            binder_library_collectors = (
                ctx.panel.get_state("binder_library_collectors") or []
            )
            if binder_library_results:
                search_grid = types.Object()
                for key in sorted(
                    binder_library_results, key=lambda value: int(value[1:])
                ):
                    i = int(key[1:])
                    if i >= len(binder_library_ids):
                        continue
                    card_id = binder_library_ids[i]
                    name = (
                        binder_library_names[i]
                        if i < len(binder_library_names)
                        else None
                    )
                    set_name = (
                        binder_library_sets[i]
                        if i < len(binder_library_sets)
                        else None
                    )
                    collector = (
                        binder_library_collectors[i]
                        if i < len(binder_library_collectors)
                        else None
                    )
                    selected = (
                        (focus_base == "true" and card_id == matched_id)
                        or (focus_base == "false" and card_id == saved_corrected)
                    )
                    column = types.Object()
                    column.str("img", view=types.ImageView())
                    caption = f"**{name or 'Unknown card'}**"
                    printing = " · ".join(filter(None, [
                        set_name,
                        f"#{collector}" if collector else None,
                    ]))
                    if printing:
                        caption += f"  \n{printing}"
                    caption += f"  \n`{card_id}`"
                    column.md(caption, name="caption")
                    column.btn(
                        "pick",
                        label="● selected" if selected else "select as truth",
                        on_click=self.on_binder_library_pick,
                        params={"result_index": i},
                        variant="contained" if selected else "outlined",
                    )
                    search_grid.define_property(
                        key,
                        column,
                        view=types.GridView(orientation="vertical", gap=0),
                    )
                panel.define_property(
                    "binder_library_results",
                    search_grid,
                    view=types.GridView(orientation="horizontal", gap=1),
                )

            saved_line = ctx.panel.get_state("focus_saved_line") or ""
            if saved_line:
                panel.md(f"**Saved pocket label:** {saved_line}", name="pocket_saved")
                panel.btn(
                    "btn_clear_binder_label",
                    label="Clear this pocket label",
                    on_click=self.on_binder_clear_label,
                    variant="outlined",
                )

            labels = ctx.panel.get_state("pocket_labels") or []
            if labels:
                panel.md(
                    "**All recorded pocket outcomes**  \n" + "  \n".join(labels),
                    name="all_pocket_outcomes",
                )

            panel.md(
                "_Pocket navigation only changes this review panel; the "
                "recorded device page, crops, and candidates remain unchanged. "
                "Human pocket labels are stored separately and journaled._",
                name="binder_note",
            )
            panel.btn(
                "btn_binder_rescan",
                label="🔁 Re-scan page (webobb+sam)",
                on_click=self.on_binder_rescan,
                variant="outlined",
            )
            rescan = ctx.panel.get_state("rescan_crops") or {}
            if rescan:
                panel.md(
                    "### 4 — Page re-scan (webobb+sam, current encoder) — "
                    "green = would accept; recorded pockets untouched",
                    name="rescan_label",
                )
                strip = types.Object()
                for key in sorted(rescan, key=lambda k: int(k[1:])):
                    strip.str(key, view=types.ImageView())
                panel.define_property(
                    "rescan_crops", strip,
                    view=types.GridView(orientation="horizontal", gap=1),
                )
            self._render_alt_section(ctx, panel)
            saved = ctx.panel.get_state("saved_line") or ""
            if saved:
                panel.md(saved, name="saved_line_md")
            return types.Property(
                panel, view=types.GridView(gap=2, align_x="left", orientation="vertical")
            )

        has_crop = bool(ctx.panel.get_state("crop_img"))
        margin = bool(ctx.panel.get_state("margin"))

        def crop_quality(obj):
            obj.md("**Crop quality**", name="crop_quality_label")
            obj.btn(
                "btn_crop_ok",
                label=("● " if not margin else "") + "Crop OK",
                on_click=self.on_crop_ok,
                variant="contained" if not margin else "outlined",
            )
            obj.btn(
                "btn_crop_margin",
                label=("● " if margin else "") + "Needs margin edit",
                on_click=self.on_crop_margin,
                variant="outlined" if not margin else "contained",
            )

        if has_crop:
            panel.md("**Pipeline crop**", name="crop_label")
            section = types.Object()
            section.str("img", view=types.ImageView())
            section_state = ctx.panel.get_state("crop_section") or {}
            if section_state.get("fixedcol"):
                fcol = types.Object()
                fcol.str("fimg", view=types.ImageView())
                fcol.md(
                    f"🛠 fixed — {ctx.panel.get_state('fixed_source') or ''}",
                    name="fcap",
                )
                fcol.btn("btn_rotate_fix", label="↻ rotate",
                         on_click=self.on_rotate_fix, variant="outlined")
                section.define_property(
                    "fixedcol", fcol,
                    view=types.GridView(orientation="vertical", gap=0),
                )
            quality = types.Object()
            crop_quality(quality)
            section.define_property(
                "quality", quality,
                view=types.GridView(orientation="vertical", gap=1),
            )
            panel.define_property(
                "crop_section", section,
                view=types.GridView(orientation="horizontal", gap=2),
            )
            if margin or ctx.panel.get_state("fixed_source") or ctx.panel.get_state("has_manual"):
                self._render_alt_section(ctx, panel)

        base = ctx.panel.get_state("base")
        margin = bool(ctx.panel.get_state("margin"))
        device_id = ctx.panel.get_state("device_id")
        saved_corrected = ctx.panel.get_state("saved_corrected")
        picked = saved_corrected if base == "false" \
            else (device_id if base == "true" else None)

        cands = ctx.panel.get_state("cands") or {}
        pick_ids = ctx.panel.get_state("pick_ids") or []
        pick_sims = ctx.panel.get_state("pick_sims") or []
        pick_names = ctx.panel.get_state("pick_names") or []
        pick_sets = ctx.panel.get_state("pick_sets") or []
        pick_collectors = ctx.panel.get_state("pick_collectors") or []
        if cands:
            panel.md("**Top-5 candidates** — select the true card, or "
                     "'None of these'", name="cand_label")
            outer = types.Object()
            for i, cid in enumerate(pick_ids):
                if f"c{i}" not in cands:
                    continue
                sel = cid == picked
                scanner = cid == device_id
                col = types.Object()
                col.str("img", view=types.ImageView())
                sim = f"{pick_sims[i]:.3f}" if i < len(pick_sims) else "?"
                name = pick_names[i] if i < len(pick_names) else None
                set_name = pick_sets[i] if i < len(pick_sets) else None
                collector = pick_collectors[i] if i < len(pick_collectors) else None
                caption = f"**{name or 'Unknown card'}** · {sim}"
                printing = " · ".join(filter(None, [
                    set_name,
                    f"#{collector}" if collector else None,
                ]))
                if printing:
                    caption += f"  \n{printing}"
                caption += f"  \n`{cid}`"
                if scanner:
                    caption += "  \n🟢 scanner pick"
                col.md(caption, name="cap")
                col.btn(
                    "pick",
                    label="● selected" if sel else "select",
                    on_click=getattr(self, f"on_pick{i}"),
                    variant="contained" if sel else "outlined",
                )
                outer.define_property(
                    f"c{i}", col,
                    view=types.GridView(orientation="vertical", gap=0),
                )
            panel.define_property(
                "cands", outer,
                view=types.GridView(orientation="horizontal", gap=1),
            )
            if base is None and device_id:
                panel.md(
                    "_No verdict yet — the 🟢 scanner pick is presumed right. "
                    "Confirm with ✓ Correct (or select it), or pick the true "
                    "card._",
                    name="assumed_note",
                )
            none_sel = base == "false" and (
                not saved_corrected or saved_corrected not in pick_ids
            )
            panel.btn(
                "btn_none_of_these",
                label=("● " if none_sel else "") + "None of these (type the ID below)",
                on_click=self.on_none_of_these,
                variant="contained" if none_sel else "outlined",
            )

        panel.md("#### Card identity", name="identity_label")
        row = types.Object()
        for btn, value, label in (
            ("btn_true", "true", "✓ Correct"),
            ("btn_false", "false", "✗ Wrong card"),
            ("btn_no_card", "no_card", "∅ No card"),
        ):
            sel = base == value
            row.btn(
                btn,
                label=("● " if sel else "") + label,
                on_click={"btn_true": self.on_correct,
                          "btn_false": self.on_wrong,
                          "btn_no_card": self.on_no_card}[btn],
                variant="contained" if sel else "outlined",
            )
        panel.define_property(
            "identity_row", row, view=types.GridView(orientation="horizontal", gap=1)
        )
        panel.md(
            "**Not in the candidates? Search this game's exact-print library.**",
            name="library_search_label",
        )
        panel.str(
            "library_query",
            label="Card name, set, collector number, or card ID",
        )
        panel.btn(
            "btn_library_search",
            label="Search card library",
            on_click=self.on_library_search,
            variant="outlined",
        )
        library_status = ctx.panel.get_state("library_status") or ""
        if library_status:
            panel.md(library_status, name="library_status_md")
        library_results = ctx.panel.get_state("library_results") or {}
        library_ids = ctx.panel.get_state("library_ids") or []
        library_names = ctx.panel.get_state("library_names") or []
        library_sets = ctx.panel.get_state("library_sets") or []
        library_collectors = ctx.panel.get_state("library_collectors") or []
        if library_results:
            search_grid = types.Object()
            for key in sorted(library_results, key=lambda value: int(value[1:])):
                index = int(key[1:])
                if index >= len(library_ids):
                    continue
                card_id = library_ids[index]
                name = library_names[index] if index < len(library_names) else None
                set_name = library_sets[index] if index < len(library_sets) else None
                collector = (
                    library_collectors[index]
                    if index < len(library_collectors)
                    else None
                )
                selected = card_id == saved_corrected
                column = types.Object()
                column.str("img", view=types.ImageView())
                caption = f"**{name or 'Unknown card'}**"
                printing = " · ".join(filter(None, [
                    set_name,
                    f"#{collector}" if collector else None,
                ]))
                if printing:
                    caption += f"  \n{printing}"
                caption += f"  \n`{card_id}`"
                column.md(caption, name="cap")
                column.btn(
                    "pick",
                    label="● selected" if selected else "select as truth",
                    on_click=getattr(self, f"on_library_pick{index}"),
                    variant="contained" if selected else "outlined",
                )
                search_grid.define_property(
                    key,
                    column,
                    view=types.GridView(orientation="vertical", gap=0),
                )
            panel.define_property(
                "library_results",
                search_grid,
                view=types.GridView(orientation="horizontal", gap=1),
            )
        panel.str("corrected_id",
                  label="Or enter the exact card ID directly (e.g. me05-043)")

        if not has_crop:
            standalone = types.Object()
            crop_quality(standalone)
            panel.define_property(
                "crop_quality_standalone", standalone,
                view=types.GridView(orientation="horizontal", gap=1),
            )
            if margin or ctx.panel.get_state("fixed_source") or ctx.panel.get_state("has_manual"):
                self._render_alt_section(ctx, panel)

        saved = ctx.panel.get_state("saved_line") or ""
        if saved:
            panel.md(saved, name="saved_line_md")
        panel.btn("btn_clear", label="Clear verdict", on_click=self.on_clear)
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
