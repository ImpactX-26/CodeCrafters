(() => {
  "use strict";

  const categories = ["Programming Languages", "AI / ML", "Web Development", "Database", "Tools", "Other"];
  const sections = {
    education: { title: "Education", fields: [["degree", "Degree"], ["institution", "Institution"], ["location", "Location"], ["startDate", "Start date"], ["endDate", "End date"], ["grade", "Grade / CGPA"], ["description", "Description", "textarea"]] },
    projects: { title: "Projects", fields: [["name", "Project name"], ["description", "Description", "textarea"], ["technologies", "Technologies"], ["github", "GitHub link"], ["live", "Live demo link"]] },
    experience: { title: "Experience", fields: [["title", "Job / internship title"], ["company", "Company"], ["location", "Location"], ["startDate", "Start date"], ["endDate", "End date"], ["description", "Description", "textarea"], ["achievements", "Achievements", "textarea"]] },
    hackathons: { title: "Hackathons", fields: [["name", "Hackathon"], ["organization", "Organization"], ["project", "Project"], ["result", "Achievement / result"], ["technologies", "Technologies"]] },
    certifications: { title: "Certifications", fields: [["name", "Certificate"], ["organization", "Issuing organization"], ["date", "Date"], ["credential", "Credential link"]] },
    languages: { title: "Languages", fields: [["name", "Language"], ["proficiency", "Proficiency"]] },
    achievements: { title: "Achievements & awards", fields: [["name", "Award"], ["organization", "Organization"], ["date", "Date"], ["description", "Description", "textarea"]] }
  };
  const labels = {
    English: { contact: "Contact", present: "Present", summary: "Profile", education: "Education", skills: "Technical skills", projects: "Projects", experience: "Experience", hackathons: "Hackathons", certifications: "Certifications", languages: "Languages", achievements: "Achievements" },
    German: { contact: "Kontakt", present: "Heute", summary: "Profil", education: "Bildung", skills: "Kenntnisse", projects: "Projekte", experience: "Berufserfahrung", hackathons: "Wettbewerbe", certifications: "Zertifikate", languages: "Sprachen", achievements: "Auszeichnungen" }
  };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const cleanText = (value) => typeof value === "string" ? value.trim() : "";
  const emptyPersonal = () => Object.fromEntries(["name", "title", "email", "phone", "location", "linkedin", "github", "portfolio"].map((key) => [key, ""]));

  function normalize(value) {
    const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const personal = data.personal && typeof data.personal === "object" && !Array.isArray(data.personal) ? data.personal : {};
    let skills = Array.isArray(data.skills) ? data.skills : [];
    if (typeof data.skills === "string") skills = data.skills.split(/[,\n;]/).map((name) => name.trim()).filter(Boolean).map((name) => ({ category: "Other", name }));
    return {
      personal: { ...emptyPersonal(), ...personal, name: cleanText(personal.name ?? data.name), title: cleanText(personal.title ?? data.headline) },
      summary: cleanText(data.summary),
      education: Array.isArray(data.education) ? data.education : [],
      skills,
      projects: Array.isArray(data.projects) ? data.projects : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      hackathons: Array.isArray(data.hackathons) ? data.hackathons : [],
      certifications: Array.isArray(data.certifications) ? data.certifications : [],
      languages: Array.isArray(data.languages) ? data.languages : [],
      achievements: Array.isArray(data.achievements) ? data.achievements : [],
      template: ["classic", "modern", "european"].includes(data.template) ? data.template : "classic",
      europeanMode: data.europeanMode === true,
      target: {
        type: ["University", "Ausbildung", "Internship", "Job", "Scholarship"].includes(data.target?.type) ? data.target.type : "Job",
        title: cleanText(data.target?.title),
        description: cleanText(data.target?.description),
        language: data.target?.language === "German" ? "German" : "English"
      }
    };
  }

  function prefill(value, profile) {
    const data = normalize(value);
    const applicantProfile = profile || {};
    if (!data.personal.email && applicantProfile.email) data.personal.email = applicantProfile.email;
    if (!data.personal.title && applicantProfile.field) data.personal.title = `${applicantProfile.field} applicant`;
    if (!data.education.length && applicantProfile.education) {
      data.education.push({
        degree: String(applicantProfile.education),
        institution: "",
        location: "",
        startDate: "",
        endDate: "",
        grade: applicantProfile.marks === "" || applicantProfile.marks === undefined ? "" : `${applicantProfile.marks}%`,
        description: ""
      });
    }
    return data;
  }

  function setPath(data, path, value) {
    const parts = path.split(".");
    let cursor = data;
    for (const part of parts.slice(0, -1)) {
      const key = /^\d+$/.test(part) ? Number(part) : part;
      cursor = cursor[key];
      if (cursor === undefined || cursor === null) return;
    }
    const last = parts[parts.length - 1];
    cursor[/^\d+$/.test(last) ? Number(last) : last] = value;
  }

  function field(path, label, value, type = "text") {
    const control = type === "textarea"
      ? `<textarea class="answer-control cv-textarea" data-cv-path="${esc(path)}" rows="3" maxlength="2000">${esc(value)}</textarea>`
      : `<input class="answer-control" data-cv-path="${esc(path)}" value="${esc(value)}" maxlength="300" ${type === "url" ? 'type="url"' : "type=\"text\""}>`;
    return `<label class="field-label cv-field">${esc(label)}${control}</label>`;
  }

  function dateText(start, end, words) {
    if (!start && !end) return "";
    const dates = [start, end || words.present].filter(Boolean);
    return dates.length ? `<span class="cv-date">${dates.map(esc).join(" – ")}</span>` : "";
  }

  function itemFields(section, entries) {
    const definition = sections[section];
    const rows = entries.length ? entries : [];
    return `<section class="cv-editor-section"><div class="cv-editor-heading"><h2>${esc(definition.title)}</h2><button class="small-button" type="button" data-action="cv-add" data-section="${section}">＋ Add ${esc(section === "achievements" ? "award" : section.slice(0, -1))}</button></div>${rows.length ? rows.map((entry, index) => `<article class="cv-entry"><div class="cv-entry-heading"><strong>${esc(definition.title.slice(0, -1))} ${index + 1}</strong><button class="small-button" type="button" data-action="cv-remove" data-section="${section}" data-index="${index}" aria-label="Remove ${esc(definition.title)} entry">Remove</button></div><div class="cv-form-grid">${definition.fields.map(([key, label, type]) => `<div class="${type === "textarea" ? "cv-field-wide" : ""}">${field(`${section}.${index}.${key}`, label, entry[key], type)}</div>`).join("")}</div>${section === "projects" ? `<button class="small-button" type="button" data-action="cv-improve" data-path="${section}.${index}.description">Improve wording</button>` : ""}</article>`).join("") : `<p class="indicative-note">Add details when you have them. Empty sections are omitted from the CV.</p>`}</section>`;
  }

  function editor(data, profile, applications, selectedApplicationId) {
    const personal = data.personal;
    const sectionsHtml = Object.entries(sections).filter(([key]) => key !== "education").map(([key]) => itemFields(key, data[key])).join("");
    const targetApplications = (applications || []).map((application) =>
      `<option value="${esc(application.id)}" ${application.id === selectedApplicationId ? "selected" : ""}>${esc(application.title)}${application.organization ? ` · ${esc(application.organization)}` : ""}</option>`
    ).join("");
    return `<div class="screen-head"><div><span class="kicker">Tools</span><h1>Professional CV Builder</h1><p>Build a factual, ATS-readable CV and tailor it to one opportunity at a time.</p></div></div>
      <div class="cv-layout">
        <section class="cv-editor glass-card">
          <section class="cv-editor-section"><div class="cv-editor-heading"><h2>Personal information</h2></div><div class="cv-form-grid">${[
      ["name", "Full name"], ["title", "Professional title"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"], ["linkedin", "LinkedIn URL"], ["github", "GitHub URL"], ["portfolio", "Portfolio URL"]
    ].map(([key, label]) => field(`personal.${key}`, label, personal[key], key.endsWith("URL") ? "url" : "text")).join("")}</div><p class="indicative-note">No date of birth, photograph or other sensitive details are added automatically.</p></section>
          <section class="cv-editor-section"><div class="cv-editor-heading"><h2>Professional summary</h2><button class="small-button" type="button" data-action="cv-summary">Generate with local writing assist</button></div>${field("summary", "2–4 concise lines", data.summary, "textarea")}<p class="indicative-note">Uses only details you entered here or in your existing profile. No external AI service is connected.</p></section>
          ${itemFields("education", data.education)}
          <section class="cv-editor-section"><div class="cv-editor-heading"><h2>Technical skills</h2><button class="small-button" type="button" data-action="cv-add" data-section="skills">＋ Add skill</button></div>${data.skills.length ? data.skills.map((skill, index) => `<article class="cv-entry cv-skill-entry"><label class="field-label cv-field">Category<select class="answer-control" data-cv-path="skills.${index}.category">${categories.map((category) => `<option ${skill.category === category ? "selected" : ""}>${esc(category)}</option>`).join("")}</select></label>${field(`skills.${index}.name`, "Skill", skill.name)}<button class="small-button" type="button" data-action="cv-remove" data-section="skills" data-index="${index}">Remove</button></article>`).join("") : `<p class="indicative-note">List only skills you can discuss or demonstrate.</p>`}<button class="small-button" type="button" data-action="cv-suggest">Suggest from your CV</button><div class="cv-suggestions" data-cv-suggestions></div></section>
          ${sectionsHtml}
          <section class="cv-editor-section"><div class="cv-editor-heading"><h2>Target & format</h2></div><div class="cv-form-grid"><label class="field-label cv-field">Target<select class="answer-control" data-cv-path="target.type">${["University", "Ausbildung", "Internship", "Job", "Scholarship"].map((item) => `<option ${data.target.type === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><label class="field-label cv-field">Content language<select class="answer-control" data-cv-path="target.language"><option ${data.target.language === "English" ? "selected" : ""}>English</option><option ${data.target.language === "German" ? "selected" : ""}>German</option></select></label><label class="field-label cv-field cv-field-wide">Target role / programme<input class="answer-control" data-cv-path="target.title" value="${esc(data.target.title)}" maxlength="300" placeholder="AI/ML Intern"></label><label class="field-label cv-field cv-field-wide">Job / programme description<textarea class="answer-control cv-textarea" data-cv-path="target.description" rows="4" maxlength="5000" placeholder="Paste requirements from the official listing">${esc(data.target.description)}</textarea></label></div><label class="cv-check"><input type="checkbox" data-cv-path="europeanMode" ${data.europeanMode ? "checked" : ""}> German / European CV mode · reverse chronological sections</label><p class="indicative-note">Write or review German-language content yourself; the builder does not translate or add personal details.</p><label class="field-label cv-field">Template<select class="answer-control" data-cv-path="template"><option value="classic" ${data.template === "classic" ? "selected" : ""}>Classic · ATS friendly</option><option value="modern" ${data.template === "modern" ? "selected" : ""}>Modern · restrained</option><option value="european" ${data.template === "european" ? "selected" : ""}>European · clean and chronological</option></select></label></section>
          <div class="cv-actions"><button class="next-button" type="button" data-action="cv-save">Save CV & add to Documents</button><button class="secondary-button" type="button" data-action="cv-download-text">Download text</button></div>
          <p class="indicative-note">Saving stores CV data in your existing authenticated profile and updates its existing CV document slot. A re-upload replaces that CV file only after confirmation.</p>
        </section>
        <section class="cv-preview-column"><div class="cv-toolbar"><label class="field-label">Optimize for an application<select class="answer-control" data-cv-application><option value="">Choose an application</option>${targetApplications}</select></label><div class="cv-actions"><button class="small-button" type="button" data-action="cv-analyze">Analyze CV</button><button class="small-button" type="button" data-action="cv-ats">Analyze ATS compatibility</button></div><div class="cv-actions"><button class="small-button" type="button" data-action="cv-optimize" data-target-type="Job">Optimize for Job</button><button class="small-button" type="button" data-action="cv-optimize" data-target-type="University">University</button><button class="small-button" type="button" data-action="cv-optimize" data-target-type="Ausbildung">Ausbildung</button></div><div class="cv-target-panel"><strong>${esc(data.target.title || data.target.type)} match</strong><p data-cv-match>${esc(matchSummary(data))}</p><p class="indicative-note">Matches terms you provided against your existing CV text. Missing keywords are not assumed skills.</p></div><div class="cv-analysis-panel" data-cv-analysis hidden></div></div><div class="cv-paper-wrap"><article class="cv-paper cv-template-${esc(data.template)}" data-cv-preview-root>${renderPreview(data, profile)}</article></div><div class="cv-actions cv-export-actions"><button class="next-button" type="button" data-action="cv-pdf">Download PDF</button><button class="secondary-button" type="button" data-action="cv-print">Print CV</button></div><p class="indicative-note">PDF export opens your browser’s print dialog. Choose “Save as PDF” for selectable text on A4 paper.</p></section>
      </div>`;
  }

  function matchSummary(value) {
    const data = normalize(value);
    const words = keywords(`${data.target.title} ${data.target.description}`);
    if (!words.length) return "Add a target title or listing description for a keyword comparison.";
    const text = cvSearchableText(data);
    const found = words.filter((word) => text.includes(word));
    return `${found.length} of ${words.length} relevant terms found: ${found.slice(0, 8).join(", ") || "none yet"}.`;
  }

  function keywords(value) {
    return [...new Set(value.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [])]
      .filter((word) => !["the", "and", "for", "with", "from", "your", "application", "study", "job", "university", "ausbildung", "program", "role", "experience", "required", "skills"].includes(word));
  }

  function cvSearchableText(value) {
    const data = normalize(value);
    return [
      data.personal.title, data.summary, ...data.education.map((item) => `${item.degree} ${item.description}`),
      ...data.skills.map((item) => `${item.category} ${item.name}`),
      ...data.projects.map((item) => `${item.name} ${item.description} ${item.technologies}`),
      ...data.experience.map((item) => `${item.title} ${item.description} ${item.achievements}`)
    ].join(" ").toLowerCase();
  }

  function analysis(value, profile) {
    const data = normalize(value);
    const email = Boolean(data.personal.email || profile?.email);
    const checks = [
      ["Profile & contact", Boolean(data.personal.name && email), "Add your name and a contact email."],
      ["Education", data.education.some((item) => item.degree && item.institution), "Add your real qualification and institution."],
      ["Skills", data.skills.some((item) => item.name), "List skills you can demonstrate."],
      ["Projects", data.projects.some((item) => item.name && item.description), "Add a project and explain your contribution."],
      ["Experience", data.experience.some((item) => item.title && item.company), "Add work or internship experience if applicable; do not invent it."],
      ["Languages", data.languages.some((item) => item.name && item.proficiency), "State language levels only when known."],
      ["Achievements", data.achievements.some((item) => item.name), "Add a relevant award only if you have one."]
    ];
    const score = Math.round(checks.filter(([, complete]) => complete).length / checks.length * 100);
    const roleWords = keywords(`${data.target.title} ${data.target.description}`);
    const cvText = cvSearchableText(data);
    const found = roleWords.filter((word) => cvText.includes(word));
    const missing = roleWords.filter((word) => !cvText.includes(word));
    const atsScore = roleWords.length ? Math.round(found.length / roleWords.length * 100) : null;
    return {
      score,
      checks,
      recommendations: checks.filter(([, complete]) => !complete).map(([, , suggestion]) => suggestion).slice(0, 4),
      atsScore,
      matched: found.slice(0, 12),
      missing: missing.slice(0, 12),
      atsNotes: [
        "Standard section headings and selectable text are used.",
        "Add only relevant target keywords that accurately describe your experience."
      ]
    };
  }

  function improveText(value) {
    const original = cleanText(value);
    if (!original) return "";
    return original.split(/\n+/).map((line) => {
      const text = line.trim().replace(/^[•*-]\s*/, "");
      if (!text) return "";
      return `• ${text[0].toUpperCase()}${text.slice(1)}`;
    }).filter(Boolean).join("\n");
  }

  function generateSummary(value, profile) {
    const data = normalize(value);
    const role = data.personal.title || profile?.field;
    const education = data.education.find((item) => item.degree)?.degree || profile?.education;
    const project = data.projects.find((item) => item.name)?.name;
    const skills = data.skills.map((item) => item.name).filter(Boolean).slice(0, 3);
    const statements = [];
    if (education) statements.push(`Education: ${education}.`);
    if (role) statements.push(`Applicant focus: ${role}.`);
    if (project) statements.push(`Project experience includes ${project}.`);
    if (skills.length) statements.push(`Skills listed: ${skills.join(", ")}.`);
    return statements.join(" ");
  }

  function skillSuggestions(value, profile) {
    const data = normalize(value);
    const known = new Set(data.skills.map((item) => item.name.trim().toLowerCase()).filter(Boolean));
    const suggestions = [];
    for (const project of data.projects) {
      for (const item of (project.technologies || "").split(/[,\n;]/).map((name) => name.trim()).filter(Boolean)) {
        if (!known.has(item.toLowerCase()) && !suggestions.some((entry) => entry.name.toLowerCase() === item.toLowerCase())) {
          suggestions.push({ category: "Other", name: item, source: `Project: ${project.name || "untitled"}` });
        }
      }
    }
    return suggestions.slice(0, 8);
  }

  function sectionBlock(title, body) {
    return body ? `<section class="cv-section"><h2>${esc(title)}</h2>${body}</section>` : "";
  }

  function listLines(value) {
    return value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  function sortRecent(items, enabled) {
    return enabled ? [...items].sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || ""))) : items;
  }

  function renderPreview(value, profile) {
    const data = normalize(value);
    const words = labels[data.target.language];
    const personal = data.personal;
    const contact = [personal.email || profile?.email, personal.phone, personal.location, personal.linkedin, personal.github, personal.portfolio].filter(Boolean);
    const education = sortRecent(data.education, data.europeanMode).map((item) => {
      const title = [item.degree, item.institution].filter(Boolean).map(esc).join(" · ");
      const detail = [item.location, item.grade, item.description].filter(Boolean).map(esc).join(" · ");
      if (!title && !detail) return "";
      return `<article class="cv-item"><div class="cv-item-head"><strong>${title}</strong>${dateText(item.startDate, item.endDate, words)}</div>${detail ? `<p>${detail}</p>` : ""}</article>`;
    }).join("");
    const skills = data.skills.filter((item) => item.name).map((item) => `<p class="cv-skill"><strong>${esc(item.category || words.skills)}:</strong> ${esc(item.name)}</p>`).join("");
    const projects = data.projects.map((item) => {
      if (!item.name && !item.description) return "";
      return `<article class="cv-item"><div class="cv-item-head"><strong>${esc(item.name)}</strong>${item.technologies ? `<span class="cv-date">${esc(item.technologies)}</span>` : ""}</div>${item.description ? `<p>${listLines(item.description).map(esc).join("<br>")}</p>` : ""}<p class="cv-links">${[item.github, item.live].filter(Boolean).map((link) => `<span>${esc(link)}</span>`).join(" · ")}</p></article>`;
    }).join("");
    const experience = sortRecent(data.experience, data.europeanMode).map((item) => {
      if (!item.title && !item.company) return "";
      return `<article class="cv-item"><div class="cv-item-head"><strong>${[item.title, item.company].filter(Boolean).map(esc).join(" · ")}</strong>${dateText(item.startDate, item.endDate, words)}</div>${item.location ? `<p>${esc(item.location)}</p>` : ""}${[item.description, item.achievements].filter(Boolean).map((part) => `<p>${listLines(part).map(esc).join("<br>")}</p>`).join("")}</article>`;
    }).join("");
    const hackathons = data.hackathons.filter((item) => item.name || item.project).map((item) => `<p class="cv-compact"><strong>${[item.name, item.organization].filter(Boolean).map(esc).join(" · ")}</strong>${[item.project, item.result, item.technologies].filter(Boolean).length ? ` — ${[item.project, item.result, item.technologies].filter(Boolean).map(esc).join(" · ")}` : ""}</p>`).join("");
    const certifications = data.certifications.filter((item) => item.name).map((item) => `<p class="cv-compact"><strong>${esc(item.name)}</strong>${[item.organization, item.date, item.credential].filter(Boolean).length ? ` — ${[item.organization, item.date, item.credential].filter(Boolean).map(esc).join(" · ")}` : ""}</p>`).join("");
    const languages = data.languages.filter((item) => item.name).map((item) => `<p class="cv-compact">${esc(item.name)}${item.proficiency ? ` — ${esc(item.proficiency)}` : ""}</p>`).join("");
    const achievements = data.achievements.filter((item) => item.name).map((item) => `<p class="cv-compact"><strong>${esc(item.name)}</strong>${[item.organization, item.date, item.description].filter(Boolean).length ? ` — ${[item.organization, item.date, item.description].filter(Boolean).map(esc).join(" · ")}` : ""}</p>`).join("");
    const subtitle = personal.title ? `<p class="cv-title">${esc(personal.title)}</p>` : "";
    return `<header class="cv-header"><h1>${esc(personal.name || "Your name")}</h1>${subtitle}${contact.length ? `<p class="cv-contact">${contact.map(esc).join(" | ")}</p>` : ""}</header>
      ${sectionBlock(words.summary, data.summary ? `<p class="cv-summary">${esc(data.summary)}</p>` : "")}
      ${sectionBlock(words.education, education)}
      ${sectionBlock(words.skills, skills)}
      ${sectionBlock(words.projects, projects)}
      ${sectionBlock(words.experience, experience)}
      ${sectionBlock(words.hackathons, hackathons)}
      ${sectionBlock(words.certifications, certifications)}
      ${sectionBlock(words.languages, languages)}
      ${sectionBlock(words.achievements, achievements)}`;
  }

  function plainText(value, profile) {
    const data = normalize(value);
    const email = data.personal.email || profile?.email;
    const parts = [
      data.personal.name,
      data.personal.title,
      [email, data.personal.phone, data.personal.location, data.personal.linkedin, data.personal.github, data.personal.portfolio].filter(Boolean).join(" | ")
    ].filter(Boolean);
    const section = (heading, values) => {
      const entries = values.filter(Boolean);
      if (entries.length) parts.push("", heading.toUpperCase(), ...entries);
    };
    const words = labels[data.target.language];
    section(words.summary, [data.summary]);
    section(words.education, data.education.map((item) => [item.degree, item.institution, item.location, [item.startDate, item.endDate].filter(Boolean).join(" – "), item.grade, item.description].filter(Boolean).join(" | ")));
    section(words.skills, data.skills.map((item) => `${item.category}: ${item.name}`));
    section(words.projects, data.projects.map((item) => [item.name, item.description, item.technologies, item.github, item.live].filter(Boolean).join(" | ")));
    section(words.experience, data.experience.map((item) => [item.title, item.company, item.location, [item.startDate, item.endDate].filter(Boolean).join(" – "), item.description, item.achievements].filter(Boolean).join(" | ")));
    section(words.hackathons, data.hackathons.map((item) => [item.name, item.organization, item.project, item.result, item.technologies].filter(Boolean).join(" | ")));
    section(words.certifications, data.certifications.map((item) => [item.name, item.organization, item.date, item.credential].filter(Boolean).join(" | ")));
    section(words.languages, data.languages.map((item) => [item.name, item.proficiency].filter(Boolean).join(" — ")));
    section(words.achievements, data.achievements.map((item) => [item.name, item.organization, item.date, item.description].filter(Boolean).join(" | ")));
    return parts.join("\n").trim();
  }

  window.JournovaCvBuilder = {
    categories,
    normalize,
    prefill,
    setPath,
    editor,
    renderPreview,
    analysis,
    improveText,
    generateSummary,
    skillSuggestions,
    matchSummary,
    plainText,
    createEntry(section) {
      if (section === "skills") return { category: "Programming Languages", name: "" };
      const definition = sections[section];
      return definition ? Object.fromEntries(definition.fields.map(([key]) => [key, ""])) : null;
    }
  };
})();
