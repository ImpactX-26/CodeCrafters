# Journova AI

Journova is a responsive applicant-journey web app with an Express API and a local SQLite database.

## Run locally

Requirements: Node.js 22.5 or newer.

```powershell
npm.cmd install
npm.cmd run dev
```

Open <http://localhost:3000>. The `dev` command serves both the frontend and API from the same Express server; there is no separate frontend port. In PowerShell, use `npm.cmd` to avoid execution-policy errors when `npm` resolves to `npm.ps1`. The development server binds to `127.0.0.1` and starts a local-only development session so the dashboard and API can be exercised without email credentials. This session is not real authentication and is disabled outside `NODE_ENV=development`. Do not expose the development server to a network.

The earlier `file:///.../index.html` page cannot call the Express API. Use the HTTP address above.

## Admin document review

Open <http://localhost:3000/admin> for the separate review portal. In local development it uses a local-only admin preview session so you can inspect the review UI without configuring email. The local preview is available only from the development server, which binds to `127.0.0.1`.

For a real admin account:

1. Register the reviewer's account through the applicant site using a working SMTP configuration.
2. Add the reviewer's account email to `ADMIN_EMAILS` in the server environment. Separate multiple addresses with commas.
3. Restart the server and sign in at `/admin` using that email's one-time code.

Admins can open private uploaded files, inspect the stored screening report, approve a visual review, request a re-upload, flag a document for additional review, reject it, or record an issuer verification. Verification requires a reviewer note describing the official issuer channel or evidence used. Marking a document suspicious does not automatically reject the applicant. Applicant document screens refresh review decisions automatically while open; the admin queue refreshes while visible.

The upload report records file-signature/readability checks, profile and required-document completeness, and explicit unavailable checks. Plain-text labelled fields may be extracted from TXT files; this is not OCR. There is no AI provider, OCR engine, name matching, alteration detection, or official issuer lookup connected. Accordingly, new uploads remain `Needs human review`, authenticity confidence is not calculated, and the report never claims a file is genuine or fake. Visual approval alone does not establish authenticity or guarantee acceptance by an institution or authority. To verify a certificate, use the issuing organisation's official lookup channel when available or contact it using independently sourced official contact details. Documents remain private; admin APIs require an allowlisted admin session.

## Real email sign-in

Copy `.env.example` to `.env`, then fill in the SMTP settings supplied by your email provider. Never commit `.env` or paste credentials into source code. Start the regular server with `npm start`; the login and registration tabs then send an actual one-time code through SMTP. Without SMTP configuration the API returns an explicit configuration error instead of accepting a fake code.

Set `NODE_ENV=production`, `APP_ORIGIN`, HTTPS, and a persistent database/upload volume when deploying. The production server does not expose the local development session endpoint.

## Data and service boundaries

- SQLite stores user profiles, consent, applications, and handoff requests in `data/journova.sqlite`.
- Uploaded documents are stored under `data/uploads/`, outside the static web root, and are only available to the authenticated account through the API.
- Documents are limited to 10 MB and checked for supported extension and file signature/basic readability. Screening reports persist alongside the existing document records. No AI/OCR or issuer verification service is connected; see Admin document review for the exact limitations and human-review workflow.
- The readiness score and route-fit percentages are indicative rules-based estimates, not admission, employment, or visa decisions.
- The assistant currently uses profile-aware rules and static guidance; no external AI provider is connected.
- The Applications workspace adds an explainable next-best-action planner using profile completion, route-specific document review states, applicant-entered provider requirements, and deadlines. Its planning-readiness percentage is a progress indicator—not an eligibility decision. Enter requirements and dates from official provider instructions; there is no live external AI or provider-requirements feed.
- The CV Builder extends the existing authenticated profile with structured education, skills, projects, experience, languages, and other sections. Its templates, preview, completeness checks, writing suggestions, and ATS keyword comparison run locally in the browser; they do not call an AI service or invent qualifications. The generated CV uses the existing `cv` document slot and private document-download route. Saving over an existing CV file requires confirmation. “Download PDF” opens the browser print dialog; choose “Save as PDF.” These checks and exports are conveniences, not official eligibility or hiring decisions.
- A counsellor handoff is saved in the database when consent is present. No email or WhatsApp message is sent to Educaro.
- Opportunity links point to official public search resources; there is no live listings integration.
