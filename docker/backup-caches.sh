#!/bin/bash
# TCG Cache Backup Script
# Creates compressed backups of all cache volumes for easy sharing

set -e

BACKUP_DIR="$HOME/tcg-cache-backups"
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="tcg-caches-$DATE"

echo "================================================"
echo "TCG Cache Backup Script"
echo "================================================"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR/$BACKUP_NAME"

echo "📦 Backing up cache volumes..."
echo ""

# Backup Scryfall (Magic)
if docker volume inspect docker_scryfall_bulk_data &>/dev/null; then
    echo "  🎴 Scryfall (Magic)..."
    docker run --rm \
        -v docker_scryfall_bulk_data:/data:ro \
        -v "$BACKUP_DIR/$BACKUP_NAME":/backup \
        alpine tar czf /backup/scryfall.tar.gz -C /data .
    SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME/scryfall.tar.gz" | cut -f1)
    echo "     ✅ Backed up ($SIZE)"
else
    echo "  ⏭️  Scryfall volume not found, skipping"
fi

# Backup YGO
if docker volume inspect docker_ygo_cache_data &>/dev/null; then
    echo "  🎴 Yu-Gi-Oh!..."
    docker run --rm \
        -v docker_ygo_cache_data:/data:ro \
        -v "$BACKUP_DIR/$BACKUP_NAME":/backup \
        alpine tar czf /backup/ygo.tar.gz -C /data .
    SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME/ygo.tar.gz" | cut -f1)
    echo "     ✅ Backed up ($SIZE)"
else
    echo "  ⏭️  YGO volume not found, skipping"
fi

# Backup TCGdex (Pokemon)
if docker volume inspect docker_tcgdex_cache_data &>/dev/null; then
    echo "  🎴 TCGdex (Pokemon)..."
    docker run --rm \
        -v docker_tcgdex_cache_data:/data:ro \
        -v "$BACKUP_DIR/$BACKUP_NAME":/backup \
        alpine tar czf /backup/tcgdex.tar.gz -C /data .
    SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME/tcgdex.tar.gz" | cut -f1)
    echo "     ✅ Backed up ($SIZE)"
else
    echo "  ⏭️  TCGdex volume not found, skipping"
fi

# Backup Pokemon (Official) if it has data
if docker volume inspect docker_pokemon_cache_data &>/dev/null; then
    if [ "$(docker run --rm -v docker_pokemon_cache_data:/data alpine sh -c 'ls /data 2>/dev/null | wc -l')" -gt 0 ]; then
        echo "  🎴 Pokemon (Official)..."
        docker run --rm \
            -v docker_pokemon_cache_data:/data:ro \
            -v "$BACKUP_DIR/$BACKUP_NAME":/backup \
            alpine tar czf /backup/pokemon.tar.gz -C /data .
        SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_NAME/pokemon.tar.gz" | cut -f1)
        echo "     ✅ Backed up ($SIZE)"
    else
        echo "  ⏭️  Pokemon cache is empty, skipping"
    fi
fi

echo ""
echo "📦 Creating final archive..."
cd "$BACKUP_DIR" && zip -q -r "$BACKUP_NAME.zip" "$BACKUP_NAME/"

echo ""
echo "================================================"
echo "✅ Backup Complete!"
echo "================================================"
echo ""
echo "📍 Location: $BACKUP_DIR/$BACKUP_NAME.zip"
echo "📦 Size: $(du -sh $BACKUP_DIR/$BACKUP_NAME.zip | cut -f1)"
echo ""
echo "You can now share this file via:"
echo "  • Google Drive"
echo "  • Dropbox"
echo "  • USB drive"
echo "  • Any file sharing service"
echo ""
echo "To restore, see: docker/CACHE_BACKUP_GUIDE.md"
echo ""
