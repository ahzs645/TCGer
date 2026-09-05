# Bootstrap repair before optimization — 2026-09-05

The original four jobs were canceled during scheduling/bootstrap after YOLO11s startup logs showed that Ultralytics dependencies upgraded NumPy to 2.4.6. None had reached optimization. The other three were waiting for hardware or pulling their container. Cancellation receipts are retained in `../canceled-startup-jobs.json`.

The bootstrap now reinstalls NumPy 1.26.4 after every framework dependency and asserts the runtime version before loading the job bundle. Ten bootstrap tests and Ruff passed. This repairs dependency setup only; no corpus, policy, seed, budget, augmentation, evaluation, model architecture or optimizer setting changed.

Replacement configurations differ from the original frozen configurations only in `toolingRevision`; this was checked by comparing the complete resolved configurations and shared fairness hashes. The corpus remains `286d1196e9f0c85a37779ec52c6e9ba2f1533224a62c066dc93269c26720dbc4`, dataset revision `cabee73ac46a5901cc3060cfd17b7c63408bf66a`, policy `training-minimums-v3`, and fairness hash `64b2abc574cac41395b21945ce56f69bbd8c5173c7a2483529d1e72a65d041a5`.

`freeze.json` and `configs/` record the replacement tooling pin before resubmission. Original frozen input evidence remains in the parent directory. New publication and launch receipts are stored beside this file. Each replacement job keeps the 50-epoch budget and automatic pinned evaluation; no result was used to make this setup correction.
