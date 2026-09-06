"""Review storage must preserve diagnostics and reject lost updates or bad corners."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SPEC = importlib.util.spec_from_file_location(
    "failure_review", Path(__file__).with_name("failure_review_server.py")
)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
QUAD = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
PAYLOAD = dict(
    reviewer="Test reviewer",
    winner="neither",
    scene="binder_page",
    issues=["bad-corners"],
    notes="fixture only",
    quads=[QUAD],
    revision=0,
)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = SERVER.Store.__new__(SERVER.Store)
        self.store.journal = Path(self.temp.name) / "reviews.jsonl"
        self.store.lock = threading.Lock()
        self.store.saved = {}
        self.store.pins = {"inputSha256": "pinned-input"}
        self.store.samples = {
            "fixture": {
                "scope": "evaluation",
                "imageSha256": "pinned-image",
                "recordSha256": "pinned-record",
            }
        }

    def test_append_only_revisions_preserve_source_and_identity(self):
        original = copy.deepcopy(self.store.samples)
        first = self.store.save("fixture", PAYLOAD)
        second = self.store.save(
            "fixture", PAYLOAD | {"revision": 1, "notes": "corrected note"}
        )
        rows = [json.loads(x) for x in self.store.journal.read_text().splitlines()]
        self.assertEqual(rows, [first, second])
        self.assertEqual(second["revision"], 2)
        self.assertEqual(second["imageSha256"], "pinned-image")
        self.assertEqual(second["scope"], "evaluation")
        self.assertEqual(self.store.samples, original)

    def test_stale_review_cannot_overwrite_saved_work(self):
        self.store.save("fixture", PAYLOAD)
        before = self.store.journal.read_bytes()
        with self.assertRaises(RuntimeError):
            self.store.save("fixture", PAYLOAD | {"notes": "stale"})
        self.assertEqual(self.store.journal.read_bytes(), before)

    def test_crossed_nonfinite_and_incomplete_quads_rejected(self):
        bad = [
            QUAD[:3],
            [QUAD[i] for i in [0, 2, 1, 3]],
            [[float("nan"), 0.1], *QUAD[1:]],
            [[True, 0.1], *QUAD[1:]],
        ]
        for q in bad:
            with self.subTest(q=q), self.assertRaises(ValueError):
                SERVER.validate_review(PAYLOAD | {"quads": [q]})
        self.assertFalse(self.store.journal.exists())

    def test_review_without_geometry_is_valid_and_requires_named_reviewer(self):
        self.assertEqual(SERVER.validate_review(PAYLOAD | {"quads": []})["quads"], [])
        with self.assertRaises(ValueError):
            SERVER.validate_review(PAYLOAD | {"reviewer": " "})

    def test_http_save_conflict_and_cross_origin(self):
        http = ThreadingHTTPServer(("127.0.0.1", 0), SERVER.handler(self.store))
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(http.server_close)
        self.addCleanup(http.shutdown)
        url = f"http://127.0.0.1:{http.server_port}/api/review/fixture"

        def request(origin):
            return Request(
                url,
                json.dumps(PAYLOAD).encode(),
                {"Content-Type": "application/json", "Origin": origin},
            )

        with self.assertRaises(HTTPError) as error:
            urlopen(request("https://unrelated.example"))
        self.assertEqual(error.exception.code, 403)
        self.assertFalse(self.store.journal.exists())
        origin = f"http://127.0.0.1:{http.server_port}"
        with urlopen(request(origin)) as response:
            self.assertEqual(json.load(response)["revision"], 1)
        with self.assertRaises(HTTPError) as error:
            urlopen(request(origin))
        self.assertEqual(error.exception.code, 409)


if __name__ == "__main__":
    unittest.main()
