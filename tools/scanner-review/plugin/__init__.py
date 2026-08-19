"""FiftyOne operators for TCGer's scanner review workflow."""

from __future__ import annotations

import base64
from pathlib import Path

import fiftyone as fo
import fiftyone.operators as foo
import fiftyone.operators.types as types


def _run_suffixes(ctx):
    return [
        item["field"].removeprefix("pred_")
        for item in (ctx.dataset.info or {}).get("tcger_model_runs", [])
    ]


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
    plugin.register(ShowPerformanceDashboard)
    plugin.register(CompareScannerRuns)
    plugin.register(ReviewScannerGeometry)
    plugin.register(SetScannerReviewStatus)
