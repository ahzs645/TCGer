# Cache Backup & Transfer Guide

This guide shows you how to backup, transfer, and restore the TCG cache data without re-downloading everything.

## Current Cache Sizes

- **Scryfall (Magic)**: ~157 MB (35,847 cards)
- **YGO**: ~19 MB (13,990 cards)
- **TCGdex (Pokemon)**: ~3 MB (21,632 cards)
- **Total**: ~179 MB

## Method 1: Export/Import Docker Volumes (Recommended for Sharing)

### Backup All Caches

```bash
# Create a backup directory
mkdir -p ~/tcg-cache-backups

# Export each cache volume to a tar file
docker run --rm -v docker_scryfall_bulk_data:/data -v ~/tcg-cache-backups:/backup alpine tar czf /backup/scryfall-cache.tar.gz -C /data .
docker run --rm -v docker_ygo_cache_data:/data -v ~/tcg-cache-backups:/backup alpine tar czf /backup/ygo-cache.tar.gz -C /data .
docker run --rm -v docker_tcgdex_cache_data:/data -v ~/tcg-cache-backups:/backup alpine tar czf /backup/tcgdex-cache.tar.gz -C /data .

echo "Backups created in ~/tcg-cache-backups/"
ls -lh ~/tcg-cache-backups/
```

### Transfer to Another Computer

1. **Upload to Google Drive / Dropbox / etc.**
   ```bash
   # Zip all backups together
   cd ~/tcg-cache-backups
   zip -r tcg-all-caches.zip *.tar.gz
   # Upload tcg-all-caches.zip to Google Drive
   ```

2. **Or use a USB drive**
   ```bash
   cp ~/tcg-cache-backups/*.tar.gz /Volumes/YOUR_USB_DRIVE/
   ```

### Restore on Another Computer

```bash
# On the new computer, download the backup files
# Make sure Docker is installed and the project is cloned

cd /path/to/TCGer

# Create the volumes first
docker volume create docker_scryfall_bulk_data
docker volume create docker_ygo_cache_data
docker volume create docker_tcgdex_cache_data

# Restore each cache
docker run --rm -v docker_scryfall_bulk_data:/data -v ~/tcg-cache-backups:/backup alpine tar xzf /backup/scryfall-cache.tar.gz -C /data
docker run --rm -v docker_ygo_cache_data:/data -v ~/tcg-cache-backups:/backup alpine tar xzf /backup/ygo-cache.tar.gz -C /data
docker run --rm -v docker_tcgdex_cache_data:/data -v ~/tcg-cache-backups:/backup alpine tar xzf /backup/tcgdex-cache.tar.gz -C /data

# Start the services
cd docker
docker compose --profile bulk up -d
```

## Method 2: Use Bind Mounts (Easier for Direct Access)

Instead of Docker volumes, you can use local directories that are easier to backup/share.

### Update docker-compose.yml

Replace the volume sections with bind mounts:

```yaml
services:
  scryfall-bulk:
    volumes:
      - ../cache-data/scryfall:/data  # Changed from scryfall_bulk_data:/data

  ygo-cache:
    volumes:
      - ../cache-data/ygo:/data  # Changed from ygo_cache_data:/data

  tcgdex-cache:
    volumes:
      - ../cache-data/tcgdex:/data  # Changed from tcgdex_cache_data:/data

# Remove or comment out the volumes section at the bottom
# volumes:
#   scryfall_bulk_data:
#   ygo_cache_data:
#   tcgdex_cache_data:
```

### With Bind Mounts, Sharing is Simple

```bash
# Just copy the cache-data directory
cp -r cache-data ~/Desktop/tcg-caches-to-share/

# Or zip it
zip -r tcg-caches.zip cache-data/

# On another computer, just unzip and start
unzip tcg-caches.zip
cd docker
docker compose --profile bulk up -d
```

## Method 3: Automated Backup Script

Create a script to automate backups:

```bash
#!/bin/bash
# save as: backup-caches.sh

BACKUP_DIR="$HOME/tcg-cache-backups"
DATE=$(date +%Y%m%d)
BACKUP_NAME="tcg-caches-$DATE"

mkdir -p "$BACKUP_DIR/$BACKUP_NAME"

echo "Backing up TCG caches..."

docker run --rm \
  -v docker_scryfall_bulk_data:/scryfall:ro \
  -v docker_ygo_cache_data:/ygo:ro \
  -v docker_tcgdex_cache_data:/tcgdex:ro \
  -v "$BACKUP_DIR/$BACKUP_NAME":/backup \
  alpine sh -c '
    tar czf /backup/scryfall.tar.gz -C /scryfall . && \
    tar czf /backup/ygo.tar.gz -C /ygo . && \
    tar czf /backup/tcgdex.tar.gz -C /tcgdex .
  '

echo "Creating archive..."
cd "$BACKUP_DIR" && zip -r "$BACKUP_NAME.zip" "$BACKUP_NAME/"

echo "Backup complete: $BACKUP_DIR/$BACKUP_NAME.zip"
echo "Size: $(du -sh $BACKUP_DIR/$BACKUP_NAME.zip | cut -f1)"
```

Make it executable and run:
```bash
chmod +x backup-caches.sh
./backup-caches.sh
```

## Quick Commands Reference

### Check cache sizes
```bash
docker run --rm -v docker_scryfall_bulk_data:/data alpine du -sh /data
docker run --rm -v docker_ygo_cache_data:/data alpine du -sh /data
docker run --rm -v docker_tcgdex_cache_data:/data alpine du -sh /data
```

### List what's in a cache
```bash
docker run --rm -v docker_scryfall_bulk_data:/data alpine ls -lh /data
```

### Copy cache to local directory
```bash
mkdir -p ~/tcg-local-caches
docker run --rm -v docker_scryfall_bulk_data:/data -v ~/tcg-local-caches:/backup alpine cp -r /data/. /backup/scryfall/
```

## Recommended Workflow for Friends

1. **You**: Run the backup script to create `tcg-caches-YYYYMMDD.zip`
2. **You**: Upload to Google Drive and share the link
3. **Friend**: Download the zip file
4. **Friend**: Clone the TCGer repository
5. **Friend**: Extract the zip and run the restore commands from Method 1
6. **Friend**: Start services with `docker compose --profile bulk up -d`

Done! No API keys needed, no waiting for downloads.

## Notes

- The caches auto-refresh periodically (check each service's README for intervals)
- You can disable auto-refresh by setting `*_REFRESH_MS=0` in environment variables
- Backups are snapshots - they won't include updates after the backup date
- Official Pokemon cache is currently empty due to API issues, but TCGdex works perfectly
