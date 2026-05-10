-- Seed published document services for the mobile Documents page.
-- Safe to rerun. Existing seeded services are updated by slug.
-- Production example:
--   docker exec -i postgres-db psql -U mridul -d kaptaanAPI < db/seed_document_services_testing.sql

DO $$
DECLARE
  v_services_taxonomy_id INT;
BEGIN
  INSERT INTO taxonomy (slug, title)
  VALUES ('services', 'Services')
  ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title;

  SELECT id INTO v_services_taxonomy_id
  FROM taxonomy
  WHERE slug = 'services'
  LIMIT 1;

  CREATE TEMP TABLE document_seed_terms (
    slug TEXT,
    title TEXT
  ) ON COMMIT DROP;

  INSERT INTO document_seed_terms (slug, title)
  VALUES
    ('business-documents', 'Business Documents'),
    ('tax-documents', 'Tax Documents'),
    ('agreements', 'Agreements'),
    ('property-documents', 'Property Documents'),
    ('company-documents', 'Company Documents'),
    ('identity-verification', 'Identity Verification'),
    ('employment-documents', 'Employment Documents'),
    ('personal-legal-documents', 'Personal Legal Documents');

  UPDATE terms term
  SET title = seed.title,
      updated_at = CURRENT_TIMESTAMP
  FROM document_seed_terms seed
  WHERE term.taxonomy_id = v_services_taxonomy_id
    AND term.slug = seed.slug;

  INSERT INTO terms (taxonomy_id, slug, title)
  SELECT v_services_taxonomy_id, seed.slug, seed.title
  FROM document_seed_terms seed
  WHERE NOT EXISTS (
    SELECT 1
    FROM terms term
    WHERE term.taxonomy_id = v_services_taxonomy_id
      AND term.slug = seed.slug
  );
END $$;

CREATE OR REPLACE FUNCTION seed_document_service(
  p_title TEXT,
  p_slug TEXT,
  p_summary TEXT,
  p_icon_key TEXT,
  p_icon_tone TEXT,
  p_download_count INT,
  p_is_package_featured BOOLEAN,
  p_package_sort_order INT,
  p_document_sort_order INT,
  p_term_slug TEXT,
  p_variants JSONB
) RETURNS VOID AS $$
DECLARE
  v_service_id BIGINT;
  v_term_id INT;
  v_variant JSONB;
  v_variant_id BIGINT;
