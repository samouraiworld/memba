#!/bin/sh
set -e

DB=/data/memba.db
# The integrity-check subcommand reads DB_PATH; keep it pinned to the same file.
export DB_PATH="$DB"

if [ -f "$DB" ]; then
    # Gate the existing file on PRAGMA integrity_check (via the app binary — the
    # runtime image has no sqlite3 CLI). Previously a present-but-corrupt file
    # was trusted as-is and Litestream replicated the corruption forward into
    # the S3 replica, aging the last good snapshot out of the 168h retention.
    if ./memba integrity-check; then
        echo "Database passes integrity check"
    else
        TS=$(date -u +%Y%m%d_%H%M%S)
        echo "CORRUPT database detected — quarantining to ${DB}.corrupt-${TS} and restoring from replica"
        mv "$DB" "${DB}.corrupt-${TS}"
        if [ -f "${DB}-wal" ]; then mv "${DB}-wal" "${DB}-wal.corrupt-${TS}"; fi
        if [ -f "${DB}-shm" ]; then mv "${DB}-shm" "${DB}-shm.corrupt-${TS}"; fi
        # Deliberately NO -if-replica-exists and NO || true here: with a corrupt
        # local DB, silently booting a fresh empty database would present as
        # total data loss. Fail loudly instead; recovery = manual Litestream
        # restore per OPS_RUNBOOK §4.7, or a volume snapshot per §4.3. (The old
        # /data/backups VACUUM copies are RETIRED — W2.3; any leftovers on the
        # volume are stale.)
        litestream restore -v -config /etc/litestream.yml -o "$DB" "$DB"
    fi
else
    echo "No database found, attempting to restore from replica"
    # First boot has no replica yet — that's fine, the app creates a fresh DB.
    litestream restore -v -if-replica-exists -config /etc/litestream.yml -o "$DB" "$DB" || true
fi

# Litestream owns WAL checkpointing from here on; the app must not checkpoint
# (see litestreamManaged in cmd/memba/main.go).
export LITESTREAM_MANAGED=1

# Run litestream with your app as the subprocess.
exec litestream replicate -exec "./memba" -config /etc/litestream.yml
