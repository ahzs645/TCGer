# Automatic studio backups

Configured September 10, 2026. Open **Backups** in the corner editor, archive/reference labeler, model review or completed-session gallery. The settings page is `http://127.0.0.1:8774/`. Paste an absolute destination path and select **Save folder** to change it. The existing parent folder must be available.

The configured destination on this Mac is:

```text
~/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference/TCGer-Labeling/automatic
```

## What is saved

- Changed durable text files under `.artifacts/card-geometry`: journals, queues, drafts, review history, predictions, comparison reports, training configurations and publication receipts. The service also preserves current card-geometry source code and scanner documentation.
- Archive and reference browser drafts receive a server recovery copy after one second without edits, with retry on failure. This does not approve cards. The tab reports when draft recovery is pending. Keep the tab open until recovery has saved; Save frame still controls confirmation.
- Native FiftyOne metadata exports preserve all sample fields, card polygons, saved views, app configuration and serialized evaluation/brain results. The service watches the session database and older scanner-review database separately. Exports include every dataset named `tcger…` that is present in a running database, so later datasets are included automatically.
- Original media uploaded through model review is included. Canonical session images already live in the sibling `TCGer-Session-Reference` folder.

File scans repeat after a ten-second interval. FiftyOne exports repeat after two minutes while the relevant database is running; export/copy time is additional. The service discovers each database by its actual MongoDB process and exact data directory, then connects using an explicit local URI. It never starts or copies a stopped database. The five older datasets are initially seeded from the verified September 10 native exports. Their last export date remains visible while that workbench is offline. The active `tcger-sessions` export was restored and checked against all manual fields: 712 samples and 13 saved views matched.

Generated crops, rendered galleries, downloaded weights, environments, large derived release/materialization trees and live MongoDB files are excluded. Source scripts and report data allow galleries to be regenerated. Existing dated preservation snapshots remain intact. This backup is not a complete clone of every file on the Mac; immutable media, training releases and checkpoint recovery locations are documented separately.

## Save status and failure handling

The studio link opens current file-copy and database-export status. If the destination is unavailable, editing and ordinary local saves still work; copying retries when the folder returns. Stable source reads avoid partial JSON/journal writes. A bad or changing file retains its previous backup version, other files continue copying, and the failure is displayed. Folder changes preserve the previous destination and start a complete copy into the new one.

A successful copy means the bytes in the local destination were checked by SHA-256. Google Drive handles the subsequent upload. **The service does not verify remote Google Drive sync completion.** When this Mac sleeps or is logged out, the service pauses; it resumes after login. Closing a studio also stops that studio's database updates, but existing exported state remains backed up.

## Version history and recovery

`objects/` contains content-addressed file versions. `snapshots/` retains dated manifests, and `latest.json` describes the newest snapshot. Identical file contents are stored once; old versions are never automatically deleted. Each new object is read back and hash-checked. Hourly integrity scans and **Back up files now** recheck existing objects too. If an object is damaged and its original source is still available with the expected hash, the service repairs that object from the verified source. Interrupted writes retain the previous good file version even after a service restart.

Restore into a **new** directory, then inspect before replacing any working journal:

```sh
python3 tools/card-geometry/studio_backup.py \
  --restore-files "/absolute/path/to/automatic" \
  --output "/absolute/path/to/new-restore-directory"
```

The command validates the manifest and object hashes and rejects unsafe paths. For a historical snapshot, make a separate temporary recovery folder containing that manifest as `latest.json` and a link to the original `objects` directory, then use the same command. Never replace the live backup's `latest.json` to select history.

Restored `fiftyone/<database>/<hash>.tar.gz` files contain the native metadata-only FiftyOne export. Extract a selected archive into a new folder with Python `tarfile`'s `filter='data'`, then import using `fo.Dataset.from_dir(dataset_dir=..., dataset_type=fo.types.FiftyOneDataset, name='new-recovery-name')`. Keep the recovered dataset separate until samples, manual geometry, views and media paths have been checked. Media paths retain the original absolute locations; a different Mac may need path remapping. Never restore raw live MongoDB files from Drive.

## Service and configuration

- Implementation: `tools/card-geometry/studio_backup.py` and `studio-backup.html`.
- Config: `~/.config/tcger/studio-backup.json`. The settings page edits its destination. Advanced source/database paths live here too.
- Local export cache, receipts and service logs: `~/.local/share/TCGer/studio-backup/`.
- macOS login service: `~/Library/LaunchAgents/app.tcger.studio-backup.plist` (`RunAtLoad`, `KeepAlive`). It runs the labeling Python environment and the repository script, bound to loopback port 8774. Moving the repository or Python environment requires updating these paths.

Validation covers version retention, restoring changed labels, changing destinations, interrupted journals, unavailable folders, corrupted objects, path safety and deterministic native exports. The real session export was separately restored and all `manual_*` fields and saved views compared. Tests use temporary sources and recovery datasets; the user's labels remain unchanged.
