import unittest
from replay_instance_identities import match_cards


class InstanceMatchingTests(unittest.TestCase):
    def test_lower_confidence_card_is_matched_and_predictions_are_not_reused(self):
        left=[[0,0],[.4,0],[.4,1],[0,1]];right=[[.6,0],[1,0],[1,1],[.6,1]]
        cards=[dict(id='left',quad=left),dict(id='right',quad=right)]
        def prediction(quad,confidence):return dict(confidence=confidence,corners=[dict(point={'x':x,'y':y}) for x,y in quad])
        result=match_cards(cards,[prediction(left,.99),prediction(right,.1)])
        self.assertEqual(result['right']['prediction'],1)
        result=match_cards(cards,[prediction(left,.99)])
        self.assertEqual(result['left']['prediction'],0)
        self.assertIsNone(result['right']['prediction'])
        self.assertEqual(match_cards(cards,[])['right']['iou'],0)


if __name__=='__main__':unittest.main()
