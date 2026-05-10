BEGIN;

-- Seed five published document services under the services taxonomy term:
-- "Drafting or Reviewing a Contract / Agreement".
--
-- Usage:
--   docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/seed_service_agreement_testing.sql

INSERT INTO languages (slug, title)
VALUES
  ('english', 'English'),
  ('hindi', 'Hindi'),
  ('hinglish', 'Hinglish')
ON CONFLICT (slug) DO UPDATE
SET title = EXCLUDED.title;

INSERT INTO locations (slug, title)
VALUES
  ('all-india', 'All India'),
  ('delhi', 'Delhi'),
  ('mumbai', 'Mumbai'),
  ('bengaluru', 'Bengaluru'),
  ('pune', 'Pune')
ON CONFLICT (slug) DO UPDATE
SET title = EXCLUDED.title;

DO $$
DECLARE
  v_services_taxonomy_id INT;
BEGIN
  INSERT INTO taxonomy (slug, title, type)
  VALUES ('services', 'Services', ARRAY['content', 'commerce'])
  ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title;

  SELECT id
  INTO v_services_taxonomy_id
  FROM taxonomy
  WHERE slug = 'services'
  LIMIT 1;

  UPDATE terms AS existing
  SET title = incoming.title,
      updated_at = CURRENT_TIMESTAMP
  FROM (
    VALUES
      ('drafting-or-reviewing-a-contract-agreement', 'Drafting or Reviewing a Contract / Agreement')
  ) AS incoming(slug, title)
  WHERE existing.taxonomy_id = v_services_taxonomy_id
    AND existing.slug = incoming.slug;

  INSERT INTO terms (taxonomy_id, slug, title)
  SELECT
    v_services_taxonomy_id,
    incoming.slug,
    incoming.title
  FROM (
    VALUES
      ('drafting-or-reviewing-a-contract-agreement', 'Drafting or Reviewing a Contract / Agreement')
  ) AS incoming(slug, title)
  WHERE NOT EXISTS (
    SELECT 1
    FROM terms existing
    WHERE existing.taxonomy_id = v_services_taxonomy_id
      AND existing.slug = incoming.slug
  );
END $$;

