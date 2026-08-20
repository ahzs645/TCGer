"""FiftyOne operators for TCGer's scanner review workflow."""

from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path

import fiftyone as fo
import fiftyone.operators as foo
import fiftyone.operators.types as types


def _run_suffixes(ctx):
    return [
        item["field"].removeprefix("pred_")
        for item in (ctx.dataset.info or {}).get("tcger_model_runs", [])
    ]


def _image_data_uri(path_value):
    path = Path(path_value or "")
    if not path.is_file():
        return ""
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _percentile(values, quantile):
    ordered = sorted(float(value) for value in values if value is not None)
    if not ordered:
        return None
    return ordered[min(len(ordered) - 1, int(len(ordered) * quantile))]


def _format_ms(value):
    return "unavailable" if value is None else f"{value:,.0f} ms"


def _shutter_verdict(expected_card_id, expected_no_match, identified_card_id):
    if expected_no_match:
        return "correct_decline" if not identified_card_id else "false_positive"
    if expected_card_id:
        if not identified_card_id:
            return "missed"
        return "correct" if identified_card_id == expected_card_id else "wrong"
    return "unscored"


def _json_list(value):
    try:
        decoded = json.loads(value or "[]")
    except (TypeError, ValueError):
        return []
    return decoded if isinstance(decoded, list) else []