BEGIN
  SELECT term.id INTO v_term_id
  FROM terms term
  JOIN taxonomy tax ON tax.id = term.taxonomy_id
  WHERE tax.slug = 'services'
    AND term.slug = p_term_slug
  LIMIT 1;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'Missing service term %', p_term_slug;
  END IF;

  INSERT INTO services (
    status,
    service_type,
    title,
    slug,
    short_description,
    document_icon_key,
    document_icon_tone,
    document_card_summary,
    document_download_count,
    is_package_featured,
    package_sort_order,
    document_sort_order,
    primary_service_term_id,
    who_this_is_for,
    included_items,
    deliverables,
    required_information,
    documents_required,
    process_steps,
    duration_text,
    turnaround_time_text,
    disclaimer_text,
    refund_cancellation_policy_text,
    consultations_completed_count,
    current_viewers_count,
    years_of_experience,
    enabled_trust_badges,
    published_at
  )
  VALUES (
    'published',
    'documents',
    p_title,
    p_slug,
    p_summary,
    p_icon_key,
    p_icon_tone,
    p_summary,
    p_download_count,
    p_is_package_featured,
    p_package_sort_order,
    p_document_sort_order,
    v_term_id,
    '["Individuals and businesses who need a reliable legal document"]'::jsonb,
    '["Guided document preparation", "Secure document handling", "Expert assistance where selected"]'::jsonb,
    '["Draft or generated document", "Download or delivery as per selected option"]'::jsonb,
    '["Basic personal details", "Purpose of document", "Relevant transaction or party information"]'::jsonb,
    '["Existing draft if available", "Supporting identity or transaction details where required"]'::jsonb,
    '[{"title":"Choose option","description":"Select the document creation mode that fits your need."},{"title":"Share details","description":"Answer a few guided questions or request expert help."},{"title":"Receive document","description":"Download instantly or receive the expert-crafted document."}]'::jsonb,
    'Instant to 48 hours',
    'Depends on selected variant',
    'This seeded document service is for mobile catalog testing and should be reviewed before commercial rollout.',
    'Free and paid options follow the selected variant terms.',
    0,
    0,
    0,
    '["secure_payment", "transparent_pricing"]'::jsonb,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (slug) DO UPDATE
  SET status = 'published',
      service_type = 'documents',
      title = EXCLUDED.title,
      short_description = EXCLUDED.short_description,
      document_icon_key = EXCLUDED.document_icon_key,
      document_icon_tone = EXCLUDED.document_icon_tone,
      document_card_summary = EXCLUDED.document_card_summary,
      document_download_count = EXCLUDED.document_download_count,
      is_package_featured = EXCLUDED.is_package_featured,
      package_sort_order = EXCLUDED.package_sort_order,
      document_sort_order = EXCLUDED.document_sort_order,
      primary_service_term_id = EXCLUDED.primary_service_term_id,
      who_this_is_for = EXCLUDED.who_this_is_for,
      included_items = EXCLUDED.included_items,
      deliverables = EXCLUDED.deliverables,
      required_information = EXCLUDED.required_information,
      documents_required = EXCLUDED.documents_required,
      process_steps = EXCLUDED.process_steps,
      duration_text = EXCLUDED.duration_text,
      turnaround_time_text = EXCLUDED.turnaround_time_text,
      disclaimer_text = EXCLUDED.disclaimer_text,
      refund_cancellation_policy_text = EXCLUDED.refund_cancellation_policy_text,
      enabled_trust_badges = EXCLUDED.enabled_trust_badges,
      published_at = COALESCE(services.published_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO v_service_id;

  INSERT INTO service_term_relationships (service_id, term_id)
  VALUES (v_service_id, v_term_id)
  ON CONFLICT (service_id, term_id) DO NOTHING;

  UPDATE service_variants
  SET is_active = FALSE,
      is_default = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = v_service_id;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    SELECT id INTO v_variant_id
    FROM service_variants
    WHERE service_id = v_service_id
      AND title = v_variant->>'title'
    ORDER BY id ASC
    LIMIT 1;

    IF v_variant_id IS NULL THEN
      INSERT INTO service_variants (
        service_id,
        title,
        summary,
        features_json,
        highlight_text,
        icon_key,
        tone,
        price_label,
        price_paise,
        compare_at_price_paise,
        duration_text,
        turnaround_time_text,
        sort_order,
        is_default,
        is_active
      )
      VALUES (
        v_service_id,
        v_variant->>'title',
        v_variant->>'summary',
        COALESCE(v_variant->'features', '[]'::jsonb),
        v_variant->>'highlight',
        v_variant->>'icon',
        v_variant->>'tone',
        NULLIF(v_variant->>'price_label', ''),
        COALESCE((v_variant->>'price_paise')::INT, 0),
        NULLIF(v_variant->>'compare_at_price_paise', '')::INT,
        v_variant->>'duration',
        v_variant->>'turnaround',
        COALESCE((v_variant->>'sort_order')::INT, 0),
        COALESCE((v_variant->>'is_default')::BOOLEAN, FALSE),
        TRUE
      );
    ELSE
      UPDATE service_variants
      SET summary = v_variant->>'summary',
          features_json = COALESCE(v_variant->'features', '[]'::jsonb),
          highlight_text = v_variant->>'highlight',
          icon_key = v_variant->>'icon',
          tone = v_variant->>'tone',
          price_label = NULLIF(v_variant->>'price_label', ''),
          price_paise = COALESCE((v_variant->>'price_paise')::INT, 0),
          compare_at_price_paise = NULLIF(v_variant->>'compare_at_price_paise', '')::INT,
          duration_text = v_variant->>'duration',
          turnaround_time_text = v_variant->>'turnaround',
          sort_order = COALESCE((v_variant->>'sort_order')::INT, 0),
          is_default = COALESCE((v_variant->>'is_default')::BOOLEAN, FALSE),
          is_active = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_variant_id;
    END IF;

    v_variant_id := NULL;
  END LOOP;

  WITH preferred AS (
    SELECT id
    FROM service_variants
    WHERE service_id = v_service_id
      AND is_active = TRUE
    ORDER BY is_default DESC, sort_order ASC, id ASC
    LIMIT 1
  )
  UPDATE service_variants
  SET is_default = service_variants.id = (SELECT id FROM preferred),
      updated_at = CURRENT_TIMESTAMP
  WHERE service_id = v_service_id;

  INSERT INTO service_ctas (service_id, cta_key, label, helper_text, sort_order, is_enabled)
  VALUES
    (v_service_id, 'book_consultation', 'Get Service', 'Start this document service.', 0, TRUE),
    (v_service_id, 'talk_to_legal_expert', 'Talk to Expert', 'Ask a legal expert before choosing.', 1, TRUE)
  ON CONFLICT (service_id, cta_key) DO UPDATE
  SET label = EXCLUDED.label,
      helper_text = EXCLUDED.helper_text,
      sort_order = EXCLUDED.sort_order,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = CURRENT_TIMESTAMP;

  INSERT INTO service_form_fields (
    service_id,
    field_key,
    label,
    field_type,
    placeholder,
    help_text,
    options_json,
    sort_order
  )
  VALUES
    (v_service_id, 'client_name', 'Your full name', 'text', 'Enter your name', 'Used for the document request.', '[]'::jsonb, 0),
    (v_service_id, 'phone_number', 'Phone number', 'phone', 'Enter mobile number', 'Used for coordination if needed.', '[]'::jsonb, 1),
    (v_service_id, 'document_purpose', 'Document purpose', 'textarea', 'Briefly describe why you need this document', 'Helps us tailor the document.', '[]'::jsonb, 2)
  ON CONFLICT (service_id, field_key) DO UPDATE
  SET label = EXCLUDED.label,
      field_type = EXCLUDED.field_type,
      placeholder = EXCLUDED.placeholder,
      help_text = EXCLUDED.help_text,
      options_json = EXCLUDED.options_json,
      sort_order = EXCLUDED.sort_order,
      updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

SELECT seed_document_service('Business Suite', 'document-business-suite', 'Essential business documents for operating, contracting, and staying compliant.', 'circle-slash', 'orange', 12400, TRUE, 0, 1, 'business-documents', '[
  {"title":"Basic Customisation","summary":"Answer simple questions and generate a starter document.","features":["Answer simple questions","Auto generated through verified templates","Download instantly"],"highlight":"Best for quick and simple needs","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Premium Customisation","summary":"A document expert prepares a tailored version.","features":["Task to our document expert","Personalised and professionally crafted","Delivered in 24-48 hours","Up to 2 revisions included"],"highlight":"A human expert will understand your needs and create a tailored document for you","icon":"headset","tone":"violet","price_label":"Starting From ₹2,000/-","price_paise":200000,"compare_at_price_paise":300000,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('GST Packages', 'document-gst-packages', 'Documents and support package for GST registration and basic compliance.', 'handshake', 'blue', 1200, TRUE, 1, 2, 'tax-documents', '[
  {"title":"GST Starter","summary":"Prepare your basic GST document checklist.","features":["Basic GST document checklist","Registration detail capture","Download checklist instantly"],"highlight":"Useful for preparing before registration","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"GST Assisted Filing","summary":"Expert guided GST registration support.","features":["Expert document review","Application support","Follow-up clarification included"],"highlight":"Best when you want guided filing support","icon":"headset","tone":"violet","price_label":"Starting From ₹1,499/-","price_paise":149900,"compare_at_price_paise":249900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('NDA', 'document-nda', 'Restricts people from sharing confidential information with others.', 'circle-slash', 'orange', 12400, FALSE, 0, 3, 'agreements', '[
  {"title":"Basic Customisation","summary":"Generate a simple NDA from verified templates.","features":["Answer simple questions","Auto generated through verified templates","Download instantly"],"highlight":"Best for quick and simple needs","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Premium Customisation","summary":"Get a tailored NDA prepared by a document expert.","features":["Expert reviews your needs","Confidentiality clauses customised","Delivered in 24-48 hours"],"highlight":"Recommended for business-sensitive information","icon":"headset","tone":"violet","price_label":"Starting From ₹999/-","price_paise":99900,"compare_at_price_paise":149900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Service Agreement', 'document-service-agreement', 'For contracts related to services to a second party.', 'handshake', 'blue', 1200, FALSE, 0, 4, 'agreements', '[
  {"title":"Template Draft","summary":"Create a basic service agreement draft.","features":["Scope and payment terms","Basic obligations","Download draft instantly"],"highlight":"Good for standard service work","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Expert Draft","summary":"Have a professional prepare the agreement.","features":["Custom clauses","Risk review","Two revisions included"],"highlight":"Best for commercial service contracts","icon":"headset","tone":"violet","price_label":"Starting From ₹2,000/-","price_paise":200000,"compare_at_price_paise":300000,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Rent Agreement', 'document-rent-agreement', 'An agreement for renting a house or property.', 'home', 'pink', 7, FALSE, 0, 5, 'property-documents', '[
  {"title":"Offer Draft","summary":"Try assisted rent agreement drafting for ₹1.","features":["Basic property details","Tenant and owner details","Draft request created"],"highlight":"Introductory offer for first-time users","icon":"file-check","tone":"orange","price_label":"₹1/-","price_paise":100,"sort_order":0,"is_default":true},
  {"title":"Expert Draft","summary":"Expert reviewed rent agreement for your property.","features":["Property-specific clauses","Security deposit terms","Delivered in 24 hours"],"highlight":"Recommended for enforceable rental terms","icon":"headset","tone":"violet","price_label":"Starting From ₹799/-","price_paise":79900,"compare_at_price_paise":119900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Power Of Attorney', 'document-power-of-attorney', 'Authorise someone to act on your behalf for a defined purpose.', 'arrow-left-right', 'green', 250, FALSE, 0, 6, 'personal-legal-documents', '[
  {"title":"Premium Draft","summary":"Professionally drafted power of attorney.","features":["Authority scope reviewed","Execution guidance included","Delivered in 24-48 hours"],"highlight":"Best for important representative authority","icon":"shield","tone":"violet","price_label":"Starting From ₹2,500/-","price_paise":250000,"compare_at_price_paise":350000,"sort_order":0,"is_default":true}
]'::jsonb);

SELECT seed_document_service('MOA', 'document-moa', 'Memorandum of association for company formation.', 'list', 'pink', 340, FALSE, 0, 7, 'company-documents', '[
  {"title":"Company Draft","summary":"MOA drafting support for company formation.","features":["Object clause assistance","Company structure capture","Expert drafted document"],"highlight":"For companies that need professionally prepared incorporation documents","icon":"headset","tone":"violet","price_label":"Starting From ₹550/-","price_paise":55000,"compare_at_price_paise":99900,"sort_order":0,"is_default":true}
]'::jsonb);

SELECT seed_document_service('Police Verification', 'document-police-verification', 'Application for police verification for different uses.', 'shield', 'green', 840, FALSE, 0, 8, 'identity-verification', '[
  {"title":"Basic Application","summary":"Prepare a simple police verification application.","features":["Guided application fields","Purpose-specific draft","Download instantly"],"highlight":"Quick application preparation","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Assisted Application","summary":"Get assistance preparing and checking the application.","features":["Expert review","Document checklist","Submission guidance"],"highlight":"Useful when verification purpose is sensitive","icon":"headset","tone":"blue","price_label":"Starting From ₹499/-","price_paise":49900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Employment Agreement', 'document-employment-agreement', 'Employment terms for salary, role, confidentiality, and exit obligations.', 'file-check', 'blue', 910, FALSE, 0, 9, 'employment-documents', '[
  {"title":"Basic Draft","summary":"Create standard employment terms.","features":["Role and compensation fields","Basic confidentiality terms","Download draft instantly"],"highlight":"Good for simple hiring needs","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"HR Reviewed Draft","summary":"Expert reviewed employment agreement.","features":["Custom probation and exit terms","IP and confidentiality clauses","Two revisions included"],"highlight":"Recommended for startups and growing teams","icon":"headset","tone":"violet","price_label":"Starting From ₹1,499/-","price_paise":149900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Partnership Deed', 'document-partnership-deed', 'Define partner contributions, profit sharing, and exit terms.', 'handshake', 'violet', 620, FALSE, 0, 10, 'business-documents', '[
  {"title":"Offer Draft","summary":"Create a partnership deed request for ₹1.","features":["Partner details","Profit sharing terms","Draft request created"],"highlight":"Introductory offer for partnership planning","icon":"file-check","tone":"orange","price_label":"₹1/-","price_paise":100,"sort_order":0,"is_default":true},
  {"title":"Expert Deed","summary":"Expert drafted partnership deed.","features":["Capital and profit clauses","Exit and dispute clauses","Delivered in 24-48 hours"],"highlight":"Best for serious business partnerships","icon":"headset","tone":"violet","price_label":"Starting From ₹2,999/-","price_paise":299900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Legal Notice', 'document-legal-notice', 'Draft a formal legal notice for disputes, recovery, or breach.', 'shield', 'slate', 1800, FALSE, 0, 11, 'personal-legal-documents', '[
  {"title":"Notice Review","summary":"Get your facts reviewed before notice drafting.","features":["Fact summary capture","Document upload checklist","Expert review starts"],"highlight":"Best before sending a formal notice","icon":"shield","tone":"blue","price_label":"Starting From ₹999/-","price_paise":99900,"sort_order":0,"is_default":true},
  {"title":"Notice Drafting","summary":"Full legal notice drafting by an expert.","features":["Professionally drafted notice","Legal grounds structured","One revision included"],"highlight":"Recommended for formal disputes","icon":"headset","tone":"violet","price_label":"Starting From ₹2,499/-","price_paise":249900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Affidavit', 'document-affidavit', 'Prepare an affidavit for declarations, corrections, and official use.', 'file-check', 'green', 540, FALSE, 0, 12, 'personal-legal-documents', '[
  {"title":"Basic Affidavit","summary":"Generate a simple affidavit format.","features":["Declaration details","Verified template","Download instantly"],"highlight":"Best for simple declarations","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Expert Affidavit","summary":"Expert-assisted affidavit drafting.","features":["Purpose-specific language","Execution guidance","Delivered in 24 hours"],"highlight":"Use when affidavit wording matters","icon":"headset","tone":"violet","price_label":"Starting From ₹699/-","price_paise":69900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Sale Agreement', 'document-sale-agreement', 'Agreement for selling goods, assets, or property interests.', 'home', 'orange', 430, FALSE, 0, 13, 'agreements', '[
  {"title":"Template Draft","summary":"Create a simple sale agreement.","features":["Buyer and seller details","Payment terms","Download draft instantly"],"highlight":"Good for straightforward sales","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Expert Draft","summary":"Expert drafted sale agreement.","features":["Risk clauses","Delivery and payment safeguards","Two revisions included"],"highlight":"Best for higher value transactions","icon":"headset","tone":"violet","price_label":"Starting From ₹1,999/-","price_paise":199900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Trademark Authorization', 'document-trademark-authorization', 'Authorize a representative for trademark filing and related actions.', 'shield', 'blue', 310, FALSE, 0, 14, 'business-documents', '[
  {"title":"Authorization Draft","summary":"Prepare a trademark authorization document.","features":["Applicant details","Representative authority","Download draft instantly"],"highlight":"Useful for trademark filing preparation","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"IP Expert Draft","summary":"Expert assisted trademark authorization.","features":["Filing-purpose review","Representative scope checked","Delivered in 24 hours"],"highlight":"Best when filing through a professional","icon":"headset","tone":"violet","price_label":"Starting From ₹899/-","price_paise":89900,"sort_order":1}
]'::jsonb);

SELECT seed_document_service('Will Draft', 'document-will-draft', 'Prepare a will for distribution of assets and personal wishes.', 'file-check', 'pink', 460, FALSE, 0, 15, 'personal-legal-documents', '[
  {"title":"Guided Will","summary":"Create a basic will draft.","features":["Beneficiary details","Asset list guidance","Download draft instantly"],"highlight":"For simple estate planning needs","icon":"file-check","tone":"green","price_label":"Free","price_paise":0,"sort_order":0,"is_default":true},
  {"title":"Expert Will Draft","summary":"Get a professionally reviewed will.","features":["Succession review","Witness and execution guidance","Two revisions included"],"highlight":"Recommended for family and asset complexity","icon":"headset","tone":"violet","price_label":"Starting From ₹2,499/-","price_paise":249900,"sort_order":1}
]'::jsonb);

DROP FUNCTION IF EXISTS seed_document_service(TEXT, TEXT, TEXT, TEXT, TEXT, INT, BOOLEAN, INT, INT, TEXT, JSONB);
