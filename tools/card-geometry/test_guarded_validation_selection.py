import unittest
from select_training_validation import choose_guarded


def row(epoch,score,extras=.1,synthetic=.8):
    return dict(id=f'epoch{epoch}',score=score,sources={
        'real':dict(photos=100,targets=110,extrasPerPhoto=extras,score=score),
        'synthetic':dict(photos=1000,targets=3000,score=synthetic)})


class GuardedSelectionTests(unittest.TestCase):
    def test_extra_and_synthetic_guards_precede_score_and_ties_prefer_later(self):
        candidates=[row(9,.9,extras=.3),row(19,.91,synthetic=.7),row(29,.8),row(39,.8),row(49,.8)]
        winner,guards=choose_guarded(candidates)
        self.assertEqual(winner['id'],'epoch49')
        self.assertEqual(guards['excludedIds'],['epoch9','epoch19'])

    def test_rejects_mixed_populations_or_framework_selected_candidates(self):
        candidates=[row(9,.8),row(19,.9)]
        candidates[1]['sources']['real']['targets']=111
        with self.assertRaisesRegex(ValueError,'denominators'):choose_guarded(candidates)
        candidates[1]['id']='best'
        with self.assertRaisesRegex(ValueError,'epoch snapshots'):choose_guarded(candidates)


if __name__=='__main__':unittest.main()
