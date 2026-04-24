#!/bin/bash
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_digitalOcean_kaptaan}"
SSH_HOST="${SSH_HOST:-mridul@167.71.239.140}"
REMOTE_DIR="${REMOTE_DIR:-kaptaan-docker-stack/express-api}"

echo "Deploying API to ${SSH_HOST}:${REMOTE_DIR}"

ssh -i "${SSH_KEY}" "${SSH_HOST}" <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
./update.sh
EOF
