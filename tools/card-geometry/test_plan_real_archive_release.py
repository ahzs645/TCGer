import unittest

from plan_real_archive_release import archive_id, compute_plan
from corpus_release import leakage_keys_from_record


class ArchivePlanTests(unittest.TestCase):
    def test_reviewed_content_links_group_archives_without_relabeling_them_as_forks(
        self,
    ):
        names = ["a.zip", "b.zip", "c.zip"]
        aliases = {archive_id(name): archive_id(name) for name in names}
        rows = [
            {"id": str(i), "archive": name, "sha256": str(i)}
            for i, name in enumerate(names)
        ]
        links = [
            {
                "canonicalArchiveIds": [archive_id("a.zip"), archive_id("b.zip")],
                "decision": "keep-same-split",
                "reviewer": "fixture-reviewer",
                "evidenceSha256": "a" * 64,
            }
        ]
        plan = compute_plan(rows, aliases, [], reviewed_links=links)
        self.assertEqual(
            plan["archiveFileSplits"]["a.zip"], plan["archiveFileSplits"]["b.zip"]
        )
        self.assertEqual(plan["sourceArchiveAliases"], aliases)
        self.assertNotEqual(
            plan["inputInventorySha256"],
            compute_plan(rows, aliases, [])["inputInventorySha256"],
        )

    def test_forks_and_shared_families_stay_together_and_eval_bytes_exclude_component(
        self,
    ):
        names = ["a.zip", "fork.zip", "b.zip", "c.zip", "eval-copy.zip"]
        aliases = {archive_id(name): archive_id(name) for name in names}
        aliases[archive_id("fork.zip")] = archive_id("a.zip")
        rows = [
            {
                "id": str(i),
                "archive": name,
                "sha256": str(i),
                "leakageAliases": ["shared" if i < 2 else str(i)],
            }
            for i, name in enumerate(names)
        ]
        evaluation = {
            "corpusHash": "pinned",
            "sourceArchiveAliases": {"evaluation": "evaluation"},
            "records": [
                {
                    "leakageKeys": {"sourceArchiveId": "evaluation"},
                    "images": [{"sha256": "4"}],
                }
            ],
        }
        plan = compute_plan(rows, aliases, [evaluation])
        self.assertEqual(
            plan["archiveFileSplits"]["a.zip"], plan["archiveFileSplits"]["fork.zip"]
        )
        self.assertNotIn("eval-copy.zip", plan["archiveFileSplits"])
        self.assertEqual(
            plan, compute_plan(list(reversed(rows)), aliases, [evaluation])
        )
        self.assertEqual(
            set(plan["archiveFileSplits"].values()), {"train", "validation"}
        )
        del aliases[archive_id("b.zip")]
        with self.assertRaisesRegex(ValueError, "unmapped"):
            compute_plan(rows, aliases, [evaluation])

    def test_real_source_family_is_independent_leakage_key(self):
        keys = leakage_keys_from_record(
            {"grouping": {"sourceArchiveId": "a", "sourceAssetIds": ["family"]}},
            {"a": "a"},
        )
        self.assertEqual(keys["sourceAssetIds"], ["family"])
