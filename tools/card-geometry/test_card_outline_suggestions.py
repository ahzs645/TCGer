"""Inference isolation and conservative mask fitting; no real label writes."""
import json
from pathlib import Path
from threading import Event, Thread
from time import monotonic, sleep
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import cv2
import numpy as np

from card_outline_suggestions import OutlineSuggestionJobs, SuggestionBusyError, masks_to_suggestions
from corner_editor_server import EditorHandler, ThreadingHTTPServer


def finished(jobs, job):
    deadline = monotonic() + 3
    while monotonic() < deadline:
        result = jobs.get(job["id"])
        if result["status"] != "running":
            return result
        sleep(.005)
    raise AssertionError("job did not finish")


class SuggestionsTest(unittest.TestCase):
    def test_masks_reject_occlusion_details_and_duplicates(self):
        full = np.zeros((400, 400), dtype=np.uint8)
        cv2.fillConvexPoly(full, np.array([[30, 40], [160, 30], [180, 270], [20, 260]]), 1)
        detail = np.zeros_like(full)
        detail[80:160, 60:140] = 1
        occluded = full.copy()
        occluded[100:200, :90] = 0
        result = masks_to_suggestions([full, full, detail, occluded, np.zeros_like(full)], [.95]*5)
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["rejected"]["duplicate"], 1)
        self.assertEqual(result["rejected"]["interiorDetail"], 1)
        self.assertEqual(sum(result["rejected"].values()), 4)
        self.assertEqual(result["candidates"][0]["cornerSource"], "maskFit")

    def test_one_job_at_a_time_and_detached_snapshots(self):
        release = Event()
        calls = []
        def runner(path, report):
            calls.append(path)
            report("working")
            release.wait(2)
            return {"candidates": []}
        jobs = OutlineSuggestionJobs(runner)
        job = jobs.start("one", Path("photo.jpg"))
        try:
            self.assertEqual(jobs.start("one", Path("photo.jpg"))["id"], job["id"])
            with self.assertRaises(SuggestionBusyError):
                jobs.start("two", Path("other.jpg"))
            job["sampleId"] = "changed"
            self.assertEqual(jobs.get(job["id"])["sampleId"], "one")
        finally:
            release.set()
        self.assertEqual(finished(jobs, job)["status"], "complete")
        self.assertEqual(calls, [Path("photo.jpg")])

    def test_failure_releases_worker_for_retry(self):
        def fail(path, report):
            raise RuntimeError("model unavailable")
        jobs = OutlineSuggestionJobs(fail)
        job = finished(jobs, jobs.start("one", Path("photo.jpg")))
        self.assertEqual(job["status"], "error")
        self.assertIn("model unavailable", job["message"])
        jobs.runner = lambda path, report: {"candidates": []}
        self.assertEqual(finished(jobs, jobs.start("two", Path("other.jpg")))["status"], "complete")

    def test_http_limits_inference_to_view_members_and_never_saves_labels(self):
        class Store:
            def image_path(self, key):
                if key != "known":
                    raise KeyError(key)
                return Path("only-this-photo.jpg")
            def save(self, *args):
                raise AssertionError("suggestions must never save labels")
        calls = []
        def runner(path, report):
            calls.append(path)
            return {"candidates": []}
        server = ThreadingHTTPServer(("127.0.0.1", 0), EditorHandler)
        server.store = Store()
        server.suggestions = OutlineSuggestionJobs(runner)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            for path, headers, code in [("unknown", {}, 404), ("known", {"Origin": "https://unrelated.example"}, 403)]:
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(base+"/api/outline-suggestions/"+path, method="POST", headers=headers))
                self.assertEqual(caught.exception.code, code)
            response = urlopen(Request(base+"/api/outline-suggestions/known", method="POST", headers={"Origin": base}))
            self.assertEqual(response.status, 202)
            job = json.load(response)
            finished(server.suggestions, job)
            result = json.load(urlopen(base+"/api/outline-suggestions/jobs/"+job["id"]))
            self.assertEqual(result["sampleId"], "known")
            self.assertEqual(result["status"], "complete")
            self.assertEqual(calls, [Path("only-this-photo.jpg")])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
