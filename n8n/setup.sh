#!/bin/sh
# Imports the LendLoop workflows and SMTP credential into the local n8n
# container, activates them, and restarts n8n so the activation applies.
#   docker compose up -d && ./n8n/setup.sh
set -eu
cd "$(dirname "$0")/.."

# On its first start n8n migrates its SQLite database. Importing at the same
# time fails with SQLITE_BUSY and crashes n8n, so wait until it reports ready.
echo "Waiting for n8n to be ready..."
docker compose up -d --wait n8n

docker compose exec -T n8n sh /lendloop/setup/bootstrap.sh
docker compose restart n8n
docker compose up -d --wait n8n
echo "n8n is ready at http://localhost:5678 (Mailpit inbox: http://localhost:8025)"
