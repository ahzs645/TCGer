import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

from scanner_recording_images import crop_rect, load_input_image, materialize_input, session_path


class ScannerRecordingImagesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.session = self.root / 'session'
        self.session.mkdir()
        y, x = np.indices((80, 100))
        self.pixels = np.stack([x, y, x + y], axis=2).astype(np.uint8)
        Image.fromarray(self.pixels).save(self.session / 'original.png')
        self.record = {'imageFile': 'frame-0000.jpg', 'inputImageTransform': {
            'version': 1, 'sourceImageFile': 'original.png',
            'coordinateSpace': 'uprightPixelsTopLeft',
            'sourcePixelWidth': 100, 'sourcePixelHeight': 80,
            'cropRectPixels': [11, 23, 40, 30],
        }}

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_crop_coordinate_mapping_and_cache(self):
        source_before = {p.name: p.read_bytes() for p in self.session.iterdir()}
        image = load_input_image(self.session, self.record)
        np.testing.assert_array_equal(image, self.pixels[23:53, 11:51])
        path = materialize_input(self.session, self.record, self.root / 'cache')
        self.assertEqual(path.suffix, '.png')
        with Image.open(path) as cached:
            np.testing.assert_array_equal(cached, self.pixels[23:53, 11:51])
        self.assertEqual(path, materialize_input(self.session, self.record, self.root / 'cache'))
        self.assertEqual(source_before, {p.name: p.read_bytes() for p in self.session.iterdir()})

    def test_legacy_and_debug_input_take_precedence(self):
        Image.new('RGB', (12, 13), 'red').save(self.session / self.record['imageFile'])
        for record in [self.record, {'imageFile': self.record['imageFile']}]:
            self.assertEqual(load_input_image(self.session, record).size, (12, 13))
            self.assertEqual(materialize_input(self.session, record, self.root / 'cache'), (self.session / record['imageFile']).resolve())

    def test_bad_metadata_and_missing_source_do_not_silently_replay_original(self):
        for change in [
            {'version': 2}, {'coordinateSpace': 'vision'}, {'cropRectPixels': [1, 2]},
            {'cropRectPixels': [-1, 0, 40, 30]}, {'cropRectPixels': [0, 0, 0, 30]},
            {'cropRectPixels': [1.5, 0, 40, 30]}, {'cropRectPixels': [80, 0, 40, 30]},
            {'sourcePixelWidth': 101}, {'sourceImageFile': '../outside.png'},
        ]:
            record = copy.deepcopy(self.record)
            record['inputImageTransform'].update(change)
            with self.subTest(change=change), self.assertRaises((ValueError, FileNotFoundError)):
                load_input_image(self.session, record)
        (self.session / 'original.png').unlink()
        with self.assertRaises(FileNotFoundError):
            load_input_image(self.session, self.record)

    def test_cache_invalidates_when_source_or_recipe_changes(self):
        first = materialize_input(self.session, self.record, self.root / 'cache')
        self.record['inputImageTransform']['cropRectPixels'][0] += 1
        second = materialize_input(self.session, self.record, self.root / 'cache')
        self.assertNotEqual(first, second)
        Image.new('RGB', (100, 80), 'blue').save(self.session / 'original.png')
        self.assertNotEqual(second, materialize_input(self.session, self.record, self.root / 'cache'))

    def test_attempt_derivation_uses_virtual_input(self):
        directory = Path(__file__).resolve().parents[1] / 'mobile-apps/ios/scripts/session-labeling'
        sys.path.insert(0, str(directory))
        import derive_crops as dc
        bgr = dc.load_input_bgr(self.session, self.record)
        np.testing.assert_array_equal(bgr, self.pixels[23:53, 11:51, ::-1])
        attempt = {'kind': 'rawImage'}
        np.testing.assert_array_equal(dc.derive_attempt(bgr, attempt, True), bgr[::-1, ::-1])
        binder = {'kind': 'rawImage', 'pocketIndex': 0,
                  'quad': [[0, 1], [1, 1], [1, 0], [0, 0]],
                  'binderPageFitRect': [0, 0, 1, 1],
                  'sourceCropPixelWidth': 40, 'sourceCropPixelHeight': 30}
        np.testing.assert_array_equal(dc.derive_attempt(bgr, binder, False), bgr)

    def test_label_export_preserves_input_dimensions(self):
        import export_scanner_recording_labels as exporter
        frame = {**self.record, 'index': 0, 'timestampSeconds': 0, 'identified': False,
                 'detectedCount': 1, 'elapsedMs': 1, 'mode': 'pokemon', 'pipeline': 'test',
                 'quad': [[0, 1], [1, 1], [1, 0], [0, 0]]}
        (self.session / 'results.json').write_text(json.dumps({'summary': {'frameCount': 1, 'mode': 'pokemon', 'pipeline': 'test'}, 'frames': [frame]}))
        output = self.root / 'labels'
        exporter.export_bundle(self.session, output, self.root)
        with Image.open(output / 'images/frame-0000.jpg') as image:
            self.assertEqual(image.size, (40, 30))
        self.assertFalse((self.session / frame['imageFile']).exists())


if __name__ == '__main__':
    unittest.main()
