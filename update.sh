#!/bin/bash
set -euo pipefail

START_TS=$(date +%s)
START_HUMAN=$(date)

finish() {
  local exit_code=$?
  local end_ts elapsed h m s

  end_ts=$(date +%s)
  elapsed=$(( end_ts - START_TS ))

  h=$(( elapsed / 3600 ))
  m=$(( (elapsed % 3600) / 60 ))
  s=$(( elapsed % 60 ))

  if [ $exit_code -eq 0 ]; then
    echo "✅ Update complete!"
  else
    echo "❌ Script failed (exit code $exit_code)"
  fi

  echo "🕒 Started : $START_HUMAN"
  echo "🕒 Finished: $(date)"
  printf "⏱️  Total time: %02d:%02d:%02d (hh:mm:ss)\n" "$h" "$m" "$s"
  exit $exit_code
}

trap finish EXIT

echo "📥 Pulling latest code from Git..."
git pull

echo "❌ Terminating Docker containers..."
docker compose down

echo "🔁 Rebuilding Docker containers..."
docker compose up -d --build

echo "🧠 Initiating database migrations..."
./migrate.sh
