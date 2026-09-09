import copy
import unittest

from exclude_reviewed_non_cards import exclude_record
from preflight import _record_category_problems


class ReviewedNonCardsTest(unittest.TestCase):
    def setUp(self):
        self.record = {"recordId": "card-photo", "source": {"kind":"real", "sha256":"a"*64,
            "annotationCategories":{"card":3}}, "instances":[
                {"instanceId":f"card-{i}","sourceAnnotationIndex":i,"sourceCategory":"card"} for i in range(3)]}
        self.review = {"recordId":"card-photo", "imageSha256":"a"*64,"complete":True,"drafts":{},
            "reviewer":"Reviewer", "savedAt":"2026-09-08T00:00:00Z", "targets":{
                "0":{"skip":"not-a-card"}, "1":{"skip":"cut-off"}, "2":{"skip":"occluded"}}}
        self.semantics = {"primaryCategories":["card"],"auxiliaryCategories":[],"contextCategories":[]}

    def test_only_non_cards_removed_with_auditable_original_indices(self):
        before = copy.deepcopy(self.record)
        output, removed = exclude_record(self.record,self.review,"b"*64,"train")
        self.assertEqual(removed,[0])
        self.assertEqual(output["instances"],before["instances"][1:])
        self.assertEqual(self.record,before)
        self.assertEqual(output["source"]["annotationCategories"],{"card":3})
        self.assertEqual(_record_category_problems({"split":"train"},output,self.semantics),[])
        output["instances"].append(before["instances"][0])
        self.assertTrue(_record_category_problems({"split":"train"},output,self.semantics))

    def test_stale_incomplete_unknown_or_evaluation_reviews_rejected(self):
        for field,value in [("imageSha256","c"*64),("recordId","other"),("complete",False),("reviewer",""),("drafts",{"2":{}})]:
            review = copy.deepcopy(self.review); review[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):
                exclude_record(self.record,review,"b"*64,"train")
        with self.assertRaises(ValueError):
            exclude_record(self.record,self.review,"b"*64,"validation")
        review = copy.deepcopy(self.review); review["targets"]["9"]={"skip":"not-a-card"}
        with self.assertRaises(ValueError):
            exclude_record(self.record,review,"b"*64,"train")

    def test_preflight_rejects_duplicate_padding_and_review_exclusions(self):
        output,_=exclude_record(self.record,self.review,"b"*64,"train")
        output["source"]["paddingCorrection"]={"removedAnnotationIndices":[0]}
        problems=_record_category_problems({"split":"train"},output,self.semantics)
        self.assertIn("duplicate or overlapping annotation exclusions",problems)
        self.assertTrue(_record_category_problems({"split":"validation"},output,self.semantics))


if __name__ == "__main__":
    unittest.main()
