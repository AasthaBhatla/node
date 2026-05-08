const pool = require("../db");

const benefitCardsBySlug = {
  "trademark-registration": [
    {
      title: "Use the brand name with confidence",
      description: "A proper trademark route helps you trade under the chosen name or logo with lower conflict risk.",
      icon: "fa-solid fa-signature",
      tone: "violet",
    },
    {
      title: "Build stronger ownership proof",
      description: "Registration creates a clearer legal record that the brand belongs to you or your business.",
      icon: "fa-solid fa-certificate",
      tone: "blue",
    },
    {
      title: "Protect against copycats",
      description: "A registered mark makes it easier to object, oppose, or act when someone misuses a similar brand.",
      icon: "fa-solid fa-shield-halved",
      tone: "green",
    },
    {
      title: "Grow, license, and expand safely",
      description: "Trademark protection supports marketplaces, franchising, licensing, investor checks, and expansion plans.",
      icon: "fa-solid fa-chart-line",
      tone: "orange",
    },
  ],
  "employment-contract-review": [
    {
      title: "Know what you are agreeing to",
      description: "Review salary, role, notice period, confidentiality, non-compete, and exit terms before signing.",
      icon: "fa-solid fa-file-signature",
      tone: "violet",
    },
    {
      title: "Avoid hidden work restrictions",
      description: "Spot clauses that can limit future jobs, freelance work, side projects, or client relationships.",
      icon: "fa-solid fa-ban",
      tone: "blue",
    },
    {
      title: "Negotiate from a clearer position",
      description: "Use expert-identified issues to ask for safer wording, fairer terms, or written clarification.",
      icon: "fa-solid fa-handshake",
      tone: "green",
    },
    {
      title: "Reduce future employment disputes",
      description: "Clearer terms reduce surprises around termination, incentives, IP ownership, and liabilities.",
      icon: "fa-solid fa-scale-balanced",
      tone: "orange",
    },
  ],
  "domestic-violence-legal-support-consultation": [
    {
      title: "Understand immediate protection options",
      description: "Get clarity on legal remedies, emergency support routes, and what can be done first.",
      icon: "fa-solid fa-shield-heart",
      tone: "violet",
    },
    {
      title: "Prepare facts and evidence safely",
      description: "Organize incidents, documents, messages, medical records, and timelines before formal action.",
      icon: "fa-solid fa-folder-open",
      tone: "blue",
    },
    {
      title: "Choose the right support pathway",
      description: "Know when legal expert help, police support, NGO support, or urgent escalation may be needed.",
      icon: "fa-solid fa-route",
      tone: "green",
    },
    {
      title: "Move forward with confidentiality",
      description: "Discuss sensitive details in a structured, private way so next steps feel less confusing.",
      icon: "fa-solid fa-lock",
      tone: "orange",
    },
  ],
  "mutual-divorce-separation-consultation": [
    {
      title: "Understand the correct legal route",
      description: "Know whether mutual consent, separation terms, or another legal path fits your situation.",
      icon: "fa-solid fa-route",
      tone: "violet",
    },
    {
      title: "Document settlement points clearly",
      description: "Prepare maintenance, asset division, shared expenses, and household arrangements with less ambiguity.",
      icon: "fa-solid fa-file-contract",
      tone: "blue",
    },
    {
      title: "Reduce conflict around children",
      description: "Clarify custody, visitation, support, and parenting arrangements before emotions escalate.",
      icon: "fa-solid fa-children",
      tone: "green",
    },
    {
      title: "Save time in the formal process",
      description: "Better-prepared documents and expectations can reduce delays, rework, and repeated discussions.",
      icon: "fa-solid fa-clock",
      tone: "orange",
    },
  ],
  "property-dispute-legal-consultation": [
    {
      title: "Know your property position",
      description: "Understand ownership, possession, title gaps, and possible claims before taking action.",
      icon: "fa-solid fa-house-chimney",
      tone: "violet",
    },
    {
      title: "Review key documents early",
      description: "Check sale deeds, mutation, encumbrance, inheritance papers, notices, and related records.",
      icon: "fa-solid fa-file-circle-check",
      tone: "blue",
    },
    {
      title: "Avoid avoidable escalation",
      description: "Identify negotiation, notice, authority, or court pathways before the dispute becomes harder to manage.",
      icon: "fa-solid fa-shield-halved",
      tone: "green",
    },
    {
      title: "Respond with a clearer strategy",
      description: "Prepare stronger next steps when facing objections, family claims, builder issues, or possession disputes.",
      icon: "fa-solid fa-gavel",
      tone: "orange",
    },
  ],
  "marriage-consultation-legal-services": [
    {
      title: "Complete registration with fewer delays",
      description: "Understand eligibility, documents, witnesses, and process steps before applying.",
      icon: "fa-solid fa-ring",
      tone: "violet",
    },
    {
      title: "Prepare the right documents",
      description: "Check identity, address, age proof, photos, affidavits, and witness details in advance.",
      icon: "fa-solid fa-folder-open",
      tone: "blue",
    },
    {
      title: "Handle special situations clearly",
      description: "Get guidance for interfaith, interstate, residence, prior marriage, or certificate-related questions.",
      icon: "fa-solid fa-circle-question",
      tone: "green",
    },
    {
      title: "Avoid mistakes in legal formalities",
      description: "Reduce confusion around notice, appointments, name changes, and post-registration requirements.",
      icon: "fa-solid fa-scale-balanced",
      tone: "orange",
    },
  ],
};

async function ensureColumn() {
  await pool.query(`
    ALTER TABLE IF EXISTS services
      ADD COLUMN IF NOT EXISTS benefit_cards JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

async function seedBenefitCards() {
  await ensureColumn();

  const updated = [];
  const missing = [];

  for (const [slug, cards] of Object.entries(benefitCardsBySlug)) {
    const result = await pool.query(
      `UPDATE services
       SET benefit_cards = $2::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE slug = $1
       RETURNING id, slug, title`,
      [slug, JSON.stringify(cards)],
    );

    if (result.rowCount === 0) {
      missing.push(slug);
      continue;
    }

    updated.push(result.rows[0]);
  }

  return { updated, missing };
}

seedBenefitCards()
  .then(({ updated, missing }) => {
    console.log(`Seeded benefit cards for ${updated.length} services.`);
    for (const service of updated) {
      console.log(`- ${service.slug}: ${service.title}`);
    }
    if (missing.length > 0) {
      console.log(`Missing services: ${missing.join(", ")}`);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
