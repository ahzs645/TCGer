import copy
import json
import tempfile
import unittest
from pathlib import Path

from corpus_release import sha256_file
from select_geometry_checkpoint import checkpoint_inventory, metrics, select, validation_coverage


def candidate(name, archive=.8, phone=.4):
    def scene(tight, n):
        return dict(records=n, truthInstances=n, matches=n, extra=0, duplicate=0, **{"recall@0.9":tight})
    benchmark = {"detection":{"bySceneSlice":{"archive":scene(archive, 500), "phone":scene(phone, 50)}},
                 "orientation":{"correctPairs":45, "eligiblePairs":50}}
    replay = {"frames":[dict(recordId="a",game="pokemon",expectation="identify",outcome="correct")]}
    return dict(id=name, metrics=metrics(benchmark,replay))


class CheckpointSelectionTests(unittest.TestCase):
    def test_border_gain_cannot_hide_phone_recall_or_extras_regression(self):
        base, new = candidate("old"), candidate("new",.95,.5)
        new["metrics"]["scenes"]["phone"].update(matches=49,extra=1)
        result=select([base,new],"old")
        self.assertEqual(result["bestBorderCheckpoint"],"new")
        self.assertEqual(result["recommendedDevelopmentCheckpoint"],"old")
        self.assertEqual(len(result["candidates"][1]["reasons"]),2)

    def test_true_improvement_wins_and_tie_preserves_incumbent(self):
        self.assertEqual(select([candidate("old"),candidate("better",.85,.45)],"old")
                         ["recommendedDevelopmentCheckpoint"],"better")
        self.assertEqual(select([candidate("aaa"),candidate("old")],"old")
                         ["recommendedDevelopmentCheckpoint"],"old")

    def test_orientation_and_wrong_recognition_are_independent_guards(self):
        old, new = candidate("old"), candidate("new",.9,.6)
        new["metrics"]["orientation"].update(correctPairs=40,eligiblePairs=40)
        new["metrics"]["recognition"]["pokemon:identify"].update(correct=0,wrong=1)
        result=select([old,new],"old")
        self.assertEqual(result["recommendedDevelopmentCheckpoint"],"old")
        self.assertEqual(len(result["candidates"][1]["reasons"]),3)

    def test_missing_slices_mixed_denominators_and_duplicate_ids_reject(self):
        old, new = candidate("old"), candidate("new")
        del new["metrics"]["scenes"]["phone"]
        with self.assertRaises(ValueError):select([old,new],"old")
        new=candidate("new")
        new["metrics"]["scenes"]["phone"]["truthInstances"]+=1
        with self.assertRaises(ValueError):select([old,new],"old")
        with self.assertRaises(ValueError):select([old,copy.deepcopy(old)],"old")

    def test_audit_does_not_count_train_or_synthetic_orientation_as_real_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            corners=[dict(coordinateKnown=True,point=dict(x=x,y=y)) for x,y in [(1,0),(1,1),(0,1),(0,0)]]
            record=dict(source=dict(width=100,height=150),instances=[dict(orientationKnown=True,corners=corners)])
            path=root/"record.json";path.write_text(json.dumps(record))
            entries=[dict(recordId=str(i),path=path.name,sha256=sha256_file(path),split=split,
                          sceneSlice="phone",leakageKeys=dict(sourceKind=kind))
                     for i,(split,kind) in enumerate([("train","real"),("validation","synthetic")])]
            manifest=dict(corpusHash="test",records=entries)
            (root/"manifest.json").write_text(json.dumps(manifest))
            audit=validation_coverage(root)
            self.assertFalse(audit["orientationSelectionReady"])
            self.assertEqual(audit["counts"]["realKnownOrientationFrames"],0)
            entries.append({**entries[0],"recordId":"real-val","split":"validation"})
            (root/"manifest.json").write_text(json.dumps(manifest))
            self.assertTrue(validation_coverage(root)["orientationSelectionReady"])
            weights=root/"training/repeat-0/weights";weights.mkdir(parents=True)
            for name in ("best","last","epoch1"):(weights/f"{name}.pt").write_bytes(name.encode())
            inventory=checkpoint_inventory(root,audit)
            self.assertEqual(len(inventory["candidates"]),3)
            self.assertIsNone(inventory["selectedCheckpoint"])


if __name__ == "__main__":unittest.main()
