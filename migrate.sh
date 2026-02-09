#!/bin/bash
echo "Setting directories for DB migrations"

cd "$(dirname "$0")"  # go to the script's directory

echo "Running DB migrations..."

# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/requests.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/users.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/taxonomy.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/posts.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/reviews.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/workspace.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/products.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/order.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/order_items.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/wallet.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/sessions.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/notifications.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/options.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/jobs.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/volunteer_applications.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/ngo_help_requests.sql
# docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/schema/appointments.sql



echo "DB Migrations complete"