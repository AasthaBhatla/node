#!/bin/bash
echo "📥 Pulling latest code from Git..."
git pull || { echo "❌ Git pull failed"; exit 1; }

echo "❌ Terminating Docker containers..."
docker compose down || { echo "❌ Docker down failed"; exit 1; }

echo "🔁 Rebuilding Docker containers..."
docker compose up -d --build || { echo "❌ Docker build failed"; exit 1; }

echo "🧠 Initiating database migrations..."
./migrate.sh || { echo "❌ Migration failed"; exit 1; }

echo "✅ Update complete!"