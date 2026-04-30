# Services API

## Admin services
- `POST /services`
- `POST /services/:id`
- `GET /services/:id`
- `DELETE /services/:id`
- `POST /services/report`
- `POST /services/report/summary`

## Public services
- `GET /services/public?term_id=123&location_id=1&language_id=44&search=notice&limit=20&offset=0`
- `GET /services/public/filters`
- `GET /services/public/:slug`

## Admin service requests
- `POST /service-requests/report`
- `GET /service-requests/:id`
- `POST /service-requests/:id/status`

## User service requests
- `POST /service-requests/checkout`
- `GET /service-requests/me`
- `GET /service-requests/me/:id`

## Notes
- Services are structured records with variants, FAQs, testimonials, CTAs, trust badges, and one shared intake form.
- Service checkout creates a `service_request` and an `orders` row with `order_mode = service`.
- Service orders never grant wallet credits.
- Legacy `service_pages` content is archived and backfilled into `services` through `db/schema/services.sql` when the legacy tables already exist.
