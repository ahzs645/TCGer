import unittest
from self_evaluate_training_split import select_entries, training_match_gate


class TrainingSampleTests(unittest.TestCase):
    def test_sampling_never_uses_evaluation_and_is_order_independent(self):
        entries=[{'recordId':f'{split}-{scene}-{index}','split':split,'sceneSlice':scene}
                 for split in ('train','validation','test') for scene in ('binder','single')
                 for index in range(8)]
        selected=select_entries({'records':entries},3)
        self.assertEqual(len(selected),6)
        self.assertEqual({entry['split'] for entry in selected},{'train'})
        self.assertEqual(selected,select_entries({'records':list(reversed(entries))},3))
        all_train = select_entries({'records':entries},None)
        self.assertEqual(len(all_train),16)
        self.assertEqual({entry['split'] for entry in all_train},{'train'})

    def test_no_matches_blocks_evaluation_gate(self):
        self.assertEqual(training_match_gate({'detection':{'overall':{'matches':0}}},1)['failedChecks'],
                         ['TRAIN_SELF_EVALUATION'])
        self.assertEqual(training_match_gate({'detection':{'overall':{'matches':1}}},1)['failedChecks'],[])
