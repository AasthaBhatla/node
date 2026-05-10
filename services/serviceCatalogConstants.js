const SERVICE_CTA_KEYS = [
  "book_consultation",
  "talk_to_legal_expert",
  "upload_documents_for_review",
  "get_legal_notice_drafted",
  "request_callback",
];

const SERVICE_TYPE_OPTIONS = [
  { value: "consultation", label: "Consultation" },
  { value: "managed_service", label: "Managed Service" },
  { value: "documents", label: "Documents" },
];

const SERVICE_TYPE_VALUES = SERVICE_TYPE_OPTIONS.map((option) => option.value);

const SERVICE_TYPE_LABELS = SERVICE_TYPE_OPTIONS.reduce((labels, option) => {
  labels[option.value] = option.label;
  return labels;
}, {});

const SERVICE_CTA_LABELS = {
  book_consultation: "Book Consultation",
  talk_to_legal_expert: "Talk to a Legal Expert",
  upload_documents_for_review: "Upload Documents for Review",
  get_legal_notice_drafted: "Get Legal Notice Drafted",
  request_callback: "Request Callback",
};

const SERVICE_FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "phone",
  "email",
  "number",
  "select",
  "radio",
  "checkbox",
  "date",
  "file",
];

const SERVICE_TRUST_BADGE_KEYS = [
  "verified_lawyers",
  "secure_payment",
  "confidential_consultation",
  "transparent_pricing",
  "whatsapp_support",
  "same_day_appointment_available",
];

const SERVICE_TRUST_BADGE_LABELS = {
  verified_lawyers: "Verified lawyers",
  secure_payment: "Secure payment",
  confidential_consultation: "Confidential consultation",
  transparent_pricing: "Transparent pricing",
  whatsapp_support: "WhatsApp support",
  same_day_appointment_available: "Same-day appointment available",
};

module.exports = {
  SERVICE_CTA_KEYS,
  SERVICE_CTA_LABELS,
  SERVICE_FORM_FIELD_TYPES,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPE_OPTIONS,
  SERVICE_TYPE_VALUES,
  SERVICE_TRUST_BADGE_KEYS,
  SERVICE_TRUST_BADGE_LABELS,
};