class ShowShutterBenchmark(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="show_shutter_benchmark",
            label="TCGer: shutter accuracy and speed",
            description="Summarize labelled accuracy and end-to-end photo-capture latency",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        inputs.int(
            "latency_budget_ms",
            default=1_000,
            min=100,
            max=5_000,
            label="Responsiveness target (milliseconds)",
        )
        return types.Property(inputs, view=types.View(label="Shutter benchmark"))

    def execute(self, ctx):
        budget = int(ctx.params.get("latency_budget_ms") or 1_000)
        schema = ctx.dataset.get_field_schema()
        if "is_shutter_capture" not in schema:
            return {"summary": "This is not a TCGer shutter benchmark dataset."}
        latencies = [value for value in ctx.dataset.values("elapsed_ms") if value is not None]
        selected = ctx.dataset.match(fo.ViewField("benchmark_selected") == True)  # noqa: E712
        labelled = ctx.dataset.match(
            fo.ViewField("benchmark_accuracy_eligible") == True  # noqa: E712
        )
        hard_cases = ctx.dataset.match(
            fo.ViewField("truth_provenance") == "ios_manual_correction"
        )
        correct = len(labelled.match(fo.ViewField("prediction_correct") == True))  # noqa: E712
        labelled_with_latency = labelled.exists("elapsed_ms")
        within_budget = len(
            labelled_with_latency.match(
                (fo.ViewField("prediction_correct") == True)  # noqa: E712
                & (fo.ViewField("elapsed_ms") <= budget)
            )
        )
        slow = len(ctx.dataset.match(fo.ViewField("elapsed_ms") > budget))
        attempt_hotspots = len(ctx.dataset.match(fo.ViewField("attempt_count") >= 4))
        summary = (
            f"### Shutter benchmark\n\n"
            f"- **Captures:** {len(ctx.dataset):,}\n"
            f"- **Frozen benchmark queue:** {len(selected):,} captures\n"
            f"- **Benchmark labels complete:** {len(labelled):,}/{len(selected):,} "
            f"({len(labelled) / max(1, len(selected)):.1%})\n"
            f"- **Exact benchmark accuracy:** "
            f"{f'{correct}/{len(labelled)} ({correct / len(labelled):.1%})' if len(labelled) else 'pending labels'}\n"
            f"- **Existing correction-only hard cases:** {len(hard_cases):,} "
            "(excluded from headline accuracy)\n"
            f"- **End-to-end latency:** p50 {_format_ms(_percentile(latencies, 0.50))}, "
            f"p90 {_format_ms(_percentile(latencies, 0.90))}, "
            f"p95 {_format_ms(_percentile(latencies, 0.95))}\n"
            f"- **Correct and within {budget:,} ms:** {within_budget}/{len(labelled_with_latency)}\n"
            f"- **All captures over target:** {slow}/{len(latencies)}\n"
            f"- **Four-or-more-attempt hotspots:** {attempt_hotspots}/{len(ctx.dataset)}\n\n"
            "Accuracy uses only the outcome-independent frozen queue and excludes "
            "unlabelled and correction-selected captures. Latency is the recorded iOS "
            "end-to-end shutter/coordinator time, not an offline model-only benchmark."
        )
        return {"summary": summary}

    def resolve_output(self, ctx):
        outputs = types.Object()
        outputs.str("summary", label="Accuracy and efficiency", view=types.MarkdownView())
        return types.Property(outputs, view=types.View(label="Shutter benchmark"))


class ShowShutterEvidence(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="show_shutter_evidence",
            label="TCGer: show selected shutter evidence",
            description="Show a single rectified card or every detected binder pocket",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        if len(ctx.selected) != 1:
            warning = inputs.view(
                "warning", types.Warning(label="Select exactly one shutter capture first")
            )
            warning.invalid = True
        return types.Property(inputs, view=types.View(label="Shutter evidence"))

    def execute(self, ctx):
        sample = ctx.dataset[ctx.selected[0]]
        if sample.get_field("capture_mode") == "binder_page":
            cards = _json_list(sample.get_field("binder_cards_json"))
            lines = [
                "### Binder-page recognition",
                "",
                f"**{len(cards)} pockets detected** — "
                f"{sample.get_field('binder_matched_count') or 0} matched, "
                f"{sample.get_field('binder_uncertain_count') or 0} uncertain, "
                f"{sample.get_field('binder_unmatched_count') or 0} unmatched.",
                f"**Page result:** {'outlined on the original' if sample.get_field('binder_page_result_available') else 'not recoverable'}; "
                f"**located pocket overlays:** {sample.get_field('binder_overlay_count') or 0}/{len(cards)}.",
                "",
                "| Pocket | Scanner status | Predicted card | Confidence |",
                "|---:|---|---|---:|",
            ]
            result = {"original": _image_data_uri(sample.filepath)}
            for index, card in enumerate(cards[:12]):
                confidence = card.get("confidence")
                lines.append(
                    f"| {int(card.get('pocket_index') or 0) + 1} | "
                    f"{card.get('status') or 'unmatched'} | "
                    f"{card.get('card_name') or 'No accepted identity'} "
                    f"[{card.get('card_id') or 'no ID'}] | "
                    f"{f'{float(confidence):.1%}' if confidence is not None else '—'} |"
                )
                result[f"binder_card_{index + 1}"] = _image_data_uri(
                    card.get("rectified_filepath")
                )
            lines.extend(
                [
                    "",
                    "Toggle `binder_page_result` for the fitted page outline, "
                    "`binder_regions` for filled pockets, `binder_region_outlines` for "
                    "outline-only quads, or `binder_corner_points` for corner dots. "
                    "Rectified crops are linked "
                    "evidence, not separate dataset rows. Use **TCGer: label/correct one binder pocket** to add "
                    "human truth without assigning one identity to the whole page.",
                ]
            )
            result["summary"] = "\n".join(lines)
            return result
        candidates = sample.get_field("candidates_json") or "[]"
        try:
            candidate_text = json.dumps(json.loads(candidates), indent=2, ensure_ascii=False)
        except (TypeError, ValueError):
            candidate_text = str(candidates)
        summary = (
            f"### Scanner decision\n\n"
            f"- **Predicted:** {sample.get_field('identified_card_name') or 'declined'} "
            f"[{sample.get_field('identified_card_id') or 'no ID'}]\n"
            f"- **Human truth:** {sample.get_field('expected_card_id') or ('no match' if sample.get_field('expected_no_match') else 'not labelled')}\n"
            f"- **Verdict:** {sample.get_field('prediction_verdict') or 'unscored'}\n"
            f"- **Elapsed:** {_format_ms(sample.get_field('elapsed_ms'))}\n"
            f"- **Attempts:** {sample.get_field('attempt_count') or 0}\n"
            f"- **OCR title:** {sample.get_field('title_ocr_names_json') or '[]'}\n"
            f"- **OCR footer:** {sample.get_field('footer_ocr_pairs_json') or '[]'}\n"
            f"- **OCR-confirmed number:** {sample.get_field('ocr_verified_numbers_json') or '[]'}\n\n"
            f"### Assisted suggestion — confirm or change\n\n"
            f"- **Content:** {sample.get_field('assisted_category') or 'not suggested'}\n"
            f"- **Likely card:** {sample.get_field('assisted_card_name') or 'unknown'} "
            f"[{sample.get_field('assisted_printing_id') or 'printing not confirmed'}]\n"
            f"- **Evidence:** {sample.get_field('assisted_source') or 'none'}\n"
            f"- **Why:** {sample.get_field('assisted_explanation') or 'No assisted explanation'}\n\n"
            f"#### Top candidates\n\n```json\n{candidate_text}\n```"
        )
        return {
            "original": _image_data_uri(sample.filepath),
            "rectified": _image_data_uri(sample.get_field("rectified_filepath")),
            "summary": summary,
        }

    def resolve_output(self, ctx):
        outputs = types.Object()
        outputs.str("original", label="Full-resolution shutter photo", view=types.ImageView())
        sample = ctx.dataset[ctx.selected[0]] if len(ctx.selected) == 1 else None
        if sample is not None and sample.get_field("capture_mode") == "binder_page":
            cards = _json_list(sample.get_field("binder_cards_json"))
            for index, card in enumerate(cards[:12]):
                pocket = int(card.get("pocket_index") or 0) + 1
                name = card.get("card_name") or card.get("status") or "unmatched"
                outputs.str(
                    f"binder_card_{index + 1}",
                    label=f"Pocket {pocket} rectified — {name}",
                    view=types.ImageView(),
                )
        else:
            outputs.str("rectified", label="Accepted rectified card", view=types.ImageView())
        outputs.str("summary", label="Recognition evidence", view=types.MarkdownView())
        return types.Property(outputs, view=types.View(label="Shutter evidence"))


class LabelBinderPocket(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="label_binder_pocket",
            label="TCGer: label/correct one binder pocket",
            description="Add human truth to one detected pocket without changing source evidence",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        sample = ctx.dataset[ctx.selected[0]] if len(ctx.selected) == 1 else None
        if sample is None or sample.get_field("capture_mode") != "binder_page":
            warning = inputs.view(
                "warning",
                types.Warning(label="Select exactly one binder-page capture first"),
            )
            warning.invalid = True
            return types.Property(inputs, view=types.View(label="Label binder pocket"))

        cards = _json_list(sample.get_field("binder_cards_json"))
        manual = {
            int(item.get("pocket_index")): item
            for item in _json_list(sample.get_field("binder_manual_labels_json"))
            if isinstance(item, dict) and item.get("pocket_index") is not None
        }
        pocket_choices = types.DropdownView()
        for card in cards:
            pocket = int(card.get("pocket_index") or 0)
            name = card.get("card_name") or "No accepted identity"
            pocket_choices.add_choice(str(pocket), label=f"Pocket {pocket + 1} — {name}")
        default_pocket = str(int(cards[0].get("pocket_index") or 0)) if cards else "0"
        inputs.enum(
            "pocket_index",
            pocket_choices.values(),
            default=default_pocket,
            required=True,
            label="Binder pocket",
            view=pocket_choices,
        )
        pocket_index = int(ctx.params.get("pocket_index") or default_pocket)
        predicted = next(
            (item for item in cards if int(item.get("pocket_index") or 0) == pocket_index),
            {},
        )
        existing = manual.get(pocket_index, {})
        kind_choices = types.DropdownView()
        kind_choices.add_choice("exact_printing", label="Pokémon card — exact printing confirmed")
        kind_choices.add_choice("pokemon_unknown_printing", label="Pokémon card — printing unknown")
        kind_choices.add_choice("non_pokemon", label="Not a Pokémon card")
        kind_choices.add_choice("card_back", label="Card back")
        kind_choices.add_choice("empty_pocket", label="Empty / false detection")
        kind_choices.add_choice("needs_label", label="Leave for later")
        default_kind = existing.get("truth_kind") or (
            "exact_printing" if predicted.get("card_id") else "needs_label"
        )
        inputs.enum(
            "truth_kind",
            kind_choices.values(),
            default=default_kind,
            required=True,
            label="Human truth",
            view=kind_choices,
        )
        truth_kind = ctx.params.get("truth_kind") or default_kind
        if truth_kind == "exact_printing":
            inputs.str(
                "card_id",
                default=existing.get("card_id") or predicted.get("card_id") or None,
                required=True,
                label="Exact printing ID",
            )
            inputs.str(
                "card_name",
                default=existing.get("card_name") or predicted.get("card_name") or None,
                label="Card name",
            )
        elif truth_kind == "pokemon_unknown_printing":
            inputs.str(
                "card_name",
                default=existing.get("card_name") or predicted.get("card_name") or None,
                label="Card name if known",
            )
        inputs.str("notes", default=existing.get("notes") or None, label="Review notes")
        return types.Property(inputs, view=types.View(label="Label binder pocket"))

    def execute(self, ctx):
        sample = ctx.dataset[ctx.selected[0]]
        pocket_index = int(ctx.params["pocket_index"])
        truth_kind = ctx.params["truth_kind"]
        record = {
            "pocket_index": pocket_index,
            "truth_kind": truth_kind,
            "card_id": (ctx.params.get("card_id") or "").strip(),
            "card_name": (ctx.params.get("card_name") or "").strip(),
            "notes": (ctx.params.get("notes") or "").strip(),
            "provenance": "fiftyone_manual_review",
        }
        labels = [
            item
            for item in _json_list(sample.get_field("binder_manual_labels_json"))
            if not isinstance(item, dict) or int(item.get("pocket_index", -1)) != pocket_index
        ]
        labels.append(record)
        labels.sort(key=lambda item: int(item.get("pocket_index", -1)))
        sample["binder_manual_labels_json"] = json.dumps(labels, ensure_ascii=False)
        sample["binder_reviewed_count"] = sum(
            item.get("truth_kind") != "needs_label" for item in labels
        )
        regions = sample.get_field("binder_regions")
        for region in regions.polylines if regions else []:
            if region.get_field("pocket_index") == pocket_index:
                region["human_truth_kind"] = truth_kind
                region["human_card_id"] = record["card_id"]
                region["human_card_name"] = record["card_name"]
                region["human_review_notes"] = record["notes"]
        sample.save()
        ctx.trigger("reload_dataset")


class SetScannerOverlayLayers(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="set_scanner_overlay_layers",
            label="TCGer: choose overlay display",
            description="Globally choose filled regions, outlines, corner dots, or any combination",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        current = ctx.dataset.app_config.active_fields
        active = set(current.paths) if current and not current.exclude else set()
        has_custom = bool(current and not current.exclude)
        inputs.bool(
            "show_page_result",
            default="binder_page_result" in active if has_custom else True,
            label="Binder page-result outline",
            description="Outline the scanner's fitted binder-page result on the original photo",
        )
        inputs.bool(
            "show_filled",
            default="binder_regions" in active if has_custom else False,
            label="Filled blue card regions",
        )
        inputs.bool(
            "show_outlines",
            default="binder_region_outlines" in active if has_custom else True,
            label="Blue card outlines",
        )
        inputs.bool(
            "show_corners",
            default="binder_corner_points" in active if has_custom else False,
            label="Card corner dots",
        )
        inputs.view(
            "hint",
            types.Notice(
                label="Choose one display or combine them. This becomes the dataset-wide default."
            ),
        )
        return types.Property(inputs, view=types.View(label="Scanner overlay display"))

    def execute(self, ctx):
        layer_fields = {
            "binder_page_result",
            "binder_regions",
            "binder_region_outlines",
            "binder_corner_points",
        }
        current = ctx.dataset.app_config.active_fields
        if current and not current.exclude:
            base_fields = [path for path in current.paths if path not in layer_fields]
        else:
            base_fields = [
                path
                for path in ctx.dataset.get_field_schema(
                    embedded_doc_type=fo.Label
                ).keys()
                if path not in layer_fields
            ]
        selections = [
            ("show_page_result", "binder_page_result"),
            ("show_filled", "binder_regions"),
            ("show_outlines", "binder_region_outlines"),
            ("show_corners", "binder_corner_points"),
        ]
        active_fields = base_fields + [
            field for parameter, field in selections if bool(ctx.params.get(parameter))
        ]
        ctx.dataset.app_config.active_fields = fo.core.odm.dataset.ActiveFields(
            paths=active_fields,
            exclude=False,
        )
        ctx.dataset.save()
        ctx.trigger("reload_dataset")


class LabelShutterCapture(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="label_shutter_capture",
            label="TCGer: label/correct shutter capture",
            description="Set human truth for selected shutter captures without editing source archives",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        if not ctx.selected:
            warning = inputs.view(
                "warning", types.Warning(label="Select one or more shutter captures first")
            )
            warning.invalid = True
        suggestion = None
        if len(ctx.selected) == 1:
            suggestion = ctx.dataset[ctx.selected[0]]
        suggested_category = suggestion.get_field("assisted_category") if suggestion else ""
        suggested_id = suggestion.get_field("assisted_printing_id") if suggestion else ""
        suggested_name = suggestion.get_field("assisted_card_name") if suggestion else ""
        default_truth_kind = "needs_label"
        if suggested_category == "pokemon_card" and suggested_id:
            default_truth_kind = "single_card"
        elif suggested_category == "pokemon_card":
            default_truth_kind = "pokemon_unknown_printing"
        elif suggested_category == "no_card":
            default_truth_kind = "no_card"
        choices = types.DropdownView()
        choices.add_choice("single_card", label="Pokémon card — exact printing confirmed")
        choices.add_choice("pokemon_unknown_printing", label="Pokémon card — printing not confirmed")
        choices.add_choice("non_pokemon", label="Not a Pokémon card")
        choices.add_choice("no_card", label="No card visible")
        choices.add_choice("no_match", label="Pokémon card outside our index")
        choices.add_choice("card_back", label="Card back")
        choices.add_choice("multi_card", label="Multiple cards")
        choices.add_choice("foreign_language", label="Foreign language")
        choices.add_choice("needs_label", label="Leave for later")
        inputs.enum(
            "truth_kind",
            choices.values(),
            default=default_truth_kind,
            required=True,
            label="Human truth",
            view=choices,
        )
        truth_kind = ctx.params.get("truth_kind") or default_truth_kind
        if truth_kind == "single_card":
            inputs.str(
                "card_id", default=suggested_id or None, label="Exact printing ID", required=True
            )
            inputs.str("card_name", default=suggested_name or None, label="Card name", required=False)
        elif truth_kind == "pokemon_unknown_printing":
            inputs.str(
                "card_name",
                default=suggested_name or None,
                label="Pokémon/card name if known",
                required=False,
            )
        inputs.str("notes", label="Review notes", required=False)
        return types.Property(inputs, view=types.View(label="Label shutter capture"))

    def execute(self, ctx):
        truth_kind = ctx.params["truth_kind"]
        card_id = (ctx.params.get("card_id") or "").strip()
        card_name = (ctx.params.get("card_name") or "").strip()
        notes = (ctx.params.get("notes") or "").strip()
        category_map = {
            "single_card": "singleCard",
            "pokemon_unknown_printing": "singleCard",
            "non_pokemon": "nonPokemon",
            "no_card": "noCard",
            "no_match": "outsideIndex",
            "card_back": "cardBack",
            "multi_card": "multiCard",
            "foreign_language": "foreignLanguage",
            "needs_label": "unlabeled",
        }
        for sample in ctx.dataset.select(ctx.selected):
            has_truth = truth_kind not in {"needs_label", "pokemon_unknown_printing"}
            expected_id = card_id if truth_kind == "single_card" else ""
            expected_no_match = has_truth and truth_kind != "single_card"
            truth_label = expected_id or ("__declined__" if expected_no_match else None)
            verdict = _shutter_verdict(
                expected_id or None,
                expected_no_match,
                sample.get_field("identified_card_id") or None,
            )
            sample["label_category"] = category_map[truth_kind]
            sample["label_card_id"] = expected_id
            sample["label_card_name"] = card_name
            sample["label_notes"] = notes
            sample["expected_card_id"] = expected_id
            sample["expected_no_match"] = expected_no_match if has_truth else None
            sample["human_truth_available"] = has_truth
            sample["truth_provenance"] = "fiftyone_manual_review" if has_truth else ""
            sample["ground_truth_identity"] = (
                fo.Classification(label=truth_label) if truth_label else None
            )
            sample["prediction_verdict"] = verdict
            sample["prediction_correct"] = (
                verdict in {"correct", "correct_decline"} if has_truth else None
            )
            sample["review_status"] = (
                "corrected" if has_truth else ("partially_labelled" if truth_kind == "pokemon_unknown_printing" else "unreviewed")
            )
            assisted_matches = (
                (truth_kind == "single_card" and expected_id == (sample.get_field("assisted_printing_id") or ""))
                or (truth_kind == "no_card" and sample.get_field("assisted_category") == "no_card")
            )
            sample["assisted_review_status"] = (
                "confirmed" if assisted_matches else ("adjusted" if truth_kind != "needs_label" else "suggested")
            )
            benchmark_selected = bool(sample.get_field("benchmark_selected"))
            accuracy_eligible = has_truth and benchmark_selected
            sample["benchmark_accuracy_eligible"] = accuracy_eligible
            sample["recognition_evaluation_eligible"] = accuracy_eligible
            sample["evaluation_role"] = (
                "real_camera_shutter_benchmark" if accuracy_eligible else "labeling_candidate"
            )
            sample.save()
        ctx.trigger("reload_dataset")


class ShowPerformanceDashboard(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="show_performance_dashboard",
            label="TCGer: show analysis dashboard",
            description="Open recognition, decision, geometry, robustness, OCR, or session graphs",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        dashboards = (ctx.dataset.info or {}).get("tcger_dashboards") or {}
        if not dashboards:
            legacy = (ctx.dataset.info or {}).get("tcger_performance_dashboard")
            if legacy:
                dashboards = {"performance": legacy}
        available = {
            name: path for name, path in dashboards.items() if Path(path).is_file()
        }
        if not available:
            warning = inputs.view(
                "warning",
                types.Warning(
                    label="Run `python tools/scanner-review/review.py report` first"
                ),
            )
            warning.invalid = True
        else:
            choices = types.DropdownView()
            labels = {
                "performance": "Performance overview",
                "decision_quality": "Decision quality",
                "geometry": "Geometry and rectification",
                "robustness": "Robustness",
                "ocr_reference": "OCR and reference benchmarks",
                "session_stability": "Real-session stability",
            }
            for name in available:
                choices.add_choice(name, label=labels.get(name, name.replace("_", " ").title()))
            inputs.enum(
                "dashboard_name",
                list(available),
                default=next(iter(available)),
                label="Dashboard",
                view=choices,
            )
        return types.Property(inputs, view=types.View(label="Scanner performance"))

    def execute(self, ctx):
        dashboards = (ctx.dataset.info or {}).get("tcger_dashboards") or {
            "performance": ctx.dataset.info["tcger_performance_dashboard"]
        }
        dashboard_name = ctx.params.get("dashboard_name") or next(iter(dashboards))
        dashboard = Path(dashboards[dashboard_name])
        encoded = base64.b64encode(dashboard.read_bytes()).decode("ascii")
        return {
            "dashboard": f"data:image/png;base64,{encoded}",
            "notes": (
                f"Dashboard: **{dashboard_name.replace('_', ' ')}**. "
                "Unavailable panels identify the exact instrumentation required; they are not zero-valued results."
            ),
        }

    def resolve_output(self, ctx):
        outputs = types.Object()
        outputs.str(
            "dashboard",
            label="TCGer scanner analysis dashboard",
            view=types.ImageView(width="100%", alt="TCGer scanner analysis charts"),
        )
        outputs.str("notes", label="Scope", view=types.MarkdownView())
        return types.Property(outputs, view=types.View(label="Scanner performance"))


class CompareScannerRuns(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="compare_scanner_runs",
            label="TCGer: compare scanner runs",
            description="Filter to disagreements or failures between two historical scanner runs",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        runs = _run_suffixes(ctx)
        if len(runs) < 2:
            warning = inputs.view(
                "warning", types.Warning(label="This dataset has fewer than two TCGer runs")
            )
            warning.invalid = True
            return types.Property(inputs)
        choices = types.DropdownView()
        for run in runs:
            choices.add_choice(run, label=run.replace("_", " "))
        inputs.enum("run_a", runs, default=runs[-1], label="Run A", view=choices)
        inputs.enum("run_b", runs, default=runs[-2], label="Run B", view=choices)
        modes = types.RadioGroup()
        modes.add_choice("disagree", label="Predictions disagree")
        modes.add_choice("name_disagree", label="Pokémon names disagree")
        modes.add_choice("a_wins", label="A correct, B failed")
        modes.add_choice("b_wins", label="B correct, A failed")
        modes.add_choice("either_failed", label="Either run failed")
        inputs.enum("mode", modes.values(), default="disagree", label="Show", view=modes)
        return types.Property(inputs, view=types.View(label="Compare scanner runs"))

    def execute(self, ctx):
        run_a = ctx.params["run_a"]
        run_b = ctx.params["run_b"]
        mode = ctx.params["mode"]
        field = fo.ViewField
        decision_a = field(f"decision_{run_a}.label")
        decision_b = field(f"decision_{run_b}.label")
        name_a = field(f"identified_card_name_{run_a}")
        name_b = field(f"identified_card_name_{run_b}")
        verdict_a = field(f"verdict_{run_a}")
        verdict_b = field(f"verdict_{run_b}")
        failures = ["wrong", "missed", "false_positive"]
        if mode == "name_disagree":
            expression = name_a != name_b
        elif mode == "a_wins":
            expression = (verdict_a == "correct") & verdict_b.is_in(failures)
        elif mode == "b_wins":
            expression = (verdict_b == "correct") & verdict_a.is_in(failures)
        elif mode == "either_failed":
            expression = verdict_a.is_in(failures) | verdict_b.is_in(failures)
        else:
            expression = decision_a != decision_b
        ctx.ops.set_view(view=ctx.dataset.match(expression))


class ReviewScannerGeometry(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="review_scanner_geometry",
            label="TCGer: review geometry and data quality",
            description="Open a focused queue for masks, perspective, duplicates, or label issues",
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        choices = types.RadioGroup()
        choices.add_choice("segmentation", label="Filled segmentation truth")
        choices.add_choice("perspective", label="Most distorted perspective")
        choices.add_choice("label_issues", label="Likely label mistakes")
        choices.add_choice("duplicates", label="Exact duplicates")
        choices.add_choice("outliers", label="Most unusual images")
        choices.add_choice("augmented", label="Roboflow augmented datasets")
        choices.add_choice("holdout", label="Geometry evaluation holdout")
        choices.add_choice("leakage", label="Source groups crossing splits")
        inputs.enum("queue", choices.values(), default="perspective", label="Review queue", view=choices)
        return types.Property(inputs, view=types.View(label="Geometry and data-quality review"))

    def execute(self, ctx):
        field = fo.ViewField
        queue = ctx.params["queue"]
        if queue == "segmentation":
            view = ctx.dataset.match(field("geometry_source") == "source_polygon")
        elif queue == "label_issues":
            view = ctx.dataset.match(field("needs_model_review") == True).sort_by(  # noqa: E712
                "label_issue_score", reverse=True
            )
        elif queue == "duplicates":
            view = ctx.dataset.match(field("is_exact_duplicate") == True).sort_by(  # noqa: E712
                "exact_duplicate_group"
            )
        elif queue == "outliers":
            view = ctx.dataset.sort_by("tcger_uniqueness", reverse=True)
        elif queue == "augmented":
            view = ctx.dataset.match(
                field("provenance_kind") == "roboflow_augmented_dataset"
            )
        elif queue == "holdout":
            view = ctx.dataset.match(field("geometry_evaluation_eligible") == True)  # noqa: E712
        elif queue == "leakage":
            view = ctx.dataset.match(field("source_group_split_leakage") == True).sort_by(  # noqa: E712
                "source_group_key"
            )
        else:
            view = ctx.dataset.exists("perspective_distortion").sort_by(
                "perspective_distortion", reverse=True
            )
        ctx.ops.set_view(view=view)


class SetScannerReviewStatus(foo.Operator):
    @property
    def config(self):
        return foo.OperatorConfig(
            name="set_scanner_review_status",
            label="TCGer: set review status",
            description="Apply a manual review decision to the selected samples",
            dynamic=True,
        )

    def resolve_input(self, ctx):
        inputs = types.Object()
        if not ctx.selected:
            warning = inputs.view(
                "warning", types.Warning(label="Select one or more samples first")
            )
            warning.invalid = True
        choices = types.RadioGroup()
        choices.add_choice("accepted", label="Accept")
        choices.add_choice("corrected", label="Corrected label")
        choices.add_choice("no_card", label="No card")
        choices.add_choice("needs_corner_review", label="Needs corner review")
        choices.add_choice("needs_mask_review", label="Needs mask review")
        choices.add_choice("rejected", label="Reject")
        inputs.enum("status", choices.values(), required=True, label="Decision", view=choices)
        inputs.str("notes", label="Geometry/review notes", required=False)
        return types.Property(inputs, view=types.View(label="Set scanner review status"))

    def execute(self, ctx):
        selected = ctx.dataset.select(ctx.selected)
        selected.set_values("review_status", [ctx.params["status"]] * len(selected))
        notes = (ctx.params.get("notes") or "").strip()
        if notes:
            selected.set_values("review_geometry_notes", [notes] * len(selected))
        ctx.trigger("reload_dataset")


def register(plugin):
    plugin.register(ShowShutterBenchmark)
    plugin.register(ShowShutterEvidence)
    plugin.register(LabelBinderPocket)
    plugin.register(SetScannerOverlayLayers)
    plugin.register(LabelShutterCapture)
    plugin.register(ShowPerformanceDashboard)
    plugin.register(CompareScannerRuns)
    plugin.register(ReviewScannerGeometry)
    plugin.register(SetScannerReviewStatus)
