# Service Pages API

This module is designed for multilingual SEO landing pages tied to taxonomy terms.

## Schema

- `service_pages`
  - root record for a service page family
  - stores `primary_service_term_id`, `page_kind`, and author/timestamps
- `service_page_translations`
  - one row per locale
  - stores content and SEO fields such as `title`, `slug`, `body_html`, `meta_title`, `meta_description`, `canonical_url`, and `is_indexable`
  - `canonical_url` is treated as an optional override; the API also returns an effective self-canonical when no override is stored
  - `schema_json` is treated as an optional JSON-LD override; the API also returns generated and effective schema payloads for service pages
- `service_page_term_relationships`
  - additional taxonomy links for filtering/reporting
  - always includes the primary service term as part of the relationship set

## Admin Endpoints

- `POST /service-pages`
- `POST /service-pages/:id`
- `GET /service-pages/:id`
- `DELETE /service-pages/:id`
- `POST /service-pages/report`
- `POST /service-pages/report/summary`

All admin endpoints require an authenticated admin token.

## Public Endpoints

- `GET /service-pages/public?locale=en&term_id=123&page_kind=primary&limit=20&offset=0`
- `GET /service-pages/public/en/divorce-consultation`

Only `published` translations are returned from public endpoints.

## Create Payload

```json
{
  "primary_service_term_id": 78,
  "page_kind": "primary",
  "related_term_ids": [77, 142],
  "translations": [
    {
      "locale": "en",
      "status": "published",
      "title": "Marriage Consultation",
      "slug": "marriage-consultation",
      "body_html": "<p>Detailed SEO content here</p>",
      "featured_image_url": "https://cdn.example.com/marriage.jpg",
      "featured_image_alt": "Marriage consultation service",
      "meta_title": "Marriage Consultation Lawyer Services",
      "meta_description": "Explore marriage consultation support and next legal steps.",
      "canonical_url": "",
      "og_title": "Marriage Consultation",
      "og_description": "Understand your options and legal support pathways.",
      "schema_json": "",
      "is_indexable": true
    }
  ]
}
```

## Update Notes

- `translations` upserts by locale
- `remove_locales` deletes locales by code
- `related_term_ids` replaces the existing relationship set
- `primary_service_term_id` updates the primary service term and is also kept inside the term relationship table
- when `canonical_url` is blank, the API resolves the effective canonical to `PUBLIC_SITE_BASE_URL + SERVICE_PAGE_PUBLIC_PATH_PREFIX + /:locale/:slug`
- when `schema_json` is blank, the API generates a default `Service` JSON-LD payload using the title, description, canonical URL, image, locale, and primary service term
- translation responses expose `schema_override_json`, `generated_schema_json`, and `effective_schema_json`

## Report Filters

`POST /service-pages/report` and `POST /service-pages/report/summary` accept:

```json
{
  "locales": ["en", "hi"],
  "statuses": ["draft", "published"],
  "page_kinds": ["primary"],
  "primary_service_term_ids": [78],
  "term_ids": [77, 142],
  "is_indexable": true,
  "has_featured_image": true,
  "missing_meta_title": false,
  "missing_meta_description": false,
  "search": "marriage",
  "published_from": "2026-01-01T00:00:00.000Z",
  "published_to": "2026-12-31T23:59:59.000Z",
  "updated_from": "2026-01-01T00:00:00.000Z",
  "updated_to": "2026-12-31T23:59:59.000Z",
  "sort_by": "updated_at",
  "sort_order": "desc",
  "limit": 50,
  "offset": 0
}
```

## Rollout

Apply the schema with:

```bash
psql -f node/db/schema/service_pages.sql
```
