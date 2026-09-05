import copy
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError, load_assets
from compositor.review_background_manifest import excluded_sessions, validate_reviews
from corpus_release import canonical_json, sha256_bytes, sha256_file


class BackgroundReviewTests(unittest.TestCase):
    def test_exclusion_union_includes_unlisted_evaluation_and_every_dev_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'scan-session-dev').mkdir()
            (root/'legacy-debug-session').mkdir()
            manifest={'evaluationSessionDenylist':['frozen-listed'], 'records':[
                {'leakageKeys':{'sessionId':'frozen-record-only'}}]}
            self.assertEqual(excluded_sessions(manifest,root),
                ['frozen-listed','frozen-record-only','legacy-debug-session','scan-session-dev'])

    def test_review_is_bound_to_crop_bytes_session_and_reviewer(self):
        manifest={'schema':ASSET_MANIFEST_SCHEMA,'role':'background','assets':[
            {'assetId':'capture-bg-1','sha256':'a'*64,'provenance':{'sourceSessionId':'eligible'}}]}
        review={'assetId':'capture-bg-1','cropSha256':'a'*64,'sourceSessionId':'eligible',
                'reviewer':'fixture-reviewer','verdict':'card-free'}
        def reviews(row):
            return {'schema':'https://tcger.app/reviews/card-geometry-background/v1','reviews':[row]}
        self.assertEqual(len(validate_reviews(manifest,reviews(review),['frozen'])),1)
        for field,value in [('cropSha256','b'*64),('reviewer','  '),('sourceSessionId','different')]:
            with self.assertRaises(CompositorError):
                validate_reviews(manifest,reviews({**review,field:value}),['frozen'])
        with self.assertRaises(CompositorError):
            validate_reviews(manifest,reviews(review),['eligible'])
        self.assertEqual(validate_reviews(manifest,reviews({**review,'verdict':'reject'}),[]),[])

    def test_compositor_rejects_unreviewed_or_stale_capture_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            image=root/'crop.png'
            Image.new('RGB',(8,8)).save(image)
            digest=sha256_file(image)
            row={'assetId':'capture-bg-fixture','path':'crop.png','sha256':digest,'split':'train',
                 'licenseId':'fixture','provenance':{'sourceSessionId':'eligible'}}
            doc={'schema':ASSET_MANIFEST_SCHEMA,'role':'background','assets':[row],
                 'sessionExclusions':['frozen','dev']}
            path=root/'assets.json'
            path.write_text(json.dumps(doc))
            with self.assertRaisesRegex(CompositorError,'review'):
                load_assets(path,'background')
            row['provenance']['backgroundReview']={
                'reviewer':'fixture-reviewer','verdict':'card-free','cropSha256':digest,
                'sourceSessionId':'eligible','sessionExclusionsSha256':sha256_bytes(canonical_json(doc['sessionExclusions']))}
            path.write_text(json.dumps(doc))
            self.assertEqual(len(load_assets(path,'background')),1)
            bad=copy.deepcopy(doc)
            bad['sessionExclusions'].append('eligible')
            path.write_text(json.dumps(bad))
            with self.assertRaises(CompositorError):
                load_assets(path,'background')
            Image.new('RGB',(8,8),(255,0,0)).save(image)
            row['sha256']=sha256_file(image)
            path.write_text(json.dumps(doc))
            with self.assertRaisesRegex(CompositorError,'review'):
                load_assets(path,'background')
