#!/bin/sh
set -e

# Restore the database if it does not exist.
# This assumes that if memba.db exists, it's either populated or a new db we want to keep.
if [ -f "/data/memba.db" ]; then
    echo "Database already exists, skipping restore"
else
    echo "No database found, attempting to restore from replica"
    # We ignore errors here because the replica may not exist yet on the first run.
    litestream restore -v -if-replica-exists -config /etc/litestream.yml -o /data/memba.db /data/memba.db || true
fi

# Run litestream with your app as the subprocess.
exec litestream replicate -exec "./memba" -config /etc/litestream.yml
