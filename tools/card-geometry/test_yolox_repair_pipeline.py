import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from corpus_release import REPOSITORY, corpus_hash, load_json, sha256_file
from run_card_geometry_hf_job import (ConfigurationError, resolve_config, experiment_hash,
                                    fairness_hash, run_training_self_evaluation)
from self_evaluate_training_split import run


def repair_config():
    raw = load_json(REPOSITORY / 'docs/scanner-system/benchmarks/2026-09-05-round-two-freeze/'
                    'yolox-validation-repair-v2/configs/yolox-pose.json')
    raw['execution'].pop('resumeFrom')
    raw['fairness']['yoloxCornerLoss'] = {'kind':'normalized-l1-v1','lossWeight':30.0}
    raw['fairness']['trainingSelfEvaluation'] = {'selection':'all-training-records','minimumMatches':1}
    return raw


class RepairPipelineTests(unittest.TestCase):
    def test_loss_changes_both_hashes_and_requires_self_evaluation(self):
        repaired = repair_config()
        original = copy.deepcopy(repaired)
        original['fairness']['yoloxCornerLoss']['kind'] = 'oks-v1'
        self.assertNotEqual(experiment_hash(resolve_config(repaired)),experiment_hash(resolve_config(original)))
        self.assertNotEqual(fairness_hash(resolve_config(repaired)),fairness_hash(resolve_config(original)))
        del repaired['fairness']['trainingSelfEvaluation']
        with self.assertRaisesRegex(ConfigurationError,'requires train self-evaluation'):
            resolve_config(repaired)

    def test_loss_repair_rejects_optimizer_resume(self):
        raw = repair_config()
        raw['execution']['resumeFrom'] = {'checkpointPrefix':'geometry/yolox-pose/x/y',
            'checkpointSha256':'a'*64,'epoch':2,'jobId':'old'}
        with self.assertRaisesRegex(ConfigurationError,'fresh initialization'):
            resolve_config(raw)

    def test_self_evaluation_rejects_partial_or_wrong_checkpoint_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'training/repeat-0').mkdir(parents=True)
            checkpoint = root/'training/repeat-0/epoch_50.pth'
            checkpoint.write_bytes(b'checkpoint')
            (root/'manifest.json').write_text(json.dumps({'records':[{'split':'train'},{'split':'train'}]}))
            config = repair_config()
            report = {'gate':{'failedChecks':[]},'checkpointSha256':sha256_file(checkpoint),
                'sourceCorpusHash':config['corpus']['corpusHash'],
                'selection':{'records':2,'allTrainingRecords':True}}
            for change in ({'selection':{'records':1,'allTrainingRecords':True}},
                           {'checkpointSha256':'0'*64}, {'gate':{'failedChecks':['TRAIN_SELF_EVALUATION']}}):
                (root/'train-self-evaluation.json').write_text(json.dumps({**report,**change}))
                with patch('run_card_geometry_hf_job._run'), self.assertRaisesRegex(RuntimeError,'evidence failed'):
                    run_training_self_evaluation(config,root,root,{})

    def test_real_training_records_use_declared_margin_and_verified_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            Image.new('RGB',(20,10),(10,20,200)).save(root/'image.png')
            (root/'checkpoint.pth').write_bytes(b'checkpoint')
            (root/'policy.json').write_text('{}')
            record={'source':{'kind':'real','width':20,'height':10,'path':'image.png',
                              'sha256':sha256_file(root/'image.png')},'instances':[]}
            (root/'record.json').write_text(json.dumps(record))
            manifest={'records':[{'recordId':'real','split':'train','sceneSlice':'single_card',
                                  'path':'record.json','sha256':sha256_file(root/'record.json')}],
                      'readiness':{'readinessPolicyPath':'policy.json',
                                   'readinessPolicySha256':sha256_file(root/'policy.json')}}
            manifest['corpusHash']=corpus_hash(manifest)
            (root/'manifest.json').write_text(json.dumps(manifest))
            policy={'kind':'fraction-of-long-side','fraction':.15,'rounding':'ceil','application':'each-side'}
            with patch('self_evaluate_training_split.inference.Predictor') as predictor, \
                 patch('self_evaluate_training_split.evaluate',return_value={'detection':{'overall':{'matches':0}}}):
                predictor.return_value.predict_yolox.return_value=[]
                report=run(root,root,'yolox-pose',root/'checkpoint.pth',sha256_file(root/'checkpoint.pth'),
                           manifest['corpusHash'],'cpu',None,policy)
                self.assertEqual(predictor.return_value.predict_yolox.call_args.args[0].size,(26,16))
                self.assertEqual(report['inputHashes'][0]['contextMargins'],dict.fromkeys(('left','top','right','bottom'),3))
                with self.assertRaisesRegex(ValueError,'require fairness'):
                    run(root,root,'yolox-pose',root/'checkpoint.pth',sha256_file(root/'checkpoint.pth'),
                        manifest['corpusHash'],'cpu',None,None)
                (root/'image.png').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'image hash mismatch'):
                    run(root,root,'yolox-pose',root/'checkpoint.pth',sha256_file(root/'checkpoint.pth'),
                        manifest['corpusHash'],'cpu',None,policy)
