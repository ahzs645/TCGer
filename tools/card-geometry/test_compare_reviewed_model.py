import copy
import unittest

from compare_reviewed_model import compare


class ComparisonTests(unittest.TestCase):
    def record(self, source="human", orientation=True):
        return {"recordId":"sample","source":{"width":1000,"height":500},"instances":[
            {"orientationKnown":orientation,"corners":[{"coordinateKnown":True,"cornerSource":source,
             "point":{"x":x,"y":y}} for x,y in quad]}
            for quad in ([[.05,.1],[.3,.1],[.3,.9],[.05,.9]], [[.6,.1],[.85,.1],[.85,.9],[.6,.9]])]}

    def results(self, record):
        return [{"confidence":.9,"corners":copy.deepcopy(i["corners"])} for i in record["instances"]]

    def test_matching_uses_geometry_not_list_position(self):
        record=self.record(); result=compare(record,"binder",list(reversed(self.results(record))))
        self.assertEqual(result["status"],"close-agreement")
        self.assertEqual({(r["cardId"],r["truthId"]) for r in result["matches"]},{("C1","T2"),("C2","T1")})
        self.assertTrue(all(r["meanCornerPixels"]==0 for r in result["matches"]))

    def test_rotated_order_flag_is_separate_from_outline_accuracy(self):
        record=self.record(); predictions=self.results(record)
        corners=predictions[0]["corners"];predictions[0]["corners"]=corners[2:]+corners[:2]
        result=compare(record,"binder",predictions)
        self.assertEqual(result["counts"]["topDifferences"],1)
        self.assertTrue(all(r["iou"]>.999 for r in result["matches"]))
        self.assertEqual(result["status"],"flagged")

    def test_imported_quads_do_not_claim_human_corner_or_top_errors(self):
        record=self.record(source="maskFit",orientation=False); predictions=self.results(record)
        predictions[0]["corners"]=predictions[0]["corners"][2:]+predictions[0]["corners"][:2]
        result=compare(record,"archive",predictions)
        self.assertEqual(result["basis"],"imported-geometry")
        self.assertEqual(result["status"],"close-agreement")
        self.assertTrue(all("meanCornerPixels" not in r for r in result["matches"]))

    def test_missing_and_duplicate_cards_are_distinct_and_inputs_unchanged(self):
        record=self.record(); before=copy.deepcopy(record); predictions=self.results(record)[:1]*2
        result=compare(record,"binder",predictions)
        self.assertEqual(result["missedTruthIds"],["T2"])
        self.assertEqual(result["counts"]["duplicates"],1)
        self.assertEqual(result["counts"]["extras"],0)
        self.assertEqual(record,before)


if __name__=="__main__":unittest.main()
