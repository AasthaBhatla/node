BEGIN;

-- Local testing seed for the structured services catalog.
-- Usage:
--   docker exec -i kaptaan-postgres-db psql -U mridul -d kaptaanAPI < db/seed_services_local_testing.sql

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
  ('jaipur', 'Jaipur'),
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
  SET title = EXCLUDED.title,
      type = EXCLUDED.type;

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
      ('notices-disputes', 'Notices and Disputes'),
      ('business-compliance', 'Business Compliance'),
      ('intellectual-property', 'Intellectual Property'),
      ('property-rental', 'Property and Rental'),
      ('family-law', 'Family Law')
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
      ('notices-disputes', 'Notices and Disputes'),
      ('business-compliance', 'Business Compliance'),
      ('intellectual-property', 'Intellectual Property'),
      ('property-rental', 'Property and Rental'),
      ('family-law', 'Family Law')
  ) AS incoming(slug, title)
  WHERE NOT EXISTS (
    SELECT 1
    FROM terms existing
    WHERE existing.taxonomy_id = v_services_taxonomy_id
      AND existing.slug = incoming.slug
  );
END $$;

CREATE OR REPLACE FUNCTION seed_service_variant(
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

DO $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id INTO v_services_taxonomy_id FROM taxonomy WHERE slug = 'services' LIMIT 1;
  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'notices-disputes'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for legal-notice-drafting';
  END IF;

  INSERT INTO services (
    status,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
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
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'Legal Notice Drafting',
    'legal-notice-drafting',
    'Get a lawyer-drafted notice tailored to your dispute, demand, or formal response.',
    'https://picsum.photos/seed/kaptaan-legal-notice/1600/900',
    'Legal paperwork and writing tools laid out on a desk',
    'Legal Notice Drafting | Kaptaan Local Testing',
    'Seeded test service for legal notice drafting with structured variants, FAQs, CTAs, and intake fields.',
    NULL,
    'Legal Notice Drafting | Kaptaan',
    'Book a legal notice drafting service with fast turnaround and a structured intake flow.',
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Individuals facing payment, tenancy, employment, or consumer disputes',
      'Landlords and tenants who need a formally worded notice before escalation',
      'Small businesses that want a lawyer-reviewed notice before pursuing recovery'
    ]::text[]),
    to_jsonb(ARRAY[
      'Payment recovery and invoice default disputes',
      'Property possession, rent, and lock-in disagreements',
      'Employment exit, dues, and misconduct notices',
      'Consumer complaint escalation before litigation',
      'Reply notices when the other side has already sent one'
    ]::text[]),
    to_jsonb(ARRAY[
      'Brief case review by a legal expert',
      'Service-specific notice draft aligned to your facts',
      'One structured revision based on your comments',
      'Final delivery in shareable digital format',
      'Next-step guidance after the notice is issued'
    ]::text[]),
    to_jsonb(ARRAY[
      'Court filing or litigation representation',
      'Physical courier dispatch charges',
      'Unlimited back-and-forth revisions',
      'Stamping, notarisation, or affidavit costs'
    ]::text[]),
    to_jsonb(ARRAY[
      'Names and contact details of both parties',
      'A short summary of the dispute timeline',
      'The exact relief or demand you want stated',
      'Copies of agreements, invoices, chats, or emails supporting your version'
    ]::text[]),
    to_jsonb(ARRAY[
      'Final notice draft in PDF',
      'Editable draft copy when applicable',
      'Short summary of the legal position and suggested next step'
    ]::text[]),
    to_jsonb(ARRAY[
      'Agreement, invoice, or transaction proof',
      'Chat, email, or message screenshots',
      'Identity proof if you want the notice issued in your personal capacity',
      'Any notice already received from the opposite party'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Share your facts',
        'description', 'Tell us what happened, who the other party is, and what outcome you want from the notice.'
      ),
      jsonb_build_object(
        'title', 'Lawyer review',
        'description', 'A legal expert reviews your documents and selects the strongest notice approach for the matter.'
      ),
      jsonb_build_object(
        'title', 'Draft and refine',
        'description', 'We prepare the draft, collect your comments, and finalize the notice in the chosen variant.'
      ),
      jsonb_build_object(
        'title', 'Deliver and guide',
        'description', 'You receive the final notice plus clear guidance on sending it and planning the next step.'
      )
    ),
    'Usually 30 to 45 minutes of legal review and drafting work.',
    'Same day to 48 hours depending on the selected variant and document quality.',
    'This local testing service does not create an attorney-client relationship until the matter is formally accepted after review.',
    'Consultation portions are non-refundable once the review has started. Drafting fees can be adjusted only if our team confirms the service cannot proceed on the provided facts.',
    'Available across India. Language and clause style can be adjusted for state-specific notice usage where needed.',
    2400,
    12,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support',
      'same_day_appointment_available'
    ]::text[]),
    CURRENT_TIMESTAMP - INTERVAL '5 days',
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
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
    AND t.slug IN ('notices-disputes', 'property-rental', 'family-law')
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'delhi', 'jaipur');

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

  PERFORM seed_service_variant(
    v_service_id,
    'Notice Draft Only',
    'Focused drafting for users who already know the facts and just need a polished legal notice.',
    149900,
    199900,
    'Lawyer drafting within 1 business day',
    'Delivered within 24 hours on clean documentation',
    0,
    TRUE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Draft + One Revision',
    'Best for matters where you expect one round of factual edits before sending the notice.',
    249900,
    329900,
    '1 to 2 business days',
    'Usually delivered within 24 to 48 hours',
    1,
    FALSE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Draft + Lawyer Call',
    'Includes a strategy call for users who want help deciding how the notice should be positioned.',
    399900,
    499900,
    '2 to 3 business days with advisory call',
    'Priority handling with same-day scheduling where possible',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Can you help me respond to a notice I already received?', 'Yes. Pick this service, upload the received notice, and mention clearly that you want a reply notice drafted.', 0),
    (v_service_id, 'Will you send the notice on my behalf?', 'This seeded service focuses on drafting and guidance. Dispatch support or advocate issuance can be discussed separately after review.', 1),
    (v_service_id, 'What if I only have WhatsApp chats and no signed contract?', 'You can still proceed. Upload all available supporting material and the lawyer will assess the strongest framing for the notice.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'The notice was sharp, easy to understand, and sent me into the negotiation with a lot more confidence.', 'Ananya S.', 'Small business owner', 0),
    (v_service_id, 'The intake form captured everything the lawyer needed, so the turnaround was much faster than I expected.', 'Rohit M.', 'Property owner', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Book Consultation', 'Start with a guided intake and get the right notice variant.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Use this when you want a strategy-first discussion before final drafting.', 1, TRUE),
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Best for users who already have agreements, chats, or invoices ready.', 2, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Fast path for users who are ready to move directly into drafting.', 3, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Pick this if you want our team to call you after the form is submitted.', 4, TRUE);

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
    (v_service_id, 'client_name', 'Your full name', 'text', 'Enter your name', 'Use the name that should appear on the notice.', '[]'::jsonb, 0),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'This is used for coordination and urgent clarifications.', '[]'::jsonb, 1),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'The final notice draft is shared on email.', '[]'::jsonb, 2),
    (v_service_id, 'notice_type', 'Type of notice', 'select', NULL, 'Choose the closest category so the lawyer can frame the notice correctly.', to_jsonb(ARRAY['Payment Recovery', 'Employment', 'Property or Tenancy', 'Consumer Complaint', 'Family Matter', 'Other']::text[]), 3),
    (v_service_id, 'urgency_level', 'Urgency level', 'radio', NULL, 'Priority requests should include complete documents for faster drafting.', to_jsonb(ARRAY['Standard', 'Priority']::text[]), 4),
    (v_service_id, 'issue_summary', 'Issue summary', 'textarea', 'Explain what happened and what you want from the notice', 'Add dates, amounts, and a short timeline if possible.', '[]'::jsonb, 5),
    (v_service_id, 'opposite_party_name', 'Opposite party name', 'text', 'Name of the person or company receiving the notice', 'Add the exact legal name if you know it.', '[]'::jsonb, 6),
    (v_service_id, 'preferred_callback_date', 'Preferred callback date', 'date', NULL, 'Choose the best date if you want a follow-up call.', '[]'::jsonb, 7),
    (v_service_id, 'communication_preferences', 'Communication preferences', 'checkbox', NULL, 'Select all update channels you want us to use during local testing.', to_jsonb(ARRAY['WhatsApp updates', 'Email copy', 'Phone confirmation']::text[]), 8),
    (v_service_id, 'supporting_documents', 'Supporting documents', 'file', NULL, 'Upload invoices, agreements, chats, notices, or anything that supports your facts.', '[]'::jsonb, 9);
END $$;

DO $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id INTO v_services_taxonomy_id FROM taxonomy WHERE slug = 'services' LIMIT 1;
  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'business-compliance'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for gst-registration';
  END IF;

  INSERT INTO services (
    status,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
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
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'GST Registration',
    'gst-registration',
    'Register your business for GST with a guided document checklist and filing support.',
    'https://picsum.photos/seed/kaptaan-gst-registration/1600/900',
    'Business workspace with documents, calculator, and laptop',
    'GST Registration | Kaptaan Local Testing',
    'Seeded GST registration service with pricing variants, structured content, FAQs, and mandatory intake fields.',
    NULL,
    'GST Registration | Kaptaan',
    'Choose a GST registration variant and test the end-to-end service checkout flow locally.',
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Startups and growing businesses crossing registration thresholds',
      'Service providers, agencies, and e-commerce sellers onboarding to platforms',
      'Founders who need a guided filing process without guessing the paperwork'
    ]::text[]),
    to_jsonb(ARRAY[
      'Uncertainty about whether GST registration is mandatory',
      'Marketplace or vendor onboarding requirements',
      'State-wise business operations and registration confusion',
      'Missing clarity on entity-specific documents',
      'Delayed registration because the checklist feels overwhelming'
    ]::text[]),
    to_jsonb(ARRAY[
      'Eligibility review for the selected entity type',
      'Customized document checklist',
      'Application drafting and filing assistance',
      'ARN tracking support after submission',
      'Basic guidance if the portal asks for clarification'
    ]::text[]),
    to_jsonb(ARRAY[
      'GST return filing after registration',
      'Department notices or litigation',
      'Monthly bookkeeping or accounting services',
      'Government fee changes charged outside the service scope'
    ]::text[]),
    to_jsonb(ARRAY[
      'Entity type and business activity details',
      'PAN, Aadhaar, and business address proof',
      'Bank account proof and authorization details',
      'Expected turnover and operating state'
    ]::text[]),
    to_jsonb(ARRAY[
      'Filed application summary',
      'ARN details after successful submission',
      'Registration certificate when approved',
      'Simple post-registration onboarding checklist'
    ]::text[]),
    to_jsonb(ARRAY[
      'PAN and Aadhaar of the applicant or authorized signatory',
      'Business address proof',
      'Cancelled cheque or bank statement',
      'Incorporation or partnership documents where applicable'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Complete the intake form',
        'description', 'Share your entity type, business activity, turnover estimate, and location details.'
      ),
      jsonb_build_object(
        'title', 'Document screening',
        'description', 'Our team checks the uploaded proofs and flags anything missing before filing starts.'
      ),
      jsonb_build_object(
        'title', 'Prepare and file',
        'description', 'We prepare the application and move it forward once the required confirmations are in place.'
      ),
      jsonb_build_object(
        'title', 'Track the application',
        'description', 'You receive the ARN and follow-up guidance until the registration is completed or clarification is required.'
      )
    ),
    'Registration work starts after a document check and usually takes 20 to 40 minutes of filing preparation.',
    'Most filings move in 3 to 7 business days depending on the entity type and response time for clarifications.',
    'Approval timelines and government portal actions remain subject to GSTN processing and document acceptance.',
    'If filing has already started, advisory and preparation charges are not refundable. If the case cannot proceed because of a technical mismatch identified before filing, the team may offer a credit or partial adjustment.',
    'Pan-India support for businesses operating in India, with state selection captured during intake.',
    3100,
    11,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support',
      'same_day_appointment_available'
    ]::text[]),
    CURRENT_TIMESTAMP - INTERVAL '4 days',
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
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
    AND t.slug IN ('business-compliance', 'intellectual-property')
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'delhi', 'mumbai', 'bengaluru');

  DELETE FROM service_language_relationships WHERE service_id = v_service_id;
  INSERT INTO service_language_relationships (service_id, language_id)
  SELECT v_service_id, language.id
  FROM languages AS language
  WHERE language.slug IN ('english', 'hindi');

  UPDATE service_variants
  SET is_active = FALSE,
      is_default = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = v_service_id;

  PERFORM seed_service_variant(
    v_service_id,
    'Proprietorship Basic',
    'Suitable for consultants, freelancers, and single-owner businesses with straightforward documents.',
    199900,
    249900,
    '2 to 3 business days',
    'Usually completed in 3 to 5 business days',
    0,
    TRUE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Partnership / LLP',
    'For partnerships and LLPs that need a more detailed documentation review before filing.',
    349900,
    449900,
    '3 to 5 business days',
    'Usually completed in 4 to 6 business days',
    1,
    FALSE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Private Limited / Startup Pack',
    'Includes extra handholding for companies with more document dependencies and onboarding questions.',
    549900,
    699900,
    '5 to 7 business days',
    'Target turnaround of 5 to 7 business days',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Do I need GST registration even if my turnover is low?', 'Sometimes yes. Certain business models such as interstate supplies or marketplace selling may still require registration. The intake answers help the reviewer confirm this.', 0),
    (v_service_id, 'Will you file the application for me?', 'Yes. The seeded local service includes filing assistance once the required documents and confirmations are complete.', 1),
    (v_service_id, 'Can you also help after the GST number is issued?', 'This service includes a simple onboarding checklist after approval. Ongoing compliance is intentionally outside the included scope.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'The variant choices made it very easy to compare what I needed as a sole proprietor versus what I might need later as we scale.', 'Neha G.', 'Marketing consultant', 0),
    (v_service_id, 'The document checklist was clear and the team followed up quickly whenever the portal needed clarification.', 'Karan P.', 'E-commerce seller', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Book Consultation', 'Use this if you want to confirm eligibility before filing begins.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Ideal when you are unsure about entity type or registration timing.', 1, TRUE),
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Best for users who already have KYC and business papers ready.', 2, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Enabled for CTA coverage testing even though this service is focused on registration.', 3, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Pick this if you want a quick call after your business details are reviewed.', 4, TRUE);

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
    (v_service_id, 'business_name', 'Business name', 'text', 'Enter business name', 'Use the exact name used in incorporation or tax records.', '[]'::jsonb, 0),
    (v_service_id, 'contact_person', 'Contact person', 'text', 'Enter point of contact', 'This should be the person handling the registration follow-up.', '[]'::jsonb, 1),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'Used for document clarifications and status updates.', '[]'::jsonb, 2),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'All filing updates and ARN details can be shared here.', '[]'::jsonb, 3),
    (v_service_id, 'entity_type', 'Entity type', 'radio', NULL, 'Choose the current legal structure of the business.', to_jsonb(ARRAY['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'OPC', 'Other']::text[]), 4),
    (v_service_id, 'annual_turnover', 'Expected annual turnover', 'number', 'Enter amount in INR', 'This helps confirm whether registration may already be mandatory.', '[]'::jsonb, 5),
    (v_service_id, 'principal_state', 'Principal state of business', 'select', NULL, 'Select the state where the main place of business is located.', to_jsonb(ARRAY['Rajasthan', 'Delhi', 'Maharashtra', 'Karnataka', 'Uttar Pradesh', 'Other']::text[]), 6),
    (v_service_id, 'business_address', 'Business address', 'textarea', 'Enter complete address', 'Include landmark details if the proof uses a slightly different format.', '[]'::jsonb, 7),
    (v_service_id, 'registration_target_date', 'Target registration date', 'date', NULL, 'Pick the date by which you want the registration process to move.', '[]'::jsonb, 8),
    (v_service_id, 'compliance_needs', 'What do you need help with?', 'checkbox', NULL, 'Select all that apply so the assigned expert understands the full context.', to_jsonb(ARRAY['Registration only', 'Registration plus post-filing guidance', 'Marketplace onboarding support']::text[]), 9),
    (v_service_id, 'kyc_documents', 'KYC and business documents', 'file', NULL, 'Upload PAN, Aadhaar, address proof, bank proof, and incorporation documents if available.', '[]'::jsonb, 10);
END $$;

DO $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id INTO v_services_taxonomy_id FROM taxonomy WHERE slug = 'services' LIMIT 1;
  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'intellectual-property'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for trademark-search-and-filing';
  END IF;

  INSERT INTO services (
    status,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
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
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'Trademark Search and Filing',
    'trademark-search-and-filing',
    'Check brand availability, choose the right class, and file your trademark application with guided support.',
    'https://picsum.photos/seed/kaptaan-trademark/1600/900',
    'Brand planning desk with notebook, laptop, and creative materials',
    'Trademark Search and Filing | Kaptaan Local Testing',
    'Seeded trademark service for local testing with variants, FAQs, structured sections, and a mandatory form.',
    NULL,
    'Trademark Search and Filing | Kaptaan',
    'Test brand search and filing flows locally with realistic pricing and intake fields.',
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Founders launching a new brand or product line',
      'E-commerce businesses protecting names before scaling',
      'Agencies and creators who need class guidance before filing'
    ]::text[]),
    to_jsonb(ARRAY[
      'Confusion about whether a brand name is already taken',
      'Uncertainty on the correct trademark class',
      'Delayed filings because the brand assets are not organized',
      'Need for a guided filing path without guessing forms and documents'
    ]::text[]),
    to_jsonb(ARRAY[
      'Basic availability search for the submitted mark',
      'Guidance on filing class selection',
      'Preparation and filing support for the chosen variant',
      'Acknowledgement and next-step summary after submission',
      'Status tracking guidance for the application journey'
    ]::text[]),
    to_jsonb(ARRAY[
      'Detailed objection replies after examination',
      'Hearing representation or opposition defense',
      'Logo design, naming strategy, or branding work',
      'Multi-country trademark strategy'
    ]::text[]),
    to_jsonb(ARRAY[
      'Proposed brand name or logo details',
      'Applicant identity and entity details',
      'Description of goods or services covered by the mark',
      'Whether the mark is already in use and the first-use timeline'
    ]::text[]),
    to_jsonb(ARRAY[
      'Search summary and filing recommendation',
      'Filing acknowledgement copy',
      'Application number and next-step guidance',
      'Simple note on what to expect after filing'
    ]::text[]),
    to_jsonb(ARRAY[
      'Applicant ID proof and business details',
      'Brand logo file if filing a device or composite mark',
      'User affidavit or proof of first use if available',
      'Power of attorney or authorization documents if required'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Share the brand details',
        'description', 'Submit the mark, applicant name, business context, and any logo or asset files you want reviewed.'
      ),
      jsonb_build_object(
        'title', 'Availability review',
        'description', 'The assigned legal expert checks the submitted mark and prepares a practical filing recommendation.'
      ),
      jsonb_build_object(
        'title', 'Choose the filing path',
        'description', 'You confirm the right variant, class direction, and any mark-specific filing details.'
      ),
      jsonb_build_object(
        'title', 'File and document',
        'description', 'We move ahead with the filing workflow and share the acknowledgement plus what happens next.'
      )
    ),
    'Search work usually starts within the same working day after the intake is complete.',
    'Availability search can be same day. Filing variants usually move within 2 to 5 business days once documents are ready.',
    'Trademark registration itself depends on statutory examination timelines. This seeded service covers search and filing support, not guaranteed registration.',
    'Search work and filing preparation are non-refundable after review has started. Filing-related third-party costs are not reversible once the application is submitted.',
    'Pan-India filing support for applicants based in India, with remote guidance available throughout the process.',
    1850,
    10,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support',
      'same_day_appointment_available'
    ]::text[]),
    CURRENT_TIMESTAMP - INTERVAL '3 days',
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
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
    AND t.slug IN ('intellectual-property', 'business-compliance')
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'mumbai', 'bengaluru');

  DELETE FROM service_language_relationships WHERE service_id = v_service_id;
  INSERT INTO service_language_relationships (service_id, language_id)
  SELECT v_service_id, language.id
  FROM languages AS language
  WHERE language.slug IN ('english', 'hindi');

  UPDATE service_variants
  SET is_active = FALSE,
      is_default = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = v_service_id;

  PERFORM seed_service_variant(
    v_service_id,
    'Wordmark Availability Search',
    'A compact option for founders who first want to know whether the submitted name is worth pursuing.',
    149900,
    199900,
    'Same working day review',
    'Search summary usually delivered within 24 hours',
    0,
    FALSE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Search + Filing (Single Class)',
    'Our most common option for straightforward wordmark filings in one class.',
    449900,
    599900,
    '2 to 4 business days',
    'Search plus filing support usually completed within 2 to 5 business days',
    1,
    TRUE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Search + Filing (Logo or Composite Mark)',
    'Recommended when the filing includes a logo or a combined word-and-device mark.',
    649900,
    799900,
    '3 to 5 business days',
    'Target turnaround of 3 to 5 business days',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Can you tell me which class I should file in?', 'Yes. Class guidance is built into the service, especially in the filing variants.', 0),
    (v_service_id, 'Do I need a logo to file a trademark?', 'No. You can file a wordmark without a logo. If you want to protect the visual mark too, choose the logo or composite variant.', 1),
    (v_service_id, 'Will this cover objection handling later?', 'No. This seeded service is intentionally limited to search, recommendation, and filing support. Objection replies can be scoped separately.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'Seeing the availability search and the filing variant side by side made the pricing and next step much clearer for our team.', 'Ishita R.', 'Consumer brand founder', 0),
    (v_service_id, 'The form gave us a great local test case for brand names, class count, first use, and logo uploads all in one flow.', 'Dev T.', 'Product manager', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Book Consultation', 'Good fit if you want help deciding between a search-only and filing variant.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Use this when class selection or applicant details are unclear.', 1, TRUE),
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Helpful when you already have the logo, use proof, or applicant details ready.', 2, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Included for CTA coverage testing across the catalog.', 3, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Best when you want a quick call before finalizing the mark type.', 4, TRUE);

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
    (v_service_id, 'brand_name', 'Brand name or mark', 'text', 'Enter the mark you want to protect', 'Use the exact spelling you plan to file.', '[]'::jsonb, 0),
    (v_service_id, 'applicant_name', 'Applicant name', 'text', 'Enter individual or business name', 'Use the same applicant name that will appear in the filing.', '[]'::jsonb, 1),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'Needed for coordination if the mark needs clarification.', '[]'::jsonb, 2),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'Acknowledgement and update notes can be shared here.', '[]'::jsonb, 3),
    (v_service_id, 'mark_type', 'Mark type', 'select', NULL, 'Choose the format you want to protect.', to_jsonb(ARRAY['Wordmark', 'Logo', 'Word plus Logo']::text[]), 4),
    (v_service_id, 'business_stage', 'Business stage', 'radio', NULL, 'This helps the reviewer understand urgency and first-use context.', to_jsonb(ARRAY['Idea stage', 'Already selling', 'Existing brand refresh']::text[]), 5),
    (v_service_id, 'goods_services', 'Goods or services description', 'textarea', 'Describe what the brand will be used for', 'List the main products, services, and industry context.', '[]'::jsonb, 6),
    (v_service_id, 'class_count', 'Expected class count', 'number', 'Enter the number of classes you think you need', 'If unsure, add 1 and mention the uncertainty in the notes.', '[]'::jsonb, 7),
    (v_service_id, 'first_use_date', 'First use date', 'date', NULL, 'If the mark is already in use, enter the approximate first-use date.', '[]'::jsonb, 8),
    (v_service_id, 'filing_priorities', 'What do you want help with?', 'checkbox', NULL, 'Select all priorities so the assigned expert can focus the review.', to_jsonb(ARRAY['Need class recommendation', 'Need urgent filing guidance', 'Want a quote for objection support later']::text[]), 9),
    (v_service_id, 'brand_assets', 'Brand assets and supporting files', 'file', NULL, 'Upload logo files, screenshots, or brand decks if you have them.', '[]'::jsonb, 10);
END $$;

DO $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id INTO v_services_taxonomy_id FROM taxonomy WHERE slug = 'services' LIMIT 1;
  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'property-rental'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for rent-agreement-drafting-and-review';
  END IF;

  INSERT INTO services (
    status,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
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
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'Rent Agreement Drafting and Review',
    'rent-agreement-drafting-and-review',
    'Draft or review a rent agreement with clause-by-clause clarity before signing.',
    'https://picsum.photos/seed/kaptaan-rent-agreement/1600/900',
    'Property keys resting beside contract papers on a table',
    'Rent Agreement Drafting and Review | Kaptaan Local Testing',
    'Seeded rent agreement service with realistic variants, intake fields, FAQs, and structured content.',
    NULL,
    'Rent Agreement Drafting and Review | Kaptaan',
    'Use this local testing service to exercise property-service variants and agreement-related file uploads.',
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Landlords who want a fresh draft before handing over possession',
      'Tenants reviewing a draft they received from the owner or broker',
      'Property managers handling repeat rental paperwork for clients'
    ]::text[]),
    to_jsonb(ARRAY[
      'Missing or vague maintenance and deposit clauses',
      'Confusion around lock-in periods and early exit rights',
      'Unclear responsibility for repairs, fittings, and utilities',
      'Need to review an existing broker-provided agreement before signing'
    ]::text[]),
    to_jsonb(ARRAY[
      'Fresh draft or review based on the selected variant',
      'Plain-language clause check for the important commercial points',
      'One structured revision round',
      'Execution guidance before signing'
    ]::text[]),
    to_jsonb(ARRAY[
      'Stamp duty or registration fees',
      'Physical notarisation or courier handling',
      'Police verification or tenant background checks',
      'Litigation, eviction, or recovery proceedings'
    ]::text[]),
    to_jsonb(ARRAY[
      'Names of the landlord and tenant',
      'Property address and city',
      'Rent amount, deposit, and term length',
      'Preferred possession or move-in date',
      'Any special clauses you want included or removed'
    ]::text[]),
    to_jsonb(ARRAY[
      'Final draft or reviewed markup copy',
      'Short clause summary covering key commercial terms',
      'Execution guidance note for the next step'
    ]::text[]),
    to_jsonb(ARRAY[
      'Existing agreement draft if one already exists',
      'Basic identity proof of the parties if available',
      'Property address details and ownership context',
      'Specific clause requests or broker notes'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Choose the service scope',
        'description', 'Select whether you need a fresh draft, a review of an existing draft, or drafting plus a strategy call.'
      ),
      jsonb_build_object(
        'title', 'Share commercial details',
        'description', 'Tell us the rent, deposit, city, term, possession date, and any clauses you care about.'
      ),
      jsonb_build_object(
        'title', 'Draft or review',
        'description', 'The legal expert prepares the agreement or comments on the uploaded draft with practical changes.'
      ),
      jsonb_build_object(
        'title', 'Finalize and sign',
        'description', 'You receive the final document package and a short note on how to move toward execution.'
      )
    ),
    'Drafting and review typically take 1 to 2 business days after the facts and files are complete.',
    'Same-day review may be possible for simple documents, while negotiated drafts usually take up to 48 hours.',
    'Local testing content only. State-specific execution requirements such as stamp duty and registration must still be independently confirmed before signing.',
    'Once the draft review starts, the advisory component is non-refundable. Changes in commercial terms after delivery may require a fresh scope.',
    'Suitable for common rental arrangements across India, with city-specific nuances captured in the intake.',
    1600,
    9,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support',
      'same_day_appointment_available'
    ]::text[]),
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
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
    AND t.slug IN ('property-rental', 'notices-disputes')
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'jaipur', 'delhi', 'pune');

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

  PERFORM seed_service_variant(
    v_service_id,
    'Draft from Scratch',
    'For landlords or tenants who need a clean agreement drafted around the agreed commercial terms.',
    199900,
    249900,
    '1 to 2 business days',
    'Often delivered within 24 hours for standard cases',
    0,
    TRUE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Existing Draft Review',
    'Best when you already have a broker or owner draft and want it checked before signing.',
    149900,
    199900,
    'Same-day to 1 business day review',
    'Usually completed within 24 hours',
    1,
    FALSE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Draft + Clause Negotiation Call',
    'Adds a discussion layer for users finalizing lock-in, renewal, or deposit terms.',
    349900,
    449900,
    '1 to 3 business days',
    'Target turnaround of 24 to 48 hours with call scheduling',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Can you review a draft already shared by a broker?', 'Yes. The existing draft review variant is designed for that use case.', 0),
    (v_service_id, 'Will you calculate stamp duty or handle registration?', 'This seeded service focuses on drafting and review. Execution costs and registration logistics are outside the included scope.', 1),
    (v_service_id, 'Can I request custom clauses like pet use or lock-in?', 'Yes. Mention those needs in the form and select the clause preferences that matter most.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'This was a great local testing service because it mixes city selection, numbers, dates, checkboxes, and document upload in one place.', 'Sanya V.', 'QA lead', 0),
    (v_service_id, 'The variant comparison felt intuitive, especially the difference between pure review and a full draft from scratch.', 'Aman L.', 'Operations manager', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Book Consultation', 'Use this if you want help deciding which agreement variant fits your scenario.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Helpful when the commercial terms are still being negotiated.', 1, TRUE),
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Best for users who already have a draft or broker note ready.', 2, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Included for CTA coverage testing across the local service pages.', 3, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Choose this if you want a discussion after the draft facts are reviewed.', 4, TRUE);

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
    (v_service_id, 'client_name', 'Your full name', 'text', 'Enter your name', 'Add the main point of contact for the agreement matter.', '[]'::jsonb, 0),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'Needed for any drafting clarifications.', '[]'::jsonb, 1),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'The reviewed or final draft will be shared here.', '[]'::jsonb, 2),
    (v_service_id, 'property_city', 'Property city', 'select', NULL, 'Choose the city in which the property is located.', to_jsonb(ARRAY['Jaipur', 'Delhi', 'Mumbai', 'Bengaluru', 'Pune', 'Other']::text[]), 3),
    (v_service_id, 'monthly_rent', 'Monthly rent amount', 'number', 'Enter monthly rent in INR', 'Numbers help the reviewer check deposit and lock-in proportionality.', '[]'::jsonb, 4),
    (v_service_id, 'service_scope', 'What do you need?', 'radio', NULL, 'Choose the closest service scope for the document.', to_jsonb(ARRAY['Need a fresh draft', 'Need review of an existing draft', 'Need draft plus strategy call']::text[]), 5),
    (v_service_id, 'property_address', 'Property address', 'textarea', 'Enter full address', 'Include unit, building, and locality details if available.', '[]'::jsonb, 6),
    (v_service_id, 'possession_date', 'Possession or move-in date', 'date', NULL, 'Add the intended possession date if it is already fixed.', '[]'::jsonb, 7),
    (v_service_id, 'clause_preferences', 'Clauses you want covered', 'checkbox', NULL, 'Select all clauses that matter so the draft can prioritize them.', to_jsonb(ARRAY['Lock-in clause', 'Maintenance clause', 'Pet clause', 'Renewal clause']::text[]), 8),
    (v_service_id, 'existing_documents', 'Existing draft or supporting documents', 'file', NULL, 'Upload the draft, broker note, or any reference terms you already have.', '[]'::jsonb, 9);
END $$;

DO $$
DECLARE
  v_service_id BIGINT;
  v_services_taxonomy_id INT;
  v_primary_term_id INT;
BEGIN
  SELECT id INTO v_services_taxonomy_id FROM taxonomy WHERE slug = 'services' LIMIT 1;
  SELECT id
  INTO v_primary_term_id
  FROM terms
  WHERE taxonomy_id = v_services_taxonomy_id
    AND slug = 'family-law'
  ORDER BY id
  LIMIT 1;

  IF v_primary_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing primary term for mutual-consent-divorce-consultation';
  END IF;

  INSERT INTO services (
    status,
    title,
    slug,
    short_description,
    featured_image_url,
    featured_image_alt,
    meta_title,
    meta_description,
    canonical_url_override,
    og_title,
    og_description,
    is_indexable,
    primary_service_term_id,
    who_this_is_for,
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
    years_of_experience,
    enabled_trust_badges,
    published_at,
    author_id
  ) VALUES (
    'published',
    'Mutual Consent Divorce Consultation',
    'mutual-consent-divorce-consultation',
    'Understand eligibility, documentation, and next steps for a mutual consent divorce before you commit to drafting.',
    'https://picsum.photos/seed/kaptaan-mutual-divorce/1600/900',
    'Quiet consultation table with documents and a neutral meeting setup',
    'Mutual Consent Divorce Consultation | Kaptaan Local Testing',
    'Seeded family-law consultation service with structured sections, multiple variants, FAQs, and a mandatory intake form.',
    NULL,
    'Mutual Consent Divorce Consultation | Kaptaan',
    'Use this local service to test family-law content, consultation pricing, and document collection flows.',
    TRUE,
    v_primary_term_id,
    to_jsonb(ARRAY[
      'Spouses exploring mutual consent divorce as the next step',
      'Couples who want clarity on eligibility and documentation before drafting begins',
      'Users coordinating across cities and needing a remote-first consultation flow'
    ]::text[]),
    to_jsonb(ARRAY[
      'Uncertainty around separation timelines and eligibility',
      'Questions about alimony, custody, and settlement readiness',
      'Confusion about what documents are needed before filing',
      'Need to understand the difference between consultation and full petition drafting'
    ]::text[]),
    to_jsonb(ARRAY[
      'Initial case screening and mutual consent suitability review',
      'Checklist of documents and likely next steps',
      'Consultation summary after the session',
      'Guidance on whether drafting can proceed smoothly'
    ]::text[]),
    to_jsonb(ARRAY[
      'Contested divorce strategy or litigation',
      'Court appearance or filing fees',
      'Mediation by third parties',
      'Full petition drafting unless included in the chosen variant'
    ]::text[]),
    to_jsonb(ARRAY[
      'Marriage date and separation background',
      'Whether both spouses currently agree on proceeding',
      'Any children, settlement points, or pending disagreements',
      'Basic identity and marriage proof documents if available'
    ]::text[]),
    to_jsonb(ARRAY[
      'Consultation summary note',
      'Eligibility and process overview',
      'Document checklist for the next step',
      'Drafting quote guidance where relevant'
    ]::text[]),
    to_jsonb(ARRAY[
      'Marriage certificate if available',
      'Basic ID and address proof',
      'Any existing settlement note or understanding between spouses',
      'Supporting documents related to children or residence if relevant'
    ]::text[]),
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Share the relationship context',
        'description', 'Provide the marriage date, current status, separation background, and whether both spouses are aligned on mutual consent.'
      ),
      jsonb_build_object(
        'title', 'Legal suitability review',
        'description', 'A legal expert screens the details and highlights what is straightforward versus what may need more planning.'
      ),
      jsonb_build_object(
        'title', 'Consultation and summary',
        'description', 'You receive a guided discussion plus a concise summary of documents, next steps, and likely drafting readiness.'
      ),
      jsonb_build_object(
        'title', 'Plan the next step',
        'description', 'If the case looks ready, the team can help scope petition drafting or the next document workflow separately.'
      )
    ),
    'Most consultation variants are designed around a 30 to 60 minute session plus a follow-up summary.',
    'Consultation scheduling is often available the same day or within 24 hours depending on the selected option.',
    'This service is for local testing and initial guidance only. Formal representation begins only after a separate case acceptance and conflict check.',
    'Consultation time is reserved for the submitted matter and is generally non-refundable once scheduled. Drafting-related upgrades can be priced separately after the session.',
    'Remote-friendly support across India, including cross-city matters where both spouses are not in the same location.',
    1250,
    14,
    to_jsonb(ARRAY[
      'verified_lawyers',
      'secure_payment',
      'confidential_consultation',
      'transparent_pricing',
      'whatsapp_support',
      'same_day_appointment_available'
    ]::text[]),
    CURRENT_TIMESTAMP - INTERVAL '1 day',
    NULL
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = EXCLUDED.status,
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      featured_image_url = EXCLUDED.featured_image_url,
      featured_image_alt = EXCLUDED.featured_image_alt,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      canonical_url_override = EXCLUDED.canonical_url_override,
      og_title = EXCLUDED.og_title,
      og_description = EXCLUDED.og_description,
      is_indexable = EXCLUDED.is_indexable,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
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
    AND t.slug IN ('family-law', 'notices-disputes')
  ORDER BY t.slug, t.id;

  DELETE FROM service_location_relationships WHERE service_id = v_service_id;
  INSERT INTO service_location_relationships (service_id, location_id)
  SELECT v_service_id, l.id
  FROM locations l
  WHERE l.slug IN ('all-india', 'delhi', 'mumbai', 'jaipur');

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

  PERFORM seed_service_variant(
    v_service_id,
    '30-Minute Consultation',
    'A focused session for users who first want clarity on eligibility and process.',
    149900,
    199900,
    '30-minute consultation slot',
    'Same day to 24-hour scheduling where available',
    0,
    TRUE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Consultation + Eligibility Note',
    'Includes a short written note summarizing readiness, documents, and next steps.',
    249900,
    299900,
    '30 to 45 minute session plus written note',
    'Usually completed within 24 to 48 hours',
    1,
    FALSE
  );

  PERFORM seed_service_variant(
    v_service_id,
    'Consultation + Drafting Quote Pack',
    'Best when the couple is close to agreement and wants a clear path toward petition drafting.',
    399900,
    499900,
    '45 to 60 minute session with follow-up scope note',
    'Usually completed within 48 hours',
    2,
    FALSE
  );

  DELETE FROM service_faqs WHERE service_id = v_service_id;
  INSERT INTO service_faqs (service_id, question, answer, sort_order)
  VALUES
    (v_service_id, 'Is this service only for mutual consent divorce?', 'Yes. This seeded service is intentionally scoped to mutual consent consultation and not contested divorce strategy.', 0),
    (v_service_id, 'Can both spouses join the same consultation?', 'Yes. Mention that in the form, and the team can coordinate the session format based on availability.', 1),
    (v_service_id, 'Will you draft the petition in this service?', 'Only the consultation and guidance are included by default. Drafting can be scoped separately or through the upgrade-style variant.', 2);

  DELETE FROM service_testimonials WHERE service_id = v_service_id;
  INSERT INTO service_testimonials (service_id, quote, author_name, author_title, sort_order)
  VALUES
    (v_service_id, 'This service is useful for local testing because it covers sensitive intake copy, date fields, select inputs, and uploaded documents in one place.', 'Priya N.', 'Content reviewer', 0),
    (v_service_id, 'The structured sections made the difference between consultation, drafting, and exclusions very easy to understand at a glance.', 'Rahul D.', 'Operations tester', 1);

  DELETE FROM service_ctas WHERE service_id = v_service_id;
  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Book Consultation', 'Best for users who want the simplest way to reserve a family-law consultation slot.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to a Legal Expert', 'Use this when you need a quick conversation before finalizing the variant.', 1, TRUE),
    (v_service_id, 'upload_documents_for_review', 'Upload Documents for Review', 'Helpful if you already have a marriage certificate or settlement draft ready.', 2, TRUE),
    (v_service_id, 'get_legal_notice_drafted', 'Get Legal Notice Drafted', 'Included for CTA coverage testing across the service catalog.', 3, TRUE),
    (v_service_id, 'request_callback', 'Request Callback', 'Choose this to have the team call you after reviewing the submitted details.', 4, TRUE);

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
    (v_service_id, 'client_name', 'Your full name', 'text', 'Enter your name', 'Add the person requesting the consultation.', '[]'::jsonb, 0),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter your mobile number', 'Used for scheduling and urgent clarifications.', '[]'::jsonb, 1),
    (v_service_id, 'email_address', 'Email address', 'email', 'Enter your email', 'A consultation summary can be shared here when applicable.', '[]'::jsonb, 2),
    (v_service_id, 'mutual_consent_status', 'Current consent status', 'radio', NULL, 'Choose the option that best matches the current situation.', to_jsonb(ARRAY['Both spouses agree', 'Discussion is underway', 'Still unsure']::text[]), 3),
    (v_service_id, 'children_status', 'Children involved', 'select', NULL, 'Select the closest option for the family situation.', to_jsonb(ARRAY['No children', 'Minor children', 'Adult children']::text[]), 4),
    (v_service_id, 'years_married', 'Years married', 'number', 'Enter number of years', 'A whole number is fine for local testing.', '[]'::jsonb, 5),
    (v_service_id, 'settlement_points', 'Current settlement points', 'textarea', 'Summarize alimony, custody, residence, or property discussions', 'Share only the essentials needed for the consultation summary.', '[]'::jsonb, 6),
    (v_service_id, 'marriage_date', 'Marriage date', 'date', NULL, 'Add the marriage date if known.', '[]'::jsonb, 7),
    (v_service_id, 'support_preferences', 'How should we support you?', 'checkbox', NULL, 'Select all coordination preferences that apply.', to_jsonb(ARRAY['Phone consultation', 'WhatsApp updates', 'Email summary']::text[]), 8),
    (v_service_id, 'family_documents', 'Marriage and supporting documents', 'file', NULL, 'Upload the marriage certificate, settlement notes, or other supporting documents if available.', '[]'::jsonb, 9);
END $$;

DROP FUNCTION IF EXISTS seed_service_variant(BIGINT, TEXT, TEXT, INT, INT, TEXT, TEXT, INT, BOOLEAN);

COMMIT;
