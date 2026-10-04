#!/usr/bin/env python3
"""Capture only The Tin's catalog payloads using the normal paired-device backup service.

Run with: uvx --from pymobiledevice3==10.4.1 python capture_iphone.py --device UDID --out DIRECTORY
This is a filtered extraction, not a restorable full-device backup.
"""
import argparse
import asyncio
from hashlib import sha1
from pathlib import Path
import shutil

DOMAIN = 'AppDomain-ai.reyes.thetin'
PATHS = {f'Library/Application Support/Catalog/{name}' for name in (
    'catalog.sqlite', 'catalog.sqlite-wal', 'catalog.sqlite-shm', 'catalog-state.json')}
FILE_IDS = {sha1(f'{DOMAIN}-{path}'.encode()).hexdigest() for path in PATHS}
DEVICE_PATHS = {f'{DOMAIN}{separator}{path}' for path in PATHS for separator in ('/', '-')}


def selected(file):
    # Backup targets are named SHA-1(domain + '-' + relativePath). This also
    # selects correctly when the device-side path contains an opaque container UUID.
    return bool((file.file_name and Path(file.file_name).name in FILE_IDS)
                or (file.device_name and file.device_name in DEVICE_PATHS)
                or (file.domain == DOMAIN and file.relative_path in PATHS))


async def capture(device, output):
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.mobilebackup2 import Mobilebackup2Service

    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    counts = {'kept': 0, 'discarded': 0}

    def keep(file):
        result = selected(file)
        counts['kept' if result else 'discarded'] += 1
        if result:
            print(f"Retaining catalog payload #{counts['kept']}", flush=True)
        return result

    last_progress = -1

    def progress(percent):
        nonlocal last_progress
        integer = int(percent)
        if integer >= last_progress + 2:
            print(f'Backup progress: {integer}%', flush=True)
            last_progress = integer

    async with await create_using_usbmux(serial=device) as lockdown:
        async with Mobilebackup2Service(lockdown) as service:
            if await service.get_will_encrypt():
                raise RuntimeError('Backup encryption is enabled. Unlock/export the backup locally; do not send its password in chat.')
            task = asyncio.create_task(service.backup(full=False, backup_directory=output,
                filter_callback=keep, progress_callback=progress))

            async def monitor():
                while True:
                    await asyncio.sleep(20)
                    free = shutil.disk_usage(output).free
                    print(f"Status: {counts['kept']} catalog payloads retained, {counts['discarded']} payloads discarded; {free / 2**30:.1f} GiB free", flush=True)
                    if free < 5 * 2**30:
                        print('Stopping capture: less than 5 GiB free', flush=True)
                        task.cancel()
                        return

            watcher = asyncio.create_task(monitor())
            try:
                await task
            finally:
                watcher.cancel()
                await asyncio.gather(watcher, return_exceptions=True)
    print(f'Capture complete: {counts}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(capture(args.device, args.out.resolve()))
