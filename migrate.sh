#!/bin/bash
echo "Running DB migrations..."
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/users.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/taxonomy.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/requests.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/locations.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/languages.sql
docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/banner.sql
echo "✅ All done!"