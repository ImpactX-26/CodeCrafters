# Journova AI

Journova is a responsive applicant-journey web app with an Express API and a local SQLite database.

## Run locally

Requirements: Node.js 22.5 or newer.

```powershell
cd backend
npm.cmd ci
npm.cmd run dev
```

Open <http://localhost:3000>. The frontend files live in `frontend/`; the Express API, dependencies, and environment template live in `backend/`. For local development, the API serves the frontend files from that sibling folder. In PowerShell, use `npm.cmd` to avoid execution-policy errors when `npm` resolves to `npm.ps1`. Applicant pages now open directly into the dashboard. The API creates an isolated guest workspace when no valid applicant session cookie exists; applicant data and uploads remain in the server's SQLite database and upload directory, not solely in the browser. The HttpOnly session cookie lasts 14 days. Guest workspaces have no email-based account recovery, so delete workspace data in Settings before clearing site cookies if you want to remove it.

The `/login` and `/register` URLs remain compatible with existing links but redirect into the dashboard. Existing applicant authentication endpoints and sessions are retained for compatibility; the applicant login/register screen is no longer the entry flow. Admin access remains separate at `/admin`.

The earlier `file:///.../index.html` page cannot call the Express API. Use the HTTP address above.

## Deploy frontend and backend separately

The Vercel frontend proxies `/api/*` requests to Render. This keeps browser requests same-origin, so the existing secure session-cookie behavior continues to work; do not change the frontend API URLs to point directly at the Render domain.

1. Import this repository into Vercel and set the project Root Directory to `frontend`. It is a static site: leave the build command empty and use the default output directory. Deploy once to get the Vercel site origin; the API will not work until the Render service is configured.
2. Create the Render web service from this repository using the Blueprint file at `backend/render.yaml`. It builds and starts the service from `backend/`, runs the health check at `/api/health`, and mounts a persistent disk for SQLite data and uploads. The persistent disk requires a paid Render plan.
3. Set Render's `APP_ORIGIN` to the exact Vercel site origin, such as `https://your-project.vercel.app` (no trailing slash). Comma-separate additional exact Vercel origins if required. Configure optional server-only AI, SMTP, and admin environment variables in the Render dashboard; never put secrets in the frontend.
4. In `frontend/vercel.json`, replace `YOUR-RENDER-SERVICE` with the Render service hostname assigned to your deployed API, without adding a trailing slash. For example, use `https://journova-api.onrender.com` as the `destination` origin. Redeploy Vercel to activate the API proxy.

The Vercel rewrites include the existing applicant-page routes and `/admin`; static assets remain served directly by Vercel. The Render backend can also serve the same frontend files for local development. Keep `APP_ORIGIN` aligned with the public Vercel origin so the API accepts proxied browser requests.

## Admin document review

Open <http://localhost:3000/admin> for the separate review portal. In local development it uses a local-only admin preview session so you can inspect the review UI without configuring email. The local preview is available only from the development server, which binds to `127.0.0.1`.

For a real admin account:

1. Register the reviewer's account through the applicant site using a working SMTP configuration.
2. Add the reviewer's account email to `ADMIN_EMAILS` in the server environment. Separate multiple addresses with commas.
3. Restart the server and sign in at `/admin` using that email's one-time code.

Admins can open private uploaded files, inspect the stored screening report, approve a visual review, request a re-upload, flag a document for additional review, reject it, or record an issuer verification. Verification requires a reviewer note describing the official issuer channel or evidence used. Marking a document suspicious does not automatically reject the applicant. Applicant document screens refresh review decisions automatically while open; the admin queue refreshes while visible.

The upload report records file-signature/readability checks, profile and required-document completeness, and explicit unavailable checks. Plain-text labelled fields may be extracted from TXT files; this is not OCR. There is no AI provider, OCR engine, name matching, alteration detection, or official issuer lookup connected. Accordingly, new uploads remain `Needs human review`, authenticity confidence is not calculated, and the report never claims a file is genuine or fake. Visual approval alone does not establish authenticity or guarantee acceptance by an institution or authority. To verify a certificate, use the issuing organisation's official lookup channel when available or contact it using independently sourced official contact details. Documents remain private; admin APIs require an allowlisted admin session.

## Admin email sign-in

From `backend/`, copy `.env.example` to `.env`, then fill in the SMTP settings supplied by your email provider. Never commit `.env` or paste credentials into source code. Start the regular server with `npm start`; the admin portal sends an actual one-time code through SMTP. Without SMTP configuration the API returns an explicit configuration error instead of accepting a fake code.

Set `NODE_ENV=production`, `APP_ORIGIN`, HTTPS, and a persistent database/upload volume when deploying. The production server does not expose the local development session endpoint.

## Data and service boundaries

- SQLite stores user profiles, consent, applications, and handoff requests in `backend/data/journova.sqlite` during local development. Render uses the configured persistent disk at `/var/data/journova.sqlite`.
- Uploaded documents are stored under `backend/data/uploads/` locally and `/var/data/uploads/` on Render, outside the static web root, and are only available to the authenticated account through the API.
- Documents are limited to 10 MB and checked for supported extension and file signature/basic readability. Screening reports persist alongside the existing document records. No AI/OCR or issuer verification service is connected; see Admin document review for the exact limitations and human-review workflow.
- Qualification Check builds a read-only qualification profile from the existing journey profile, CV profile and document review records (`GET /api/qualification`). It shows linked profile fields, required-document gaps, reviewer status, local file checks, and labelled fields from TXT uploads. Differing extracted name/institution labels are only possible mismatches for the applicant to review; profile data is never changed automatically. PDFs and images are not OCR-processed, and text comparison is not identity or authenticity verification.
- The readiness score and route-fit percentages are indicative rules-based estimates, not admission, employment, or visa decisions.
- The AI Assistant sends the user's question and relevant saved profile details to the configured OpenAI-compatible provider after the user accepts the data-sharing notice. Set `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` on the server to enable it; the API key is never sent to the browser. Without provider configuration, assistant requests return an explicit setup error. AI answers can be inaccurate and are not legal or eligibility decisions; users should confirm current requirements with official sources.
- The Applications workspace adds an explainable next-best-action planner using profile completion, route-specific document review states, applicant-entered provider requirements, and deadlines. Its planning-readiness percentage is a progress indicator—not an eligibility decision. Enter requirements and dates from official provider instructions; there is no live external AI or provider-requirements feed.
- My Journey builds its existing roadmap from the saved onboarding answers, selected route, document upload/admin-review states, CV data, and application statuses. The timeline labels missing/re-requested items as actions, distinguishes pending review from completion, and gives up to three current priorities with links to the relevant workspace. If no target start date is saved, milestone dates use a clearly labelled planning estimate. This is an indicative personal checklist, not a live AI service, official requirements feed, proof of document authenticity, or immigration/admission/employment advice.
- The home dashboard and Opportunities page share a two-column Study / Job matching hub. It shows Germany-wide totals from the Federal Employment Agency Job Search API (regular vacancies and Ausbildung/dual-study vacancies) and the DAAD/HRK Higher Education Compass (degree programmes). Counts are fetched server-side, cached for 15 minutes, and display their last successful update; an unavailable source is shown as unavailable rather than replaced with a fabricated number.
- The Admin document-review portal also displays these Germany-wide counts and official search/guidance links. Its market-count endpoint is protected by the existing admin session, separate from applicant access.
- Personal match cards still show only open applications entered by the applicant, with an indicative match score (65% profile/qualification route fit and 35% application preparation), saved provider/company, optional location, and reasons based on the saved goal and readiness. National market totals are not personalized matches or a live catalogue of individual listings. The Study, Job and Ausbildung count cards link to the corresponding official DAAD/HRK, Federal Employment Agency and Make it in Germany search or guidance pages; those links are informational and do not populate or submit Journova applications. The score slider filters both columns and detail actions open an in-app modal. Location is optional for existing records and can be entered when adding an application. The UI does not invent programs, employers, or listings.
- The CV Generator stores multiple role-specific CVs in the account-owned `cvs` SQLite table. The user portal dashboard and CV workspace support create, edit, autosave, duplicate, delete, and DOCX download. Each CV has a live one-column preview, four templates, optional local photo, editable/reorderable/hidden sections, zoom and page controls, education, experience, projects, typed skills, certifications, awards, languages, volunteering, leadership, publications, and interests. CV API records and exports are restricted to the current account session.
- “Download PDF” uses the browser’s print dialog so the visible HTML preview is the print source; choose “Save as PDF.” DOCX downloads are generated on the server. ATS and job-description scores are deterministic keyword/completeness/readability estimates, not a real employer ATS or an AI hiring decision. Missing keywords are suggestions only; the app does not add them as user skills.
- AI summary and section-writing endpoints use an optional OpenAI-compatible API configured only on the server through `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`. The key is never sent to the browser. The user must opt in before the UI sends CV facts to that provider. AI drafts are shown for review and are not applied until the user chooses to use them. Without provider configuration, AI writing actions report that setup is required; grammar, résumé wording and achievements are not falsely presented as AI-generated.
- A counsellor handoff is saved in the database when consent is present. No email or WhatsApp message is sent to Educaro.
- The roadmap includes official guidance links, but there is no live opportunity listings integration.
