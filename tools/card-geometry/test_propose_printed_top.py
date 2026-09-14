import unittest
from propose_printed_top import choose_top


def result(scores, accepted=True):
    phase = max(range(4), key=lambda i: scores[i])
    return dict(accepted=accepted, family='same-card', topScore=max(scores),
                phases=[dict(phase=i, topScore=s) for i, s in enumerate(scores)])


class PrintedTopTests(unittest.TestCase):
    def test_identity_confidence_does_not_establish_top(self):
        self.assertFalse(choose_top({'pokemon': result([.9, .89, .3, .2])})['proposed'])

    def test_rotation_can_be_proposed_when_separated(self):
        self.assertEqual(choose_top({'pokemon': result([.3, .8, .5, .3])})['phase'], 1)

    def test_conflicting_encoders_abstain(self):
        self.assertEqual(choose_top({'pokemon': result([.9, .2, .1, .1]), 'magic': result([.2, .1, .9, .1])})['reason'], 'encoders-disagree-on-top')

    def test_weak_identity_does_not_get_a_top_label(self):
        self.assertFalse(choose_top({'pokemon': result([.9, .2, .1, .1], False)})['proposed'])


if __name__ == '__main__':
    unittest.main()
