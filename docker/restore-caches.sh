#!/bin/bash
# TCG Cache Restore Script
# Restores cache volumes from backup files

set -e

if [ $# -eq 0 ]; then
    echo "Usage: ./restore-caches.sh <backup-directory>"
    echo ""
    echo "Example:"
    echo "  ./restore-caches.sh ~/tcg-cache-backups/tcg-caches-20250124-120000"
    echo ""
    echo "Or if you have a zip file:"
    echo "  unzip tcg-caches-20250124-120000.zip"
    echo "  ./restore-caches.sh tcg-caches-20250124-120000"
    exit 1
fi

BACKUP_DIR="$1"

if [ ! -d "$BACKUP_DIR" ]; then
    echo "❌ Error: Directory not found: $BACKUP_DIR"
    exit 1
fi

echo "================================================"
echo "TCG Cache Restore Script"
echo "================================================"
echo ""
echo "📍 Restoring from: $BACKUP_DIR"
echo ""

# Create volumes if they don't exist
echo "🔧 Creating Docker volumes..."
docker volume create docker_scryfall_bulk_data 2>/dev/null || true
docker volume create docker_ygo_cache_data 2>/dev/null || true
docker volume create docker_tcgdex_cache_data 2>/dev/null || true
docker volume create docker_pokemon_cache_data 2>/dev/null || true
echo ""

echo "📦 Restoring cache data..."
echo ""

# Restore Scryfall
if [ -f "$BACKUP_DIR/scryfall.tar.gz" ]; then
    echo "  🎴 Scryfall (Magic)..."
    docker run --rm \
        -v docker_scryfall_bulk_data:/data \
        -v "$BACKUP_DIR":/backup:ro \
        alpine sh -c 'rm -rf /data/* && tar xzf /backup/scryfall.tar.gz -C /data'
    echo "     ✅ Restored"
else
    echo "  ⏭️  No Scryfall backup found, skipping"
fi

# Restore YGO
if [ -f "$BACKUP_DIR/ygo.tar.gz" ]; then
    echo "  🎴 Yu-Gi-Oh!..."
    docker run --rm \
        -v docker_ygo_cache_data:/data \
        -v "$BACKUP_DIR":/backup:ro \
        alpine sh -c 'rm -rf /data/* && tar xzf /backup/ygo.tar.gz -C /data'
    echo "     ✅ Restored"
else
    echo "  ⏭️  No YGO backup found, skipping"
fi

# Restore TCGdex
if [ -f "$BACKUP_DIR/tcgdex.tar.gz" ]; then
    echo "  🎴 TCGdex (Pokemon)..."
    docker run --rm \
        -v docker_tcgdex_cache_data:/data \
        -v "$BACKUP_DIR":/backup:ro \
        alpine sh -c 'rm -rf /data/* && tar xzf /backup/tcgdex.tar.gz -C /data'
    echo "     ✅ Restored"
else
    echo "  ⏭️  No TCGdex backup found, skipping"
fi

# Restore Pokemon (Official)
if [ -f "$BACKUP_DIR/pokemon.tar.gz" ]; then
    echo "  🎴 Pokemon (Official)..."
    docker run --rm \
        -v docker_pokemon_cache_data:/data \
        -v "$BACKUP_DIR":/backup:ro \
        alpine sh -c 'rm -rf /data/* && tar xzf /backup/pokemon.tar.gz -C /data'
    echo "     ✅ Restored"
else
    echo "  ⏭️  No Pokemon backup found, skipping"
fi

echo ""
echo "================================================"
echo "✅ Restore Complete!"
echo "================================================"
echo ""
echo "To start the services with the restored caches:"
echo "  cd docker"
echo "  docker compose --profile bulk up -d"
echo ""