CREATE OR REPLACE FUNCTION seed_service_agreement_variant(
  p_service_id BIGINT,
  p_title TEXT,
  p_summary TEXT,
  p_price_paise INT,
  p_compare_at_price_paise INT,
  p_duration_text TEXT,
  p_turnaround_time_text TEXT,
  p_sort_order INT,
  p_is_default BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE service_variants
  SET summary = p_summary,
      price_paise = p_price_paise,
      compare_at_price_paise = p_compare_at_price_paise,
      duration_text = p_duration_text,
      turnaround_time_text = p_turnaround_time_text,
      sort_order = p_sort_order,
      is_default = p_is_default,
      is_active = TRUE,
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = p_service_id
    AND title = p_title;

  IF NOT FOUND THEN
    INSERT INTO service_variants (
      service_id,
      title,
      summary,
      price_paise,
      compare_at_price_paise,
      duration_text,
      turnaround_time_text,
      sort_order,
      is_default,
      is_active
    ) VALUES (
      p_service_id,
      p_title,
      p_summary,
      p_price_paise,
      p_compare_at_price_paise,
      p_duration_text,
      p_turnaround_time_text,
      p_sort_order,
      p_is_default,
      TRUE
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION seed_service_agreement_service(
  p_title TEXT,
  p_slug TEXT,
  p_short_description TEXT,
  p_image_seed TEXT,
  p_focus TEXT,
  p_standard_variant TEXT,
  p_review_variant TEXT,
  p_premium_variant TEXT,
  p_base_price_paise INT,
  p_consultations_count INT,
  p_days_back INT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id
  INTO v_services_taxonomy_id
  FROM taxonomy
  WHERE slug = 'services'
  LIMIT 1;

  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'drafting-or-reviewing-a-contract-agreement'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for %', p_slug;
  END IF;

  INSERT INTO services (
    status,
    service_type,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    custom_content_title,
    custom_content_html,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
    benefit_cards,
    problems_covered,
    included_items,
    excluded_items,
    required_information,
    deliverables,
    documents_required,
    process_steps,
    duration_text,
    turnaround_time_text,
    disclaimer_text,
    refund_cancellation_policy_text,
    location_coverage_note,
    consultations_completed_count,
    current_viewers_count,
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'documents',
    p_title,
    p_slug,
    p_short_description,
    'https://picsum.photos/seed/' || p_image_seed || '/1600/900',
    'Contract papers, notes, and a laptop prepared for agreement drafting',
    p_title || ' scope',
    '<p>This seeded service helps test agreement drafting and review flows for ' || p_focus || '.</p><p>It includes document upload, pricing variants, service CTAs, and structured intake fields.</p>',
    p_title || ' | Kaptaan Testing',
    'Seeded document service for testing service agreement primary mapping, pricing variants, and agreement intake forms.',
    NULL,
    p_title || ' | Kaptaan',
    p_short_description,
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Founders, freelancers, consultants, and small businesses preparing an agreement',
      'Teams that already have a draft and need a clause-level legal review',
      'Individuals who want clear payment, scope, confidentiality, and termination terms before signing'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Cleaner scope',
        'description', 'Turn business understanding into a document with clear roles, timelines, fees, and responsibilities.',
        'icon', 'fa-solid fa-file-signature',
        'tone', 'violet'
      ),
      jsonb_build_object(
        'title', 'Risk flags',
        'description', 'Spot clauses around liability, termination, intellectual property, and confidentiality before execution.',
        'icon', 'fa-solid fa-shield-halved',
        'tone', 'blue'
      ),
      jsonb_build_object(
        'title', 'Faster review',
        'description', 'Use a structured intake so the reviewer can focus on the actual agreement risks instead of repeated clarification.',
        'icon', 'fa-solid fa-user-check',
        'tone', 'green'
      )
    ),
    to_jsonb(ARRAY[
      'Unclear scope, milestones, or deliverables in the agreement',
      'Payment terms, late fees, deposits, or retainer language that needs tightening',
      'Confidentiality, intellectual property, and non-solicit clauses needing review',
      'Termination, renewal, and dispute handling language that is incomplete',
      p_focus
    ]::text[]),
    to_jsonb(ARRAY[
      'Agreement draft or review based on the chosen variant',
      'Clause-level comments for important risk areas',
      'One structured revision round',
      'Plain-language execution checklist',
      'Suggested next step where negotiation or stamping is needed'
    ]::text[]),
    to_jsonb(ARRAY[
      'Negotiation calls with the opposite party',
      'Stamp duty payment, registration, or notarisation fees',
      'Court filing, arbitration, or dispute representation',
      'Unlimited revisions after commercial terms change'
    ]::text[]),
    to_jsonb(ARRAY[
      'Names and roles of all parties',
      'Commercial terms, fees, deposits, or payment schedule',
      'Scope of work, deliverables, timelines, and milestones',
      'Any existing draft, email thread, quotation, or term sheet',
      'Clauses you specifically want added, removed, or reviewed'
    ]::text[]),
    to_jsonb(ARRAY[
      'Final agreement draft or reviewed markup',
      'Risk summary covering key clauses',
      'Revision copy where applicable',
      'Execution guidance note'
    ]::text[]),
    to_jsonb(ARRAY[
      'Existing agreement draft if available',
      'Term sheet, quotation, proposal, or email understanding',
      'Identity or business details of parties',
      'Reference agreement or clause notes if you have them'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Share commercial terms',
        'description', 'Submit party names, scope, pricing, payment terms, timelines, and the agreement draft if one exists.'
      ),
      jsonb_build_object(
        'title', 'Legal review',
        'description', 'A legal expert checks the clause structure and flags gaps that could affect delivery, payment, or enforcement.'
      ),
      jsonb_build_object(
        'title', 'Draft or markup',
        'description', 'You receive a fresh draft or reviewed document depending on the selected service variant.'
      ),
      jsonb_build_object(
        'title', 'Finalize next steps',
        'description', 'The final package includes practical signing, stamping, or negotiation guidance where relevant.'
      )
    ),
    'Most agreement services take 1 to 3 business days after the complete draft and commercial terms are shared.',
    'Simple reviews can often be returned within 24 hours; fresh drafting and premium review usually take 48 to 72 hours.',
    'This seeded service is for testing and general drafting workflow validation. Final applicability depends on matter review and jurisdiction-specific requirements.',
    'The review component is generally non-refundable once work starts. Material changes to business terms after delivery may need a fresh scope.',
    'Remote-friendly agreement drafting and review support across India.',
    p_consultations_count,
    11 + p_days_back,
    8,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support'
    ]::text[]),
    CURRENT_TIMESTAMP - (p_days_back || ' days')::interval,
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      service_type = EXCLUDED.service_type,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      custom_content_title = EXCLUDED.custom_content_title,
      custom_content_html = EXCLUDED.custom_content_html,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
      benefit_cards = EXCLUDED.benefit_cards,
      problems_covered = EXCLUDED.problems_covered,
      included_items = EXCLUDED.included_items,
      excluded_items = EXCLUDED.excluded_items,
      required_information = EXCLUDED.required_information,
      deliverables = EXCLUDED.deliverables,
      documents_required = EXCLUDED.documents_required,
      process_steps = EXCLUDED.process_steps,
      duration_text = EXCLUDED.duration_text,
      turnaround_time_text = EXCLUDED.turnaround_time_text,
      disclaimer_text = EXCLUDED.disclaimer_text,
      refund_cancellation_policy_text = EXCLUDED.refund_cancellation_policy_text,
      location_coverage_note = EXCLUDED.location_coverage_note,
      consultations_completed_count = EXCLUDED.consultations_completed_count,
      current_viewers_count = EXCLUDED.current_viewers_count,
      years_of_experience = EXCLUDED.years_of_experience,
      enabled_trust_badges = EXCLUDED.enabled_trust_badges,
      published_at = EXCLUDED.published_at,
      updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_service_id;

  DELETE FROM service_term_relationships WHERE service_id = v_service_id;
  INSERT INTO service_term_relationships (service_id, term_id)
  SELECT DISTINCT ON (t.slug) v_service_id, t.id
  FROM terms t
  WHERE t.taxonomy_id = v_services_taxonomy_id
    AND t.slug IN (
      'drafting-or-reviewing-a-contract-agreement',
      'contract-law',
      'businesses',
      'individuals'
    )
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'delhi', 'mumbai', 'bengaluru', 'pune');

  DELETE FROM service_language_relationships WHERE service_id = v_service_id;
  INSERT INTO service_language_relationships (service_id, language_id)
  SELECT v_service_id, language.id
  FROM languages AS language
  WHERE language.slug IN ('english', 'hindi', 'hinglish');

  UPDATE service_variants
  SET is_active = FALSE,
      is_default = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = v_service_id;

  PERFORM seed_service_agreement_variant(
    v_service_id,
    p_standard_variant,
    'Best when you need a clean first draft based on agreed commercial terms.',
    p_base_price_paise,
    p_base_price_paise + 50000,
    '1 to 2 business days',
    'Usually delivered within 24 to 48 hours',
    0,
    TRUE
  );

  PERFORM seed_service_agreement_variant(
    v_service_id,
    p_review_variant,
    'Best when you already have a draft and want legal comments before signing.',
    GREATEST(p_base_price_paise - 50000, 99900),
    p_base_price_paise,
    'Same-day to 1 business day review',
    'Usually completed within 24 hours',
    1,
    FALSE
  );

  PERFORM seed_service_agreement_variant(
    v_service_id,
    p_premium_variant,
    'Adds deeper clause notes, a stronger risk summary, and a revision round for complex terms.',
    p_base_price_paise + 150000,
    p_base_price_paise + 225000,
    '2 to 3 business days',
    'Usually completed within 48 to 72 hours',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Can you work from an existing draft?', 'Yes. Select the review variant and upload the current draft, term sheet, or email summary.', 0),
    (v_service_id, 'Will this include negotiation with the other party?', 'No. The seeded scope covers drafting, review, comments, and execution guidance. Negotiation can be scoped separately.', 1),
    (v_service_id, 'Can I request changes after delivery?', 'One structured revision is included when the requested changes stay within the submitted commercial terms.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'This seed is useful for testing agreement services because it has variants, file upload, checkbox intake, and rich structured sections.', 'Neha S.', 'Product tester', 0),
    (v_service_id, 'The primary service mapping makes it easy to validate the contract agreement filter in the admin and public services list.', 'Arjun M.', 'QA reviewer', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Best if you already have a draft, term sheet, or proposal ready.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Use this if you want to clarify the scope before selecting a variant.', 1, TRUE),
    (v_service_id, 'book_consultation', 'Book Consultation', 'Helpful when the agreement terms are still being discussed.', 2, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Choose this if you want the team to call after reviewing the submitted details.', 3, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Included for service catalog CTA coverage testing.', 4, FALSE);

  DELETE FROM service_form_fields WHERE service_id = v_service_id;
  INSERT INTO service_form_fields (
    service_id,
    field_key,
    label,
    field_type,
    placeholder,
    help_text,
    options_json,
    sort_order
  ) VALUES
    (v_service_id, 'client_name', 'Your full name', 'text', 'Enter your name', 'Add the main point of contact for this agreement.', '[]'::jsonb, 0),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'Needed for any drafting clarifications.', '[]'::jsonb, 1),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'The reviewed or final draft can be shared here.', '[]'::jsonb, 2),
    (v_service_id, 'agreement_stage', 'Agreement stage', 'select', NULL, 'Choose where this matter currently stands.', to_jsonb(ARRAY['Need fresh draft', 'Have draft for review', 'Negotiating terms', 'Ready to sign']::text[]), 3),
    (v_service_id, 'party_type', 'Your role', 'radio', NULL, 'This helps the reviewer position the agreement correctly.', to_jsonb(ARRAY['Individual', 'Founder or business owner', 'Freelancer or consultant', 'Company representative']::text[]), 4),
    (v_service_id, 'agreement_value', 'Agreement value', 'number', 'Enter expected value in INR', 'Approximate amount is fine for testing and risk triage.', '[]'::jsonb, 5),
    (v_service_id, 'commercial_terms', 'Commercial terms', 'textarea', 'Summarize payment, scope, timeline, and responsibilities', 'Include the practical business terms that must appear in the agreement.', '[]'::jsonb, 6),
    (v_service_id, 'target_signing_date', 'Target signing date', 'date', NULL, 'Add the expected signing date if there is urgency.', '[]'::jsonb, 7),
    (v_service_id, 'priority_clauses', 'Priority clauses', 'checkbox', NULL, 'Select all areas the reviewer should focus on.', to_jsonb(ARRAY['Payment terms', 'IP ownership', 'Confidentiality', 'Termination', 'Liability cap', 'Dispute resolution']::text[]), 8),
    (v_service_id, 'agreement_documents', 'Draft or supporting documents', 'file', NULL, 'Upload the current draft, proposal, quotation, term sheet, or relevant emails.', '[]'::jsonb, 9);
END;
$$;

SELECT seed_service_agreement_service(
  'Non-Disclosure Agreement Drafting and Review',
  'nda-drafting-and-review',
  'Protect confidential discussions with a practical NDA draft or clause-level review before sharing sensitive information.',
  'kaptaan-nda-service-agreement',
  'confidential information sharing, evaluation discussions, and sensitive business conversations',
  'NDA Draft from Scratch',
  'Existing NDA Review',
  'NDA Review + Risk Summary',
  149900,
  640,
  1
);

SELECT seed_service_agreement_service(
  'Freelancer Service Agreement Review',
  'freelancer-service-agreement-review',
  'Review a freelancer or independent contractor agreement for payment, scope, IP ownership, and termination risks.',
  'kaptaan-freelancer-service-agreement',
  'freelance scope, milestone payments, ownership of work product, and client approval terms',
  'Freelancer Agreement Draft',
  'Freelancer Draft Review',
  'Freelancer Agreement + Clause Notes',
  179900,
  520,
  2
);

SELECT seed_service_agreement_service(
  'Vendor Agreement Drafting',
  'vendor-agreement-drafting',
  'Create or review a vendor agreement covering supply scope, payment timing, service levels, and exit rights.',
  'kaptaan-vendor-service-agreement',
  'vendor deliverables, purchase terms, service levels, payment cycles, and quality commitments',
  'Vendor Agreement Draft',
  'Vendor Draft Review',
  'Vendor Agreement + Negotiation Notes',
  249900,
  475,
  3
);

SELECT seed_service_agreement_service(
  'Consultancy Agreement Drafting and Review',
  'consultancy-agreement-drafting-and-review',
  'Draft or review a consultancy agreement with clear duties, fees, confidentiality, IP, and termination language.',
  'kaptaan-consultancy-service-agreement',
  'consultant duties, retainers, milestones, client approvals, confidentiality, and IP ownership',
  'Consultancy Agreement Draft',
  'Consultancy Draft Review',
  'Consultancy Agreement + Premium Review',
  229900,
  705,
  4
);

SELECT seed_service_agreement_service(
  'Partnership Agreement Drafting',
  'partnership-agreement-drafting',
  'Prepare a partnership agreement draft covering contribution, profit sharing, roles, exit, and dispute terms.',
  'kaptaan-partnership-service-agreement',
  'partner roles, capital contribution, profit sharing, management rights, exits, and deadlock handling',
  'Partnership Agreement Draft',
  'Partnership Draft Review',
  'Partnership Agreement + Founder Call',
  299900,
  390,
  5
);

DROP FUNCTION IF EXISTS seed_service_agreement_service(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, INT);
DROP FUNCTION IF EXISTS seed_service_agreement_variant(BIGINT, TEXT, TEXT, INT, INT, TEXT, TEXT, INT, BOOLEAN);

COMMIT;
