import copy
import unittest

from prepare_orientation_validation import connected_groups
from select_training_validation import choose,quality


class OrientationValidationTests(unittest.TestCase):
    def test_connected_groups_keep_archive_aliases_images_and_physical_cards_together(self):
        def entry(archive,physical,image):
            return dict(leakageKeys=dict(sourceArchiveId=archive,physicalCardIds=physical),images=[dict(sha256=image)])
        manifest=dict(sourceArchiveAliases={'a':'a','fork':'a','b':'b','c':'c','d':'d'},records=[
            entry('a',[],'1'),entry('fork',['shared'],'2'),entry('b',['shared'],'3'),
            entry('c',[],'3'),entry('d',[],'4')])
        before=copy.deepcopy(manifest)
        groups=connected_groups(manifest)
        self.assertEqual(sorted(sorted(g) for g in groups),[[0,1,2,3],[4]])
        self.assertEqual(manifest,before)

    def test_score_balances_geometry_detection_and_source_kinds(self):
        def metrics(matches=9,tight=.8,extras=0):
            row=dict(truthInstances=10,matches=matches,extra=extras,duplicate=0,**{'recall@0.9':tight})
            return dict(detection=dict(bySceneSlice={'real:phone':row,'synthetic:phone':copy.deepcopy(row)}))
        base=quality(metrics())
        self.assertLess(quality(metrics(matches=7)),base)
        self.assertLess(quality(metrics(tight=.4)),base)
        self.assertLess(quality(metrics(extras=5)),base)
        data=metrics();data['detection']['bySceneSlice']['synthetic:more']=copy.deepcopy(data['detection']['bySceneSlice']['synthetic:phone'])
        self.assertEqual(quality(data),base)
        del data['detection']['bySceneSlice']['real:phone']
        with self.assertRaises(ValueError):quality(data)

    def test_ties_preserve_predeclared_shortlist_order(self):
        rows=[dict(id='late',score=.8,shortlistIndex=4),dict(id='early',score=.8,shortlistIndex=0)]
        self.assertEqual(choose(rows)['id'],'early')
        with self.assertRaises(ValueError):choose([rows[0],rows[0]])

if __name__=='__main__':unittest.main()
