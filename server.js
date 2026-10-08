const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { fileTypeFromFile } = require("file-type");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIRECTORY = path.resolve(process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : "data");
const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || path.join(DATA_DIRECTORY, "journova.sqlite"));
const UPLOAD_DIRECTORY = path.resolve(process.env.UPLOAD_DIRECTORY || path.join(DATA_DIRECTORY, "uploads"));
const PUBLIC_FILE = path.join(__dirname, "index.html");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000;
const OTP_TTL = 10 * 60 * 1000;
const OTP_LIMIT = 5;
const AUTH_WINDOW = 15 * 60 * 1000;
const JOURNEY_FIELDS = ["goal", "field", "education", "marks", "english", "german", "experience", "age", "funds", "startDate", "selectedRoute", "cvData"];
const ADMIN_FILE = path.join(__dirname, "admin.html");
const VALID_GOALS = new Set(["Study", "Ausbildung", "Job"]);
const REQUIRED_DOCUMENTS = [
  { id: "passport", title: "Passport" },
  { id: "academic", title: "Marksheets / degree" },
  { id: "cv", title: "CV" },
  { id: "motivation", title: "Motivation letter" },
  { id: "language", title: "Language certificate" },
  { id: "aps", title: "APS certificate", goal: "Study" },
  { id: "experience", title: "Experience letters", goal: "Job" }
];
const OFFICIAL_RESOURCES = {
  Study: [
    { title: "DAAD: study programmes in Germany", url: "https://www.daad.de/en/studying-in-germany/universities/all-degree-programmes/" },
    { title: "Study in Germany: official information", url: "https://www.study-in-germany.de/en/" }
  ],
  Ausbildung: [
    { title: "Make it in Germany: vocational training", url: "https://www.make-it-in-germany.com/en/study-vocational-training/training-in-germany" },
    { title: "Federal Employment Agency", url: "https://www.arbeitsagentur.de/" }
  ],
  Job: [
    { title: "Make it in Germany: job listings", url: "https://www.make-it-in-germany.com/en/working-in-germany/job-listings" },
    { title: "Federal Employment Agency job search", url: "https://www.arbeitsagentur.de/jobsuche/" }
  ]
};

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function emailAddress(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254 ? normalized : null;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function secureCompare(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
}

function setSessionCookie(response, token, name = "jn_session") {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`);
}

function clearSessionCookie(response, name = "jn_session") {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeCvData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "CV details must be an object.");
  const legacySkills = typeof value.skills === "string"
    ? value.skills.split(/[,\n;]/).map((skill) => skill.trim()).filter(Boolean).map((name) => ({ category: "Other", name }))
    : value.skills;
  const text = (input, field, limit = 2000) => {
    if (input === undefined || input === null) return "";
    if (typeof input !== "string" || input.length > limit) fail(400, `Invalid CV ${field}.`);
    return input.trim();
  };
  const entries = (input, section, fields) => {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 30) fail(400, `CV ${section} must contain 30 entries or fewer.`);
    return input.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(400, `Invalid CV ${section} entry ${index + 1}.`);
      return Object.fromEntries(fields.map((field) => [field, text(item[field], `${section} ${field}`)]));
    });
  };
  const personal = value.personal && typeof value.personal === "object" && !Array.isArray(value.personal) ? value.personal : {};
  const target = value.target && typeof value.target === "object" && !Array.isArray(value.target) ? value.target : {};
  const normalized = {
    personal: Object.fromEntries(["name", "title", "email", "phone", "location", "linkedin", "github", "portfolio"].map((field) => [
      field,
      text(personal[field] ?? (field === "name" ? value.name : field === "title" ? value.headline : undefined), `personal ${field}`, 300)
    ])),
    summary: text(value.summary, "summary"),
    education: entries(value.education, "education", ["degree", "institution", "location", "startDate", "endDate", "grade", "description"]),
    skills: entries(legacySkills, "skills", ["category", "name"]),
    projects: entries(value.projects, "projects", ["name", "description", "technologies", "github", "live"]),
    experience: entries(value.experience, "experience", ["title", "company", "location", "startDate", "endDate", "description", "achievements"]),
    hackathons: entries(value.hackathons, "hackathons", ["name", "organization", "project", "result", "technologies"]),
    certifications: entries(value.certifications, "certifications", ["name", "organization", "date", "credential"]),
    languages: entries(value.languages, "languages", ["name", "proficiency"]),
    achievements: entries(value.achievements, "achievements", ["name", "organization", "date", "description"]),
    template: ["classic", "modern", "european"].includes(value.template) ? value.template : "classic",
    europeanMode: value.europeanMode === true,
    target: {
      type: ["University", "Ausbildung", "Internship", "Job", "Scholarship"].includes(target.type) ? target.type : "Job",
      title: text(target.title, "target title", 300),
      description: text(target.description, "target description", 5000),
      language: target.language === "German" ? "German" : "English"
    }
  };
  if (JSON.stringify(normalized).length > 60000) fail(400, "CV details are too large to save.");
  return normalized;
}

function cvPlainText(value, email) {
  const cv = normalizeCvData(value);
  const lines = [
    cv.personal.name,
    cv.personal.title,
    [cv.personal.email || email, cv.personal.phone, cv.personal.location, cv.personal.linkedin, cv.personal.github, cv.personal.portfolio].filter(Boolean).join(" | ")
  ].filter(Boolean);
  const addSection = (title, entries) => {
    const content = entries.filter(Boolean);
    if (content.length) lines.push("", title.toUpperCase(), ...content);
  };
  addSection(cv.target.language === "German" ? "Profil" : "Profile", [cv.summary]);
  addSection(cv.target.language === "German" ? "Bildung" : "Education", cv.education.map((item) => [
    item.degree, item.institution, item.location, [item.startDate, item.endDate].filter(Boolean).join(" – "), item.grade, item.description
  ].filter(Boolean).join(" | ")));
  addSection(cv.target.language === "German" ? "Kenntnisse" : "Skills", cv.skills.map((item) => `${item.category}: ${item.name}`));
  addSection(cv.target.language === "German" ? "Projekte" : "Projects", cv.projects.map((item) => [
    item.name, item.description, item.technologies && `Technologies: ${item.technologies}`,
    item.github && `GitHub: ${item.github}`, item.live && `Live: ${item.live}`
  ].filter(Boolean).join("\n")));
  addSection(cv.target.language === "German" ? "Berufserfahrung" : "Experience", cv.experience.map((item) => [
    item.title, item.company, item.location, [item.startDate, item.endDate].filter(Boolean).join(" – "), item.description, item.achievements
  ].filter(Boolean).join(" | ")));
  addSection(cv.target.language === "German" ? "Wettbewerbe" : "Hackathons", cv.hackathons.map((item) => [
    item.name, item.organization, item.project, item.result, item.technologies
  ].filter(Boolean).join(" | ")));
  addSection(cv.target.language === "German" ? "Zertifikate" : "Certifications", cv.certifications.map((item) => [
    item.name, item.organization, item.date, item.credential
  ].filter(Boolean).join(" | ")));
  addSection(cv.target.language === "German" ? "Sprachen" : "Languages", cv.languages.map((item) => [item.name, item.proficiency].filter(Boolean).join(" — ")));
  addSection(cv.target.language === "German" ? "Auszeichnungen" : "Achievements", cv.achievements.map((item) => [
    item.name, item.organization, item.date, item.description
  ].filter(Boolean).join(" | ")));
  return lines.join("\n").trim();
}

function buildDocumentVerificationReport({ docId, extension, size, verified, tip, text, profile, uploadedDocuments }) {
  const supportedText = extension === ".txt";
  const extractedFields = {};
  if (supportedText && text) {
    const labels = {
      name: /^(?:name|full name)\s*[:\-]\s*(.{1,200})$/im,
      institution: /^(?:institution|issuing authority)\s*[:\-]\s*(.{1,200})$/im,
      certificateNumber: /^(?:certificate number|certificate no\.?)\s*[:\-]\s*(.{1,200})$/im,
      issueDate: /^(?:issue date|date of issue)\s*[:\-]\s*(.{1,80})$/im,
      expiryDate: /^(?:expiry date|expiration date|valid until)\s*[:\-]\s*(.{1,80})$/im
    };
    for (const [field, pattern] of Object.entries(labels)) {
      const match = text.match(pattern);
      if (match) extractedFields[field] = match[1].trim();
    }
  }

  const requiredDocuments = REQUIRED_DOCUMENTS.filter((document) => !document.goal || document.goal === profile.goal);
  const uploadedTypes = new Set(uploadedDocuments.map((document) => document.doc_id));
  uploadedTypes.add(docId);
  const profileFields = ["goal", "field", "education", "marks", "english", "german", "experience", "age", "funds", "startDate"];
  const completedProfileFields = profileFields.filter((field) => profile[field] !== undefined && profile[field] !== "");
  const checks = [
    { name: "File type and signature", status: verified ? "passed" : "needs_attention", detail: tip },
    { name: "File size", status: size <= MAX_UPLOAD_BYTES ? "passed" : "failed", detail: `${size} bytes; limit is ${MAX_UPLOAD_BYTES} bytes.` },
    { name: "Text extraction", status: supportedText ? (Object.keys(extractedFields).length ? "partial" : "unavailable") : "unavailable", detail: supportedText ? "Plain text labels only; this is not OCR." : "No OCR engine is configured for PDF or image files." },
    { name: "Profile matching", status: "unavailable", detail: "A verified applicant identity is not collected in the profile, so names cannot be matched." },
    { name: "Cross-document consistency", status: "unavailable", detail: "No OCR or reliable extracted data is available to compare documents." },
    { name: "Issuer authenticity", status: "unavailable", detail: "No issuing-authority lookup or external verification service is connected." }
  ];
  const findings = [];
  if (!verified) findings.push("The local file check needs attention. This is a technical issue, not evidence that the document is false.");
  if (!supportedText) findings.push("OCR and field extraction were not performed for this file.");
  findings.push("Document authenticity has not been established. An authorised reviewer must inspect the file and use an official issuer channel where available.");

  return {
    version: 1,
    generatedAt: Date.now(),
    status: "needs_human_review",
    riskLevel: "unassessed",
    confidence: null,
    documentType: docId,
    profileCompletion: {
      completed: completedProfileFields.length,
      total: profileFields.length,
      percent: Math.round(completedProfileFields.length / profileFields.length * 100)
    },
    documentCompleteness: {
      uploaded: requiredDocuments.filter((document) => uploadedTypes.has(document.id)).length,
      required: requiredDocuments.length,
      missing: requiredDocuments.filter((document) => !uploadedTypes.has(document.id)).map((document) => document.title)
    },
    extractedFields,
    checks,
    findings,
    recommendation: "Review the document manually. Confirm certificates with the issuer through its official verification channel when available."
  };
}

function buildAssessment(profile, documents) {
  const levelScores = { None: 15, A1: 30, A2: 45, B1: 65, B2: 82, C1: 94, C2: 100 };
  const required = REQUIRED_DOCUMENTS.filter((doc) => !doc.goal || doc.goal === profile.goal);
  const documentScore = required.length
    ? Math.round(documents.filter((doc) => ["approved", "verified"].includes(doc.review_status)).length / required.length * 100)
    : 0;
  const academic = Math.min(100, Math.round(Number(profile.marks || 0) * 0.75 + (profile.education ? 25 : 0)));
  const language = Math.round(((levelScores[profile.german] || 0) * 0.65 + (levelScores[profile.english] || 0) * 0.35));
  const funds = Math.min(100, Math.round(Number(profile.funds || 0) / 12000 * 100));
  const experience = Math.min(100, Math.round(Number(profile.experience || 0) * 10));
  const score = Math.round(academic * 0.3 + language * 0.25 + funds * 0.2 + documentScore * 0.15 + experience * 0.1);
  return {
    score,
    tier: score >= 75 ? "Qualified" : score >= 55 ? "Nearly ready" : "Build-up",
    factors: [
      { name: "Academic", value: academic, weight: 30 },
      { name: "Language", value: language, weight: 25 },
      { name: "Funds", value: funds, weight: 20 },
      { name: "Documents", value: documentScore, weight: 15 },
      { name: "Experience", value: experience, weight: 10 }
    ],
    note: "Indicative preview only; not an admission, employment or visa decision."
  };
}

function buildPathways(profile, assessment) {
  const levels = { None: 15, A1: 30, A2: 45, B1: 65, B2: 82, C1: 94, C2: 100 };
  const german = levels[profile.german] || 0;
  const english = levels[profile.english] || 0;
  const experience = Math.min(100, Number(profile.experience || 0) * 10);
  return {
    Study: Math.round(assessment.factors[0].value * 0.36 + english * 0.22 + assessment.factors[2].value * 0.17 + german * 0.12 + assessment.factors[3].value * 0.13),
    Ausbildung: Math.round(german * 0.34 + assessment.factors[0].value * 0.18 + experience * 0.17 + assessment.factors[2].value * 0.13 + assessment.factors[3].value * 0.18),
    Job: Math.round(experience * 0.3 + german * 0.22 + english * 0.18 + assessment.factors[0].value * 0.12 + assessment.factors[3].value * 0.18)
  };
}

function buildApplicationNextAction(profile, documents, application) {
  const profileLabels = {
    goal: "Journey goal",
    field: "Study or work field",
    education: "Education",
    marks: "Marks / GPA",
    english: "English level",
    german: "German level",
    experience: "Relevant experience",
    age: "Age",
    funds: "Available funds",
    startDate: "Target start date"
  };
  const profileKeys = Object.keys(profileLabels);
  const missingProfile = profileKeys.filter((key) => profile[key] === undefined || profile[key] === null || profile[key] === "");
  const profileScore = Math.round(((profileKeys.length - missingProfile.length) / profileKeys.length) * 100);
  const requiredDocuments = REQUIRED_DOCUMENTS.filter((doc) => !doc.goal || doc.goal === application.route);
  const documentsByType = new Map(documents.map((doc) => [doc.doc_id, doc]));
  const approvedCount = requiredDocuments.filter((doc) => ["approved", "verified"].includes(documentsByType.get(doc.id)?.review_status)).length;
  const documentScore = requiredDocuments.length ? Math.round((approvedCount / requiredDocuments.length) * 100) : 100;
  const documentGaps = requiredDocuments.flatMap((doc) => {
    const uploaded = documentsByType.get(doc.id);
    if (!uploaded) return [{ kind: "document", id: doc.id, label: `${doc.title}: upload required` }];
    if (uploaded.review_status === "needs_changes") return [{ kind: "document", id: doc.id, label: `${doc.title}: re-upload requested${uploaded.review_note ? ` (${uploaded.review_note})` : ""}` }];
    if (uploaded.review_status === "suspicious") return [{ kind: "document", id: doc.id, label: `${doc.title}: additional human review in progress` }];
    if (uploaded.review_status === "rejected") return [{ kind: "document", id: doc.id, label: `${doc.title}: not accepted; contact your counsellor before replacing it` }];
    if (!["approved", "verified"].includes(uploaded.review_status)) return [{ kind: "document", id: doc.id, label: `${doc.title}: awaiting visual review` }];
    return [];
  });
  const requirements = application.requirements;
  const cvStatus = buildCvStatus(profile, documents, application);
  const completedRequirements = requirements.filter((item) => item.completed).length;
  const requirementsScore = requirements.length ? Math.round((completedRequirements / requirements.length) * 100) : 0;
  const incompleteRequirement = requirements.find((item) => !item.completed);
  const indiaNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate()));
  const deadline = application.deadline ? new Date(`${application.deadline}T00:00:00Z`) : null;
  const daysUntilDeadline = deadline ? Math.ceil((deadline.getTime() - today.getTime()) / 86400000) : null;
  const deadlineScore = daysUntilDeadline === null ? 0 : daysUntilDeadline < 0 ? 0 : daysUntilDeadline <= 7 ? 25 : daysUntilDeadline <= 30 ? 55 : 100;
  const cvScore = !cvStatus.exists ? 0 : cvStatus.complete && cvStatus.relevant ? 100 : cvStatus.complete ? 65 : 35;
  const readiness = Math.round(profileScore * 0.25 + documentScore * 0.25 + requirementsScore * 0.20 + deadlineScore * 0.15 + cvScore * 0.15);
  const missingItems = [
    ...missingProfile.map((key) => `Profile: ${profileLabels[key]}`),
    ...documentGaps.map((item) => item.label),
    ...(!cvStatus.exists ? ["CV: create and save a CV"] : !cvStatus.complete ? ["CV: complete the key sections"] : !cvStatus.relevant ? ["CV: tailor the content to this application"] : []),
    ...(!requirements.length ? ["Application requirements: add the items from the provider's official instructions"] : requirements.filter((item) => !item.completed).map((item) => `Requirement: ${item.label}`)),
    ...(daysUntilDeadline === null ? ["Application deadline: not set"] : daysUntilDeadline < 0 ? [`Deadline passed ${Math.abs(daysUntilDeadline)} day(s) ago`] : [])
  ];
  let nextAction;
  let nextActionTarget = "none";
  if (application.status === "Closed") {
    nextAction = "This application is closed. Add another application if you are pursuing a different program or role.";
  } else if (daysUntilDeadline !== null && daysUntilDeadline < 0) {
    nextAction = "The deadline has passed. Contact the provider using its official contact details to ask whether late submission is possible.";
    nextActionTarget = "portal";
  } else if (daysUntilDeadline !== null && daysUntilDeadline <= 14) {
    const urgentGap = documentGaps.find((item) => item.label.includes("re-upload")) || documentGaps.find((item) => item.label.includes("upload required")) || (incompleteRequirement ? { label: `Complete: ${incompleteRequirement.label}` } : null);
    nextAction = urgentGap
      ? `Deadline in ${daysUntilDeadline} day(s): ${urgentGap.label}. Prioritize this with the provider's official deadline in mind.`
      : `Deadline in ${daysUntilDeadline} day(s): check the provider's official portal and confirm your submission is complete.`;
    nextActionTarget = urgentGap?.kind === "document" ? "documents" : urgentGap ? "requirements" : "portal";
  } else if (missingProfile.length) {
    nextAction = `Complete your profile: add ${profileLabels[missingProfile[0]]}.`;
    nextActionTarget = "profile";
  } else if (!cvStatus.exists || !cvStatus.complete || !cvStatus.relevant) {
    nextAction = !cvStatus.exists
      ? "Create and save a CV using details you can verify."
      : !cvStatus.complete
        ? "Complete the key CV sections before submitting this application."
        : `Tailor your CV for ${application.title} using only experience and skills you genuinely have.`;
    nextActionTarget = "cv";
  } else if (documentGaps.some((item) => item.label.includes("re-upload"))) {
    nextAction = `Act on the review note: ${documentGaps.find((item) => item.label.includes("re-upload")).label}.`;
    nextActionTarget = "documents";
  } else if (documentGaps.some((item) => item.label.includes("upload required"))) {
    nextAction = `Upload ${documentGaps.find((item) => item.label.includes("upload required")).label.replace(": upload required", "")}.`;
    nextActionTarget = "documents";
  } else if (documentGaps.length) {
    nextAction = `Your uploaded ${documentGaps[0].label.replace(": awaiting visual review", "")} is awaiting a visual review. Check back for the reviewer decision.`;
    nextActionTarget = "documents";
  } else if (!requirements.length) {
    nextAction = "Add the requirements listed by this institution, training provider or employer so progress can be tracked.";
    nextActionTarget = "requirements";
  } else if (incompleteRequirement) {
    nextAction = `Work on this provider requirement next: ${incompleteRequirement.label}.`;
    nextActionTarget = "requirements";
  } else if (daysUntilDeadline === null) {
    nextAction = "Add the deadline shown in the provider's official application instructions.";
    nextActionTarget = "deadline";
  } else if (application.status === "Preparing") {
    nextAction = "Your tracked items look complete. Review the provider's official portal and submit the application there.";
  } else if (application.status === "Applied") {
    nextAction = "Check for a submission confirmation and monitor the provider's official portal or email for updates.";
  } else if (application.status === "Interview") {
    nextAction = "Prepare for the interview using the official role or program details and confirm the interview time.";
  } else {
    nextAction = "Review the offer and verify its terms directly with the institution or employer before making a decision.";
  }
  const factors = [
    { name: "Profile", score: profileScore, weight: 25 },
    { name: "Required documents", score: documentScore, weight: 25 },
    { name: "Your checklist", score: requirementsScore, weight: 20 },
    { name: "Deadline", score: deadlineScore, weight: 15 },
    { name: "CV fit", score: cvScore, weight: 15 }
  ];
  return {
    readiness,
    label: readiness >= 80 ? "Strongly prepared" : readiness >= 55 ? "In progress" : "Needs attention",
    nextAction,
    nextActionTarget,
    missingItems,
    factors,
    deadlineDays: daysUntilDeadline,
    cv: cvStatus
  };
}

