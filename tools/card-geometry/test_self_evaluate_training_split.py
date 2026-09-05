import unittest
from self_evaluate_training_split import select_entries


class TrainingSampleTests(unittest.TestCase):
    def test_sampling_never_uses_evaluation_and_is_order_independent(self):
        entries=[{'recordId':f'{split}-{scene}-{index}','split':split,'sceneSlice':scene}
                 for split in ('train','validation','test') for scene in ('binder','single')
                 for index in range(8)]
        selected=select_entries({'records':entries},3)
        self.assertEqual(len(selected),6)
        self.assertEqual({entry['split'] for entry in selected},{'train'})
        self.assertEqual(selected,select_entries({'records':list(reversed(entries))},3))
