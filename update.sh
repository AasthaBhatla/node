#!/bin/bash
echo "📥 Pulling latest code from Git..."
git fetch origin
git reset --hard origin/main
git pull origin main || { echo "❌ Git pull failed"; exit 1; }

echo "🔁 Rebuilding Docker containers..."
cd .. || exit
docker compose up -d --build || { echo "❌ Docker build failed"; exit 1; }

echo "🧠 Initiating database migrations..."
cd express-api || exit
./migrate.sh || { echo "❌ Migration failed"; exit 1; }

echo "✅ Update complete!"