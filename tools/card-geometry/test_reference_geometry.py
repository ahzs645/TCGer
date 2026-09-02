import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[1]
FIXTURES = ROOT / "fixtures"
SCHEMAS = REPOSITORY / "docs" / "scanner-system" / "schemas"
sys.path.insert(0, str(ROOT))

from reference_geometry import (  # noqa: E402
    canonical_round,
    forward_source_pixel,
    inverse_model_pixel,
    process_candidates,
)


class CardGeometryFixtureTests(unittest.TestCase):
    def load_fixture(self, name: str) -> dict:
        return json.loads((FIXTURES / name).read_text())

    def test_validation_and_nms_golden_cases(self):
        fixture = self.load_fixture("validation-nms.v1.json")
        decimals = fixture["roundingDecimals"]
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                actual = process_candidates(
                    case["candidates"], case["config"], fixture["modelIdentity"]
                )
                self.assertEqual(canonical_round(actual, decimals), case["expected"])

    def test_context_padding_and_letterbox_round_trip(self):
        fixture = self.load_fixture("context-letterbox-roundtrip.v1.json")
        transform = fixture["transform"]
        decimals = fixture["roundingDecimals"]
        source_size = transform["sourceSize"]
        margins = transform["contextMarginPixels"]
        self.assertEqual(
            transform["contextSize"],
            {
                "width": source_size["width"] + margins["left"] + margins["right"],
                "height": source_size["height"] + margins["top"] + margins["bottom"],
            },
        )
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                model = forward_source_pixel(case["sourcePixel"], transform)
                self.assertEqual(
                    canonical_round(model, decimals), case["modelPixel"]
                )
                recovered = canonical_round(
                    inverse_model_pixel(model, transform), decimals
                )
                self.assertEqual(recovered, case["recoveredSourcePixel"])

    def test_contract_schemas_are_valid_json_with_unique_ids(self):
        schema_paths = [
            SCHEMAS / "card-geometry-result.v1.schema.json",
            SCHEMAS / "card-geometry-corpus-record.v1.schema.json",
        ]
        documents = [json.loads(path.read_text()) for path in schema_paths]
        self.assertEqual(len({document["$id"] for document in documents}), 2)
        for document in documents:
            self.assertEqual(
                document["$schema"], "https://json-schema.org/draft/2020-12/schema"
            )
            self.assertFalse(document["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