function normalizeApplicationRequirements(value) {
  if (!Array.isArray(value) || value.length > 30) return null;
  const requirements = [];
  for (const item of value) {
    const label = typeof item === "string" ? item.trim() : typeof item?.label === "string" ? item.label.trim() : "";
    if (!label || label.length > 160) return null;
    const completed = typeof item === "object" && item !== null ? item.completed : false;
    if (typeof completed !== "boolean") return null;
    const id = typeof item === "object" && item !== null && typeof item.id === "string" && item.id.length <= 64 ? item.id : crypto.randomUUID();
    requirements.push({ id, label, completed });
  }
  return requirements;
}

function normalizeApplicationDeadline(value) {
  if (value === undefined || value === null || value === "") return { valid: true, deadline: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { valid: false };
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return { valid: false };
  return { valid: true, deadline: value };
}

function buildCvStatus(profile, documents, application) {
  const cv = profile.cvData ? normalizeCvData(profile.cvData) : normalizeCvData({});
  const docExists = documents.some((document) => document.doc_id === "cv");
  const hasContent = Boolean(
    cv.personal.name || cv.summary || cv.education.some((item) => item.degree || item.institution) ||
    cv.skills.length || cv.projects.some((item) => item.name || item.description) ||
    cv.experience.some((item) => item.title || item.company)
  );
  const requiredSections = [
    Boolean(cv.personal.name),
    Boolean(cv.personal.email || profile.email),
    Boolean(cv.summary),
    cv.education.some((item) => item.degree && item.institution),
    cv.skills.some((item) => item.name),
    cv.projects.some((item) => item.name && item.description) || cv.experience.some((item) => item.title && item.company),
    cv.languages.some((item) => item.name && item.proficiency)
  ];
  const completeness = Math.round(requiredSections.filter(Boolean).length / requiredSections.length * 100);
  const applicantText = [
    cv.personal.title, cv.summary, ...cv.education.map((item) => `${item.degree} ${item.description}`),
    ...cv.skills.map((item) => `${item.category} ${item.name}`),
    ...cv.projects.map((item) => `${item.name} ${item.description} ${item.technologies}`),
    ...cv.experience.map((item) => `${item.title} ${item.description} ${item.achievements}`)
  ].join(" ").toLowerCase();
  const targetText = [
    application.title, application.route, ...application.requirements.map((item) => item.label),
    cv.target.title, cv.target.description
  ].join(" ").toLowerCase();
  const targetWords = [...new Set(targetText.match(/[a-z][a-z0-9+#.-]{2,}/g) || [])]
    .filter((word) => !["the", "and", "for", "with", "from", "your", "application", "study", "job", "university", "ausbildung", "program"].includes(word));
  const matchedWords = targetWords.filter((word) => applicantText.includes(word));
  const relevant = targetWords.length === 0 ? false : matchedWords.length > 0;
  const exists = hasContent || docExists;
  const complete = hasContent && completeness >= 70;
  return {
    exists,
    complete,
    relevant,
    completeness,
    matchPercent: targetWords.length ? Math.round(matchedWords.length / targetWords.length * 100) : 0
  };
}

async function main() {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  await fs.mkdir(UPLOAD_DIRECTORY, { recursive: true });
  const database = new DatabaseSync(DATABASE_PATH);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}',
      consent INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT NOT NULL,
      intent TEXT NOT NULL,
      salt TEXT NOT NULL,
      digest TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_limits (
      rate_key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      tip TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT,
      reviewed_at INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'needs_human_review',
      verification_risk TEXT NOT NULL DEFAULT 'unassessed',
      verification_confidence REAL,
      verification_report TEXT NOT NULL DEFAULT '{}',
      verification_source TEXT NOT NULL DEFAULT '',
      verification_analyzed_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, doc_id)
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Preparing',
      deadline TEXT,
      requirements TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS otp_expiry ON otp_codes(expires_at);
  `);
  const documentColumns = new Set(database.prepare("PRAGMA table_info(documents)").all().map((column) => column.name));
  if (!documentColumns.has("review_status")) database.exec("ALTER TABLE documents ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'");
  if (!documentColumns.has("review_note")) database.exec("ALTER TABLE documents ADD COLUMN review_note TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has("reviewed_by")) database.exec("ALTER TABLE documents ADD COLUMN reviewed_by TEXT");
  if (!documentColumns.has("reviewed_at")) database.exec("ALTER TABLE documents ADD COLUMN reviewed_at INTEGER");
  if (!documentColumns.has("verification_status")) database.exec("ALTER TABLE documents ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'needs_human_review'");
  if (!documentColumns.has("verification_risk")) database.exec("ALTER TABLE documents ADD COLUMN verification_risk TEXT NOT NULL DEFAULT 'unassessed'");
  if (!documentColumns.has("verification_confidence")) database.exec("ALTER TABLE documents ADD COLUMN verification_confidence REAL");
  if (!documentColumns.has("verification_report")) database.exec("ALTER TABLE documents ADD COLUMN verification_report TEXT NOT NULL DEFAULT '{}'");
  if (!documentColumns.has("verification_source")) database.exec("ALTER TABLE documents ADD COLUMN verification_source TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has("verification_analyzed_at")) database.exec("ALTER TABLE documents ADD COLUMN verification_analyzed_at INTEGER");
  const applicationColumns = new Set(database.prepare("PRAGMA table_info(applications)").all().map((column) => column.name));
  if (!applicationColumns.has("deadline")) database.exec("ALTER TABLE applications ADD COLUMN deadline TEXT");
  if (!applicationColumns.has("requirements")) database.exec("ALTER TABLE applications ADD COLUMN requirements TEXT NOT NULL DEFAULT '[]'");

  const transporter = process.env.MAIL_HOST && process.env.MAIL_FROM
    ? nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT || 587),
      secure: process.env.MAIL_SECURE === "true",
      auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD || "" } : undefined
    })
    : null;

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin && process.env.APP_ORIGIN && origin !== process.env.APP_ORIGIN) {
      return response.status(403).json({ error: "Request origin is not allowed." });
    }
    if (origin && !process.env.APP_ORIGIN) {
      const expectedOrigin = `${request.protocol}://${request.get("host")}`;
      if (origin !== expectedOrigin) return response.status(403).json({ error: "Cross-origin requests are not allowed." });
    }
    next();
  });

  const userFromSession = database.prepare(`
    SELECT users.id, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  function requireUser(request, response, next) {
    const token = cookies(request).jn_session;
    const session = token && userFromSession.get(hash(token), Date.now());
    if (!session) return response.status(401).json({ error: "Please sign in to continue." });
    request.user = session;
    next();
  }
  function isAdminEmail(email) {
    const allowed = (process.env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(email) || (process.env.NODE_ENV === "development" && email === "admin-preview@journova.local");
  }
  function requireAdmin(request, response, next) {
    const token = cookies(request).jn_admin_session;
    const session = token && userFromSession.get(hash(token), Date.now());
    if (!session) return response.status(401).json({ error: "Admin sign-in is required." });
    if (!isAdminEmail(session.email)) return response.status(403).json({ error: "This account is not authorised for document review." });
    request.user = session;
    next();
  }
  function profileFor(userId) {
    const saved = database.prepare("SELECT data, consent, updated_at FROM profiles WHERE user_id = ?").get(userId);
    return saved ? { ...parseJson(saved.data), consent: Boolean(saved.consent), updatedAt: saved.updated_at } : { consent: false };
  }
  function documentsFor(userId) {
    return database.prepare("SELECT id, user_id, doc_id, stored_name, original_name, mime, size, verified, tip, review_status, review_note, reviewed_by, reviewed_at, verification_status, verification_risk, verification_confidence, verification_report, verification_source, verification_analyzed_at, created_at FROM documents WHERE user_id = ? ORDER BY created_at").all(userId);
  }
  async function ensureDocumentReport(document, profile, uploadedDocuments) {
    const existing = parseJson(document.verification_report, null);
    if (existing?.version === 1) return existing;

    const extension = path.extname(document.stored_name).toLowerCase();
    const filePath = path.join(UPLOAD_DIRECTORY, document.user_id, document.stored_name);
    let verified = Boolean(document.verified);
    let tip = document.tip;
    let text = "";
    try {
      await fs.access(filePath);
      if (extension === ".txt") text = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      verified = false;
      tip = "The stored upload file is missing; it could not be checked.";
    }
    const report = buildDocumentVerificationReport({
      docId: document.doc_id,
      extension,
      size: document.size,
      verified,
      tip,
      text,
      profile,
      uploadedDocuments
    });
    const serialized = JSON.stringify(report);
    database.prepare("UPDATE documents SET verification_report = ?, verification_analyzed_at = ? WHERE id = ?")
      .run(serialized, report.generatedAt, document.id);
    document.verification_report = serialized;
    document.verification_analyzed_at = report.generatedAt;
    return report;
  }

  app.get("/", (request, response) => response.sendFile(PUBLIC_FILE));
  app.get("/cv-builder.js", (request, response) => response.sendFile(path.join(__dirname, "cv-builder.js")));
  app.get("/admin", (request, response) => response.sendFile(ADMIN_FILE));
  app.get("/api/health", (request, response) => response.json({
    status: "ok",
    localDevelopmentSession: process.env.NODE_ENV === "development"
  }));

  app.post("/api/dev/session", (request, response) => {
    if (process.env.NODE_ENV !== "development") return response.status(404).json({ error: "Not found." });
    const existingToken = cookies(request).jn_session;
    const existingUser = existingToken && userFromSession.get(hash(existingToken), Date.now());
    if (existingUser) return response.json({ user: { email: existingUser.email }, localDevelopmentSession: true });
    const email = "local-preview@journova.invalid";
    let user = database.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = crypto.randomUUID();
      database.prepare("INSERT INTO users(id, email, created_at) VALUES (?, ?, ?)").run(id, email, Date.now());
      database.prepare("INSERT INTO profiles(user_id, data, consent, updated_at) VALUES (?, '{}', 0, ?)").run(id, Date.now());
      user = { id, email };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hash(token), user.id, Date.now() + SESSION_TTL);
    setSessionCookie(response, token);
    response.json({ user: { email: user.email }, localDevelopmentSession: true });
  });

  app.post("/api/dev/admin-session", (request, response) => {
    if (process.env.NODE_ENV !== "development") return response.status(404).json({ error: "Not found." });
    const email = "admin-preview@journova.local";
    const currentToken = cookies(request).jn_admin_session;
    const currentUser = currentToken && userFromSession.get(hash(currentToken), Date.now());
    if (currentUser?.email === email) return response.json({ user: { email }, localDevelopmentSession: true });
    let user = database.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = crypto.randomUUID();
      database.prepare("INSERT INTO users(id, email, created_at) VALUES (?, ?, ?)").run(id, email, Date.now());
      database.prepare("INSERT INTO profiles(user_id, data, consent, updated_at) VALUES (?, '{}', 0, ?)").run(id, Date.now());
      user = { id, email };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hash(token), user.id, Date.now() + SESSION_TTL);
    setSessionCookie(response, token, "jn_admin_session");
    response.json({ user: { email }, localDevelopmentSession: true });
  });

  app.post("/api/admin/auth/verify-code", (request, response) => {
    const email = emailAddress(request.body?.email);
    const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
    if (!email || !/^\d{6}$/.test(code)) return response.status(400).json({ error: "Enter a valid email and six-digit code." });
    if (!isAdminEmail(email)) return response.status(403).json({ error: "This email is not configured for admin access." });
    const record = database.prepare("SELECT * FROM otp_codes WHERE email = ? AND intent = 'login'").get(email);
    const now = Date.now();
    if (!record || record.expires_at <= now || record.attempts >= 5) {
      database.prepare("DELETE FROM otp_codes WHERE email = ? AND intent = 'login'").run(email);
      return response.status(401).json({ error: "That code is invalid or expired. Request a new code." });
    }
    const candidate = crypto.scryptSync(code, record.salt, 64).toString("hex");
    if (!secureCompare(candidate, record.digest)) {
      database.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ? AND intent = 'login'").run(email);
      return response.status(401).json({ error: "That code does not match. Check it and try again." });
    }
    const user = database.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
    database.prepare("DELETE FROM otp_codes WHERE email = ? AND intent = 'login'").run(email);
    if (!user) return response.status(404).json({ error: "No account exists for this admin email. Register the account first, then add it to ADMIN_EMAILS." });
    const token = crypto.randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hash(token), user.id, now + SESSION_TTL);
    setSessionCookie(response, token, "jn_admin_session");
    response.json({ user: { email: user.email } });
  });

  app.post("/api/admin/auth/logout", requireAdmin, (request, response) => {
    const token = cookies(request).jn_admin_session;
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
    clearSessionCookie(response, "jn_admin_session");
    response.json({ ok: true });
  });

  app.get("/api/admin/me", requireAdmin, (request, response) => {
    response.json({ user: { email: request.user.email } });
  });

  app.get("/api/admin/documents", requireAdmin, async (request, response) => {
    const statuses = new Set(["pending", "approved", "needs_changes", "verified", "suspicious", "rejected"]);
    const status = request.query.status;
    if (status && status !== "all" && !statuses.has(status)) return response.status(400).json({ error: "Choose a valid review status." });
    const rows = database.prepare(`
      SELECT d.id, d.user_id, d.doc_id, d.original_name, d.mime, d.size, d.verified,
        d.tip, d.review_status, d.review_note, d.reviewed_by, d.reviewed_at, d.created_at,
        d.verification_status, d.verification_risk, d.verification_confidence,
        d.verification_report, d.verification_source, d.verification_analyzed_at,
        u.email, p.data AS profile_data
      FROM documents d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN profiles p ON p.user_id = d.user_id
      ${status && status !== "all" ? "WHERE d.review_status = ?" : ""}
      ORDER BY CASE d.review_status WHEN 'pending' THEN 0 WHEN 'suspicious' THEN 1 WHEN 'needs_changes' THEN 2 ELSE 3 END,
        d.created_at ASC
      LIMIT 200
    `).all(...(status && status !== "all" ? [status] : []));
    const documentsByUser = new Map();
    for (const row of rows) {
      if (!documentsByUser.has(row.user_id)) documentsByUser.set(row.user_id, documentsFor(row.user_id));
    }
    const documents = await Promise.all(rows.map(async (row) => {
      const profile = parseJson(row.profile_data);
      const uploadedDocuments = documentsByUser.get(row.user_id);
      const savedDocument = uploadedDocuments.find((document) => document.id === row.id);
      const report = await ensureDocumentReport(savedDocument, profile, uploadedDocuments);
      row.verification_report = JSON.stringify(report);
      row.verification_analyzed_at = savedDocument.verification_analyzed_at;
      return {
        id: row.id,
        type: row.doc_id,
        name: row.original_name,
        mime: row.mime,
        size: row.size,
        technicalCheck: row.verified ? "passed" : "needs_attention",
        technicalNote: row.tip,
        reviewStatus: row.review_status,
        reviewNote: row.review_note,
        reviewedBy: row.reviewed_by,
        reviewedAt: row.reviewed_at,
        uploadedAt: row.created_at,
        verificationStatus: row.verification_status,
        verificationRisk: row.verification_risk,
        verificationConfidence: row.verification_confidence,
        verificationReport: parseJson(row.verification_report),
        verificationSource: row.verification_source,
        verificationAnalyzedAt: row.verification_analyzed_at,
        applicant: { email: row.email, goal: profile.goal || "", selectedRoute: profile.selectedRoute || "" }
      };
    }));
    response.json({ documents });
  });

  app.get("/api/admin/documents/:id/file", requireAdmin, (request, response, next) => {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid document ID." });
    const document = database.prepare("SELECT user_id, stored_name, original_name FROM documents WHERE id = ?").get(id);
    if (!document) return response.status(404).json({ error: "Document not found." });
    const extension = path.extname(document.stored_name).toLowerCase();
    const mime = ({ ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8" })[extension];
    if (!mime) return response.status(415).json({ error: "This file type cannot be previewed." });
    response.setHeader("Content-Type", mime);
    const filename = path.basename(document.original_name).replace(/["\\\r\n]/g, "_");
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_");
    const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader("Content-Disposition", `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(document.stored_name, { root: path.join(UPLOAD_DIRECTORY, document.user_id), dotfiles: "deny" }, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.patch("/api/admin/documents/:id/review", requireAdmin, (request, response) => {
    const id = Number(request.params.id);
    const status = request.body?.status;
    const note = typeof request.body?.note === "string" ? request.body.note.trim() : "";
    if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "Invalid document ID." });
    if (!["approved", "needs_changes", "verified", "suspicious", "rejected"].includes(status)) return response.status(400).json({ error: "Choose a valid document review decision." });
    if (note.length > 500) return response.status(400).json({ error: "Review note must be 500 characters or fewer." });
    if (status === "needs_changes" && !note) return response.status(400).json({ error: "Add a short explanation so the applicant knows what to correct." });
    if (status === "verified" && !note) return response.status(400).json({ error: "Record the official issuer channel or evidence used before verifying this document." });
    if (["suspicious", "rejected"].includes(status) && !note) return response.status(400).json({ error: "Add a reviewer note explaining this decision." });
    const now = Date.now();
    const reviewStatus = status;
    const verificationStatus = status === "verified" ? "verified" : status === "suspicious" || status === "rejected" ? "high_risk" : undefined;
    const verificationRisk = status === "suspicious" || status === "rejected" ? "high" : status === "verified" ? "low" : undefined;
    const update = database.prepare(`
      UPDATE documents SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?,
        verification_status = COALESCE(?, verification_status),
        verification_risk = COALESCE(?, verification_risk),
        verification_source = CASE WHEN ? = 'verified' THEN ? ELSE verification_source END
      WHERE id = ?
    `).run(reviewStatus, note, request.user.email, now, verificationStatus ?? null, verificationRisk ?? null, status, status === "verified" ? note : "", id);
    if (!update.changes) return response.status(404).json({ error: "Document not found." });
    response.json({ document: { id, reviewStatus, verificationStatus: verificationStatus || undefined, reviewNote: note, reviewedBy: request.user.email, reviewedAt: now } });
  });

  app.post("/api/auth/request-code", async (request, response) => {
    const email = emailAddress(request.body?.email);
    const intent = request.body?.intent;
    if (!email || !["login", "register"].includes(intent)) return response.status(400).json({ error: "Enter a valid email and choose login or registration." });
    if (!transporter) return response.status(503).json({ error: "Email sign-in is not configured yet. Set MAIL_HOST, MAIL_FROM and SMTP credentials in the server environment." });

    const now = Date.now();
    const key = hash(`${request.ip}:${email}:${intent}`);
    const rate = database.prepare("SELECT window_start, count FROM auth_limits WHERE rate_key = ?").get(key);
    if (rate && rate.window_start + AUTH_WINDOW > now && rate.count >= OTP_LIMIT) {
      return response.status(429).json({ error: "Too many code requests. Wait 15 minutes and try again." });
    }
    if (!rate || rate.window_start + AUTH_WINDOW <= now) {
      database.prepare("INSERT OR REPLACE INTO auth_limits(rate_key, window_start, count) VALUES (?, ?, 1)").run(key, now);
    } else {
      database.prepare("UPDATE auth_limits SET count = count + 1 WHERE rate_key = ?").run(key);
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const digest = crypto.scryptSync(code, salt, 64).toString("hex");
    database.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
    database.prepare("INSERT INTO otp_codes(email, intent, salt, digest, expires_at, attempts, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
      .run(email, intent, salt, digest, now + OTP_TTL, now);

    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: "Your Journova sign-in code",
        text: `Your one-time Journova code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this email.`,
        html: `<p>Your one-time Journova code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this code, ignore this email.</p>`
      });
    } catch (error) {
      database.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
      console.error("Email delivery failed:", error.message);
      return response.status(502).json({ error: "The sign-in code could not be delivered. Check the email service configuration and try again." });
    }
    return response.status(202).json({ message: "If this address is eligible, a one-time code has been sent. Check your inbox." });
  });

  app.post("/api/auth/verify-code", (request, response) => {
    const email = emailAddress(request.body?.email);
    const code = typeof request.body?.code === "string" ? request.body.code.trim() : "";
    const intent = request.body?.intent;
    if (!email || !/^\d{6}$/.test(code) || !["login", "register"].includes(intent)) {
      return response.status(400).json({ error: "Enter the email, six-digit code and login/register choice." });
    }
    const record = database.prepare("SELECT * FROM otp_codes WHERE email = ? AND intent = ?").get(email, intent);
    const now = Date.now();
    if (!record || record.expires_at <= now || record.attempts >= 5) {
      database.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
      return response.status(401).json({ error: "That code is invalid or expired. Request a new code." });
    }
    const candidate = crypto.scryptSync(code, record.salt, 64).toString("hex");
    if (!secureCompare(candidate, record.digest)) {
      database.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
      return response.status(401).json({ error: "That code does not match. Check it and try again." });
    }
    let user = database.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
    if (intent === "register" && user) return response.status(409).json({ error: "An account already exists. Choose Login instead." });
    if (intent === "login" && !user) return response.status(404).json({ error: "No account was found for this email. Choose Register to create one." });
    if (!user) {
      const id = crypto.randomUUID();
      database.prepare("INSERT INTO users(id, email, created_at) VALUES (?, ?, ?)").run(id, email, now);
      database.prepare("INSERT INTO profiles(user_id, data, consent, updated_at) VALUES (?, '{}', 0, ?)").run(id, now);
      user = { id, email };
    }
    database.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
    const token = crypto.randomBytes(32).toString("base64url");
    database.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hash(token), user.id, now + SESSION_TTL);
    setSessionCookie(response, token);
    return response.json({ user: { email: user.email }, profile: profileFor(user.id) });
  });

  app.post("/api/auth/logout", requireUser, (request, response) => {
    const token = cookies(request).jn_session;
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/me", requireUser, (request, response) => {
    response.json({ user: { email: request.user.email }, profile: profileFor(request.user.id) });
  });

  app.get("/api/profile", requireUser, (request, response) => {
    response.json({ profile: profileFor(request.user.id) });
  });

  app.put("/api/profile", requireUser, (request, response) => {
    const incoming = request.body?.profile;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return response.status(400).json({ error: "Profile must be an object." });
    const data = {};
    for (const field of JOURNEY_FIELDS) {
      if (incoming[field] === undefined) continue;
      const value = incoming[field];
      if (field === "cvData") {
        data[field] = normalizeCvData(value);
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number") return response.status(400).json({ error: `Invalid ${field} value.` });
      if (typeof value === "string" && value.length > 180) return response.status(400).json({ error: `${field} is too long.` });
      data[field] = value;
    }
    if (data.goal && !VALID_GOALS.has(data.goal)) return response.status(400).json({ error: "Choose Study, Ausbildung or Job." });
    if (data.selectedRoute && !VALID_GOALS.has(data.selectedRoute) && data.selectedRoute !== "Bridge") return response.status(400).json({ error: "Choose Study, Ausbildung, Job or Bridge." });
    for (const field of ["marks", "experience", "age", "funds"]) {
      if (data[field] !== undefined && (!Number.isFinite(Number(data[field])) || Number(data[field]) < 0)) return response.status(400).json({ error: `${field} must be a non-negative number.` });
      if (data[field] !== undefined) data[field] = Number(data[field]);
    }
    if (data.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) return response.status(400).json({ error: "Target start date must use YYYY-MM-DD." });
    const previous = profileFor(request.user.id);
    const merged = Object.fromEntries(JOURNEY_FIELDS.filter((field) => previous[field] !== undefined).map((field) => [field, previous[field]]));
    Object.assign(merged, data);
    const newConsent = request.body.consent === undefined ? previous.consent : request.body.consent === true;
    const now = Date.now();
    database.prepare("INSERT INTO profiles(user_id, data, consent, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, consent=excluded.consent, updated_at=excluded.updated_at")
      .run(request.user.id, JSON.stringify(merged), Number(newConsent), now);
    response.json({ profile: { ...merged, consent: newConsent, updatedAt: now } });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (request, file, callback) => {
        const directory = path.join(UPLOAD_DIRECTORY, request.user.id);
        try {
          await fs.mkdir(directory, { recursive: true });
          callback(null, directory);
        } catch (error) {
          callback(error);
        }
      },
      filename: (request, file, callback) => {
        callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      }
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (request, file, callback) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (![".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt"].includes(ext)) return callback(new Error("Use a PDF, PNG, JPEG, WEBP or TXT file."));
      callback(null, true);
    }
  });

  app.get("/api/documents", requireUser, async (request, response) => {
    const storedDocuments = documentsFor(request.user.id);
    const currentProfile = profileFor(request.user.id);
    await Promise.all(storedDocuments.map((document) => ensureDocumentReport(document, currentProfile, storedDocuments)));
    const documents = storedDocuments.map((document) => ({
      doc_id: document.doc_id,
      original_name: document.original_name,
      generated: document.original_name.startsWith("Journova CV - "),
      mime: document.mime,
      size: document.size,
      verified: document.verified,
      tip: document.tip,
      review_status: document.verification_status === "high_risk" && document.review_status !== "rejected"
        ? "additional_review"
        : document.review_status === "suspicious" ? "additional_review" : document.review_status,
      review_note: document.review_status === "needs_changes" ? document.review_note : "",
      reviewed_by: document.reviewed_by,
      reviewed_at: document.reviewed_at,
      verification_status: document.verification_status === "high_risk" ? "needs_human_review" : document.verification_status,
      verification_analyzed_at: document.verification_analyzed_at,
      created_at: document.created_at
    }));
    response.json({ documents });
  });

  app.post("/api/documents", requireUser, upload.single("document"), async (request, response) => {
    if (!request.file) return response.status(400).json({ error: "Choose a document file to upload." });
    const docId = request.body.docId;
    const currentProfile = profileFor(request.user.id);
    const definition = REQUIRED_DOCUMENTS.find((doc) => doc.id === docId && (!doc.goal || doc.goal === currentProfile.goal));
    if (!definition) {
      await fs.unlink(request.file.path);
      return response.status(400).json({ error: "That document is not required for the selected route." });
    }
    const ext = path.extname(request.file.originalname).toLowerCase();
    let verified = false;
    let tip = "";
    let text = "";
    try {
      if (ext === ".pdf") {
        const handle = await fs.open(request.file.path, "r");
        const header = Buffer.alloc(5);
        await handle.read(header, 0, 5, 0);
        const tailLength = Math.min(request.file.size, 2048);
        const tail = Buffer.alloc(tailLength);
        await handle.read(tail, 0, tailLength, Math.max(0, request.file.size - tailLength));
        await handle.close();
        verified = header.toString("ascii") === "%PDF-" && tail.toString("latin1").includes("%%EOF");
        tip = verified ? "PDF signature and end marker passed local checks." : "PDF looks incomplete or unreadable. Re-export it as a PDF.";
      } else if (ext === ".txt") {
        text = await fs.readFile(request.file.path, "utf8");
        verified = text.trim().length > 0 && !text.includes("\u0000");
        tip = verified ? "Readable text content found." : "Text file is empty or unreadable.";
      } else {
        const detected = await fileTypeFromFile(request.file.path);
        const extensionMime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
        verified = Boolean(detected && detected.mime === extensionMime);
        tip = verified ? "Image file signature matches its extension. Check image clarity before submitting." : "Image signature does not match the file extension or is unreadable.";
      }
    } catch (error) {
      await fs.unlink(request.file.path).catch(() => {});
      return response.status(400).json({ error: `The file could not be checked: ${error.message}` });
    }

    const report = buildDocumentVerificationReport({
      docId,
      extension: ext,
      size: request.file.size,
      verified,
      tip,
      text,
      profile: currentProfile,
      uploadedDocuments: documentsFor(request.user.id)
    });
    const analyzedAt = report.generatedAt;
    const prior = database.prepare("SELECT stored_name FROM documents WHERE user_id = ? AND doc_id = ?").get(request.user.id, docId);
    if (prior) await fs.unlink(path.join(UPLOAD_DIRECTORY, request.user.id, prior.stored_name)).catch(() => {});
    database.prepare(`
      INSERT INTO documents(user_id, doc_id, stored_name, original_name, mime, size, verified, tip,
        review_status, review_note, reviewed_by, reviewed_at, verification_status, verification_risk,
        verification_confidence, verification_report, verification_source, verification_analyzed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', NULL, NULL, ?, ?, NULL, ?, '', ?, ?)
      ON CONFLICT(user_id, doc_id) DO UPDATE SET
        stored_name=excluded.stored_name, original_name=excluded.original_name, mime=excluded.mime,
        size=excluded.size, verified=excluded.verified, tip=excluded.tip, review_status='pending',
        review_note='', reviewed_by=NULL, reviewed_at=NULL, verification_status=excluded.verification_status,
        verification_risk=excluded.verification_risk, verification_confidence=NULL,
        verification_report=excluded.verification_report, verification_source='', verification_analyzed_at=excluded.verification_analyzed_at,
        created_at=excluded.created_at
    `).run(request.user.id, docId, request.file.filename, path.basename(request.file.originalname), request.file.mimetype, request.file.size, Number(verified), tip, report.status, report.riskLevel, JSON.stringify(report), analyzedAt, analyzedAt);
    response.status(201).json({ document: { docId, name: path.basename(request.file.originalname), mime: request.file.mimetype, size: request.file.size, verified, tip, reviewStatus: "pending", reviewNote: "", verificationStatus: report.status, verificationAnalyzedAt: analyzedAt } });
  });

  app.post("/api/documents/cv", requireUser, async (request, response) => {
    const currentProfile = profileFor(request.user.id);
    const cv = normalizeCvData(currentProfile.cvData || {});
    const content = cvPlainText(cv, request.user.email);
    const hasCvContent = Boolean(
      cv.personal.name || cv.personal.title || cv.summary ||
      cv.education.some((item) => Object.values(item).some(Boolean)) ||
      cv.skills.some((item) => item.name) ||
      cv.projects.some((item) => Object.values(item).some(Boolean)) ||
      cv.experience.some((item) => Object.values(item).some(Boolean))
    );
    if (!hasCvContent) return response.status(400).json({ error: "Add some CV information before saving it to Documents." });
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_UPLOAD_BYTES) return response.status(400).json({ error: "The generated CV exceeds the document size limit." });
    const directory = path.join(UPLOAD_DIRECTORY, request.user.id);
    await fs.mkdir(directory, { recursive: true });
    const storedName = `${crypto.randomUUID()}.txt`;
    const filePath = path.join(directory, storedName);
    await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
    const originalName = `Journova CV - ${(cv.personal.name || "Applicant").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 80)}.txt`;
    const existing = database.prepare("SELECT stored_name FROM documents WHERE user_id = ? AND doc_id = 'cv'").get(request.user.id);
    const tip = "Generated from your saved profile details. Review all facts and tailor it before submitting.";
    const report = buildDocumentVerificationReport({
      docId: "cv", extension: ".txt", size, verified: true, tip, text: content,
      profile: currentProfile, uploadedDocuments: documentsFor(request.user.id)
    });
    try {
      database.prepare(`
        INSERT INTO documents(user_id, doc_id, stored_name, original_name, mime, size, verified, tip,
          review_status, review_note, reviewed_by, reviewed_at, verification_status, verification_risk,
          verification_confidence, verification_report, verification_source, verification_analyzed_at, created_at)
        VALUES (?, 'cv', ?, ?, 'text/plain', ?, 1, ?, 'pending', '', NULL, NULL, ?, ?, NULL, ?, '', ?, ?)
        ON CONFLICT(user_id, doc_id) DO UPDATE SET
          stored_name=excluded.stored_name, original_name=excluded.original_name, mime=excluded.mime,
          size=excluded.size, verified=1, tip=excluded.tip, review_status='pending',
          review_note='', reviewed_by=NULL, reviewed_at=NULL, verification_status=excluded.verification_status,
          verification_risk=excluded.verification_risk, verification_confidence=NULL,
          verification_report=excluded.verification_report, verification_source='',
          verification_analyzed_at=excluded.verification_analyzed_at, created_at=excluded.created_at
      `).run(request.user.id, storedName, originalName, size, tip, report.status, report.riskLevel, JSON.stringify(report), report.generatedAt, report.generatedAt);
    } catch (error) {
      await fs.unlink(filePath).catch(() => {});
      throw error;
    }
    if (existing) {
      await fs.unlink(path.join(directory, existing.stored_name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    response.status(201).json({ document: { docId: "cv", name: originalName, mime: "text/plain", size, verified: true, generated: true, tip, reviewStatus: "pending", verificationStatus: report.status } });
  });

  app.get("/api/documents/:docId/file", requireUser, (request, response, next) => {
    const document = database.prepare("SELECT stored_name, original_name FROM documents WHERE user_id = ? AND doc_id = ?").get(request.user.id, request.params.docId);
    if (!document) return response.status(404).json({ error: "Document not found." });
    response.download(path.join(UPLOAD_DIRECTORY, request.user.id, document.stored_name), document.original_name, (error) => {
      if (error && !response.headersSent) next(error);
    });
  });

  app.delete("/api/documents/:docId", requireUser, async (request, response) => {
    const record = database.prepare("SELECT stored_name FROM documents WHERE user_id = ? AND doc_id = ?").get(request.user.id, request.params.docId);
    if (record) {
      database.prepare("DELETE FROM documents WHERE user_id = ? AND doc_id = ?").run(request.user.id, request.params.docId);
      await fs.unlink(path.join(UPLOAD_DIRECTORY, request.user.id, record.stored_name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    response.json({ ok: true });
  });

  app.get("/api/assessment", requireUser, (request, response) => {
    const currentProfile = profileFor(request.user.id);
    response.json({ assessment: buildAssessment(currentProfile, documentsFor(request.user.id)) });
  });

  app.get("/api/pathways", requireUser, (request, response) => {
    const currentProfile = profileFor(request.user.id);
    const assessment = buildAssessment(currentProfile, documentsFor(request.user.id));
    response.json({ fits: buildPathways(currentProfile, assessment), resources: OFFICIAL_RESOURCES });
  });

  app.get("/api/roadmap", requireUser, (request, response) => {
    const currentProfile = profileFor(request.user.id);
    const route = VALID_GOALS.has(request.query.route) ? request.query.route : currentProfile.goal || "Study";
    const sequences = {
      Study: [["Shortlist programmes", -10], ["Language test", -9], ["APS certificate", -8], ["Applications", -7], ["Admission", -5], ["Blocked account & finances", -4], ["Visa", -2], ["Fly to Germany", 0]],
      Ausbildung: [["Choose an occupation", -10], ["Build German toward B1/B2", -9], ["Prepare documents", -8], ["Apply to employers", -7], ["Interview & contract", -5], ["Arrange finances and housing", -4], ["Visa", -2], ["Fly to Germany", 0]],
      Job: [["Research target roles", -9], ["Prepare CV and references", -8], ["Check qualification recognition", -7], ["Apply and interview", -6], ["Secure job offer", -4], ["Arrange relocation finances", -3], ["Visa", -2], ["Fly to Germany", 0]]
    };
    const start = currentProfile.startDate ? new Date(`${currentProfile.startDate}T12:00:00`) : new Date(Date.now() + 10 * 30 * 86400000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const steps = sequences[route].map(([title, offset]) => {
      const date = new Date(start);
      date.setMonth(date.getMonth() + offset);
      return { title, date: date.toISOString(), doNow: date < today };
    });
    response.json({ route, startDate: start.toISOString(), monthsLeft: Math.max(0, Math.ceil((start - new Date()) / (30.4375 * 86400000))), steps });
  });

  app.get("/api/opportunities", requireUser, (request, response) => {
    const route = VALID_GOALS.has(request.query.route) ? request.query.route : profileFor(request.user.id).goal || "Study";
    response.json({ route, opportunities: [], officialResources: OFFICIAL_RESOURCES[route], message: "No live opportunity feed is connected. These links go to official search resources." });
  });

  app.get("/api/applications", requireUser, (request, response) => {
    const profile = { ...profileFor(request.user.id), email: request.user.email };
    const documents = documentsFor(request.user.id);
    const rows = database.prepare("SELECT id, title, organization, route, status, deadline, requirements, updated_at AS updatedAt FROM applications WHERE user_id = ? ORDER BY updated_at DESC").all(request.user.id);
    const applications = rows.map((row) => {
      const requirements = normalizeApplicationRequirements(parseJson(row.requirements, [])) || [];
      const application = { ...row, requirements };
      return { ...application, nextBestAction: buildApplicationNextAction(profile, documents, application) };
    });
    response.json({ applications });
  });

  app.post("/api/applications", requireUser, (request, response) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim().slice(0, 160) : "";
    const organization = typeof request.body?.organization === "string" ? request.body.organization.trim().slice(0, 160) : "";
    const route = request.body?.route;
    if (!title || !VALID_GOALS.has(route)) return response.status(400).json({ error: "Enter an application name and choose Study, Ausbildung or Job." });
    const deadlineInput = normalizeApplicationDeadline(request.body?.deadline);
    if (!deadlineInput.valid) return response.status(400).json({ error: "Enter a valid application deadline." });
    const requirements = request.body?.requirements === undefined ? [] : normalizeApplicationRequirements(request.body.requirements);
    if (!requirements) return response.status(400).json({ error: "Add up to 30 application requirements, each with a label of 160 characters or fewer." });
    const id = crypto.randomUUID();
    const now = Date.now();
    database.prepare("INSERT INTO applications(id, user_id, title, organization, route, status, deadline, requirements, updated_at) VALUES (?, ?, ?, ?, ?, 'Preparing', ?, ?, ?)")
      .run(id, request.user.id, title, organization, route, deadlineInput.deadline, JSON.stringify(requirements), now);
    response.status(201).json({ application: { id, title, organization, route, status: "Preparing", deadline: deadlineInput.deadline, requirements, updatedAt: now } });
  });

  app.patch("/api/applications/:id", requireUser, (request, response) => {
    const current = database.prepare("SELECT status, deadline, requirements FROM applications WHERE id = ? AND user_id = ?").get(request.params.id, request.user.id);
    if (!current) return response.status(404).json({ error: "Application not found." });
    const updates = { status: current.status, deadline: current.deadline, requirements: normalizeApplicationRequirements(parseJson(current.requirements, [])) || [] };
    if (Object.hasOwn(request.body || {}, "status")) {
      if (!["Preparing", "Applied", "Interview", "Offer", "Closed"].includes(request.body.status)) return response.status(400).json({ error: "Choose a valid application status." });
      updates.status = request.body.status;
    }
    if (Object.hasOwn(request.body || {}, "deadline")) {
      const deadlineInput = normalizeApplicationDeadline(request.body.deadline);
      if (!deadlineInput.valid) return response.status(400).json({ error: "Enter a valid application deadline." });
      updates.deadline = deadlineInput.deadline;
    }
    if (Object.hasOwn(request.body || {}, "requirements")) {
      const requirements = normalizeApplicationRequirements(request.body.requirements);
      if (!requirements) return response.status(400).json({ error: "Add up to 30 application requirements, each with a label of 160 characters or fewer." });
      updates.requirements = requirements;
    }
    database.prepare("UPDATE applications SET status = ?, deadline = ?, requirements = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(updates.status, updates.deadline, JSON.stringify(updates.requirements), Date.now(), request.params.id, request.user.id);
    response.json({ ok: true, application: { id: request.params.id, ...updates } });
  });

  app.delete("/api/applications/:id", requireUser, (request, response) => {
    database.prepare("DELETE FROM applications WHERE id = ? AND user_id = ?").run(request.params.id, request.user.id);
    response.json({ ok: true });
  });

  app.post("/api/assistant", requireUser, (request, response) => {
    const question = typeof request.body?.question === "string" ? request.body.question.trim().slice(0, 1000) : "";
    if (!question) return response.status(400).json({ error: "Enter a question." });
    const currentProfile = profileFor(request.user.id);
    const normalized = question.toLowerCase();
    let answer = "I can help you review your profile, document checklist, readiness factors and official resources. For eligibility or legal advice, confirm with the relevant German authority.";
    if (normalized.includes("visa")) answer = "Visa requirements depend on your route and personal circumstances. Use the German Missions in India website and confirm the current checklist before applying.";
    else if (normalized.includes("german") || normalized.includes("language")) answer = `Your current German level is ${currentProfile.german || "not set"}. ${currentProfile.german === "B2" || currentProfile.german === "C1" ? "Keep your certificate details current." : "A language learning plan can strengthen several routes."} Requirements vary by course, employer and visa category.`;
    else if (normalized.includes("document") || normalized.includes("passport")) answer = "The Documents page checks supported file type, size and basic readability locally. It does not verify identity, authenticity or whether an authority will accept a document.";
    else if (normalized.includes("fund") || normalized.includes("blocked account")) answer = `Your profile lists €${Number(currentProfile.funds || 0).toLocaleString("en")} in available funds. Financial requirements change and vary by route; verify current amounts with official sources before transferring money.`;
    response.json({ answer, source: "Profile-aware guidance rules; no external AI service is connected." });
  });

  app.get("/api/dashboard", requireUser, (request, response) => {
    const currentProfile = profileFor(request.user.id);
    const documents = documentsFor(request.user.id);
    const assessment = buildAssessment(currentProfile, documents);
    const applications = database.prepare("SELECT id, title, organization, route, status, updated_at AS updatedAt FROM applications WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5").all(request.user.id);
    response.json({
      email: request.user.email,
      profile: currentProfile,
      assessment,
      documentCount: documents.length,
      verifiedCount: documents.filter((doc) => ["approved", "verified"].includes(doc.review_status)).length,
      applications
    });

    app.post("/api/handoffs", requireUser, (request, response) => {
      const currentProfile = profileFor(request.user.id);
      if (!currentProfile.consent) return response.status(403).json({ error: "Consent is required before saving a counsellor handoff." });
      const id = crypto.randomUUID();
      const now = Date.now();
      const payload = {
        applicantEmail: request.user.email,
        goal: currentProfile.goal || "",
        selectedRoute: currentProfile.selectedRoute || "",
        readiness: buildAssessment(currentProfile, documentsFor(request.user.id)),
        profile: Object.fromEntries(JOURNEY_FIELDS.filter((field) => field !== "cvData" && currentProfile[field] !== undefined).map((field) => [field, currentProfile[field]])),
        documents: documentsFor(request.user.id).map((doc) => ({ type: doc.doc_id, name: doc.original_name, verified: ["approved", "verified"].includes(doc.review_status), reviewStatus: doc.review_status }))
      };
      database.prepare("INSERT INTO handoffs(id, user_id, payload, status, created_at) VALUES (?, ?, ?, 'saved', ?)")
        .run(id, request.user.id, JSON.stringify(payload), now);
      response.status(201).json({ handoff: { id, status: "saved", createdAt: now }, message: "The handoff was saved to your account. No counsellor was notified." });
    });
  });

  app.post("/api/account/delete", requireUser, async (request, response) => {
    const userId = request.user.id;
    const token = cookies(request).jn_session;
    database.prepare("DELETE FROM users WHERE id = ?").run(userId);
    await fs.rm(path.join(UPLOAD_DIRECTORY, userId), { recursive: true, force: true });
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.use((request, response) => response.status(404).json({ error: "Not found." }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE" ? "File is over 10 MB." : error.message;
      return response.status(400).json({ error: message });
    }
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return response.status(status).json({ error: status >= 500 ? "The server could not complete this request." : error.message });
  });

  const host = process.env.NODE_ENV === "development" ? "127.0.0.1" : (process.env.HOST || "0.0.0.0");
  const server = app.listen(PORT, host, () => console.log(`Journova is available at http://localhost:${PORT}`));
  const shutdown = () => {
    server.close(() => {
      database.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Journova startup failed:", error);
  process.exitCode = 1;
});
