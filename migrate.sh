#!/bin/bash
echo "Setting directories for DB migrations"

cd "$(dirname "$0")"  # go to the script's directory

echo "Running DB migrations..."

docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/requests.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/banner.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/languages.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/locations.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/users.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/taxonomy.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/posts.sql

echo "DB Migrations complete"