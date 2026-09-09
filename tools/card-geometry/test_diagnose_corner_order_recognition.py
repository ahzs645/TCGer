import unittest
from unittest.mock import patch

import numpy as np

from diagnose_corner_order_recognition import cyclic_crops


class CyclicCropTests(unittest.TestCase):
    def test_rewarps_quarter_turn_without_reversing_and_preserves_legacy_pair(self):
        image = np.zeros((20, 30, 3), dtype=np.uint8)
        image[:10, :15] = [255, 0, 0]
        quad = [[.1, .2], [.8, .1], [.9, .9], [.2, .8]]
        with patch('diagnose_corner_order_recognition.warp_reference', return_value=image) as warp:
            crops = cyclic_crops(image, quad)
        self.assertEqual([phase for phase, _ in crops], [0, 2, 1, 3])
        self.assertEqual(warp.call_args_list[0].args[1], quad)
        self.assertEqual(warp.call_args_list[1].args[1], quad[1:] + quad[:1])
        np.testing.assert_array_equal(np.asarray(crops[1][1]), np.asarray(crops[0][1].rotate(180)))
        np.testing.assert_array_equal(np.asarray(crops[3][1]), np.asarray(crops[2][1].rotate(180)))


if __name__ == '__main__':
    unittest.main()
