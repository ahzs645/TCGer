import base64
import copy
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from archive_corner_label_server import handler
from model_review import ReviewStore, fingerprints, normalized_image, sha, write_json


class ModelReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.photo = self.make_photo()
        image = self.root / "benchmark.png"
        image.write_bytes(self.photo)
        self.card = {"id": "C1", "corners": [[.1,.1],[.8,.1],[.8,.9],[.1,.9]],
                     "excluded": False, "orientationKnown": False, "occluded": False, "expectedCard": ""}
        frame = {"id": "heldout", "reference": "R001", "kind": "benchmark", "scene": "binder_page",
                 "imagePath": str(image), "imageSha256": sha(self.photo), "proposals": [self.card],
                 "previous": [], "referencePolygons": [], **fingerprints(normalized_image(self.photo))}
        catalog = self.root / "catalog.json"
        write_json(catalog, {"modelSha256": "a"*64, "frames": [frame], "protectedImageHashes": []})
        self.config = self.root / "config.json"
        write_json(self.config, {"catalog": str(catalog), "catalogSha256": sha(catalog.read_bytes()),
                                "modelSha256": "a"*64, "modelName": "test", "starter": ["heldout"],
                                "storage": str(self.root / "feedback")})
        self.store = ReviewStore(self.config, predictor=lambda path: [])

    def tearDown(self):
        self.temp.cleanup()

    def make_photo(self, variant=False, format="PNG"):
        image = Image.new("RGB", (80,100))
        image.putdata([((x*3 if not variant else 255-x*3),y*2,(x+y)%256) for y in range(100) for x in range(80)])
        out = io.BytesIO(); image.save(out, format=format); return out.getvalue()

    def payload(self, key="heldout", verdict="approved"):
        f = self.store.frames[key]
        return {"revision": self.store.saved.get(key, {}).get("revision", 0), "imageSha256": f["imageSha256"],
                "modelSha256": self.store.model_sha, "cards": copy.deepcopy(f["proposals"]),
                "verdict": verdict, "notes": "Checked corners"}

    def upload(self, data):
        return self.store.upload({"data": base64.b64encode(data).decode(), "session": "desk-session", "name": "new.png"})

    def test_benchmark_feedback_never_exported_and_restart_preserves_review(self):
        first = self.store.save("heldout", self.payload())
        self.assertEqual(first["revision"], 1)
        self.assertEqual(self.store.export()["frames"], [])
        restarted = ReviewStore(self.config)
        self.assertEqual(restarted.saved["heldout"], first)
        self.assertNotEqual(restarted.frames["heldout"]["proposals"], [])

    def test_stale_revision_and_wrong_image_cannot_overwrite(self):
        payload = self.payload()
        self.store.save("heldout", payload)
        before = self.store.journal.read_bytes()
        with self.assertRaises(RuntimeError): self.store.save("heldout", payload)
        payload["revision"] = 1; payload["imageSha256"] = "wrong"
        with self.assertRaises(ValueError): self.store.save("heldout", payload)
        self.assertEqual(before, self.store.journal.read_bytes())

    def test_crossed_quads_and_deleted_original_ids_rejected(self):
        payload = self.payload()
        payload["cards"][0]["corners"][1:3] = reversed(payload["cards"][0]["corners"][1:3])
        with self.assertRaises(ValueError): self.store.save("heldout", payload)
        payload["cards"] = []
        with self.assertRaises(ValueError): self.store.save("heldout", payload)

    def test_exact_benchmark_upload_redirects_without_inference(self):
        self.assertEqual(self.upload(self.photo)["id"], "heldout")
        self.assertEqual(len(self.store.frames), 1)

    def test_compressed_benchmark_copy_is_quarantined(self):
        result = self.upload(self.make_photo(format="JPEG"))
        frame = self.store.frames[result["id"]]
        self.assertFalse(frame["trainingCandidateEligible"])
        self.store.save(frame["id"], self.payload(frame["id"]))
        self.assertEqual(self.store.export()["frames"], [])

    def test_only_approved_new_photos_export_and_duplicates_keep_reference(self):
        result = self.upload(self.make_photo(variant=True))
        key = result["id"]
        self.assertEqual(self.store.frames[key]["reference"], "U001")
        self.assertEqual(self.upload(self.make_photo(variant=True))["id"], key)
        self.store.save(key, self.payload(key, "draft"))
        self.assertEqual(self.store.export()["frames"], [])
        self.store.save(key, self.payload(key))
        exported = self.store.export()["frames"]
        self.assertEqual([r["id"] for r in exported], [key])
        self.assertEqual(exported[0]["session"], "desk-session")
        restarted = ReviewStore(self.config)
        self.assertEqual(restarted.frames[key]["reference"], "U001")
        self.assertEqual(restarted.export(), self.store.export())

    def test_http_same_origin_static_and_unknown_routes(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler(SimpleNamespace(), self.store))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base+"/model-review.html") as response:
                self.assertIn(b"Model comparison", response.read())
            request = urllib.request.Request(base+"/api/model-review/save/heldout", json.dumps(self.payload()).encode(),
                                             {"Content-Type":"application/json", "Origin":"https://unrelated.example"})
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(base+"/api/model-review/image/missing")
            self.assertEqual(error.exception.code, 404)
            request.remove_header("Origin")
            with urllib.request.urlopen(request) as response: self.assertEqual(json.load(response)["revision"], 1)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
