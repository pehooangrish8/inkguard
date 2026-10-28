# InkGuard

InkGuard is a brand-governance MVP for checking content before publication. It compares drafts and supported uploads with a shared Brand Kit, explains potential issues, suggests corrections, and keeps review decisions with authorized human reviewers. The default review uses deterministic rules and does not require an external AI provider or AI API key.

## Product workflow

1. The workspace admin initializes the first account or an existing team member signs in. Later accounts must be created by an admin.
2. A reviewer or admin maintains the shared Brand Kit: guidelines, approved facts, terminology pairs, and asset descriptions.
3. A creator enters text or uploads a supported document/image and runs a review.
4. By default, the backend applies deterministic phrase, terminology, and approved-number checks without calling an external AI provider. Findings include evidence, severity, explanation, a supplied brand rule when relevant, and a suggested correction. An operator can optionally enable OpenRouter AI review.
5. A reviewer/admin records accept, edit, reject, or request-revision decisions. Team members can discuss a saved review, and a reviewer/admin can mark it approved or needing revision.
6. Authorized reviewers/admins can inspect saved-review history and aggregate issue/severity counts.

Sample/demo mode remains clearly labeled and does not send its sample draft to a review service.

## Implemented capabilities

- **Text governance:** deterministic checks for absolute/guarantee wording, avoided terms described in guidelines, and numbers not present in approved facts. Optional OpenRouter AI review adds contextual suggestions when configured.
- **Document/image input:** PDF text extraction, DOCX text extraction, TXT/Markdown, and PNG/JPEG image review; uploads are limited to 10 MB.
- **Visual/accessibility signals:** with default rules-only mode, uploaded images are not automatically analyzed; reviewers are prompted to inspect them, and missing alt text is reported as an accessibility reminder. Optional OpenRouter review can analyze images when configured with a compatible vision model.
- **Explainable findings:** evidence, category, severity, confidence, brand rule (when supplied), explanation, and proposed correction.
- **Human workflow:** creator, reviewer, and admin roles; review queue/history; comments; persistent finding decisions; approve/request-revision statuses.
- **Shared Brand Kit:** backend-persisted guidelines, approved facts, terminology, and descriptive asset references.
- **Insights:** saved review and finding totals, with issue category and severity breakdowns.
- **Human oversight:** browser-only phrase/terminology/number heuristics are also available. Neither browser nor backend rules verify factual truth or understand context.

## Round 2 requirement match

| Requirement | Current product status |
| --- | --- |
| Functional product / demonstrable MVP | **Implemented:** review, findings, decisions, shared Brand Kit, comments, roles, history, and basic insights. |
| Public/judge-accessible source | **Source is in this project.** Publish the repository or provide judge access for submission. |
| Deployed link, package, or clear demo | **Not yet deployed.** Use the local demo instructions below until a hosted deployment is configured and tested. |
| Architecture and technical decisions | **Documented below.** |
| APIs, models, libraries, datasets, and external services | **Documented below.** No external training/evaluation dataset is bundled. |
| User testing / structured feedback | **Not included in this repository.** Add only feedback actually collected. |
| Team member contributions | **Not included in this repository.** Add each member's actual contribution to the submission. |
| Approved material and explainable findings | **Implemented for shared text rules/facts and descriptive asset references.** Uploaded images can be visually reviewed, but reference assets are not uploaded or automatically compared pixel-for-pixel. |
| Collaboration / role-based review | **Implemented for one shared local workspace** with creator/reviewer/admin permissions, comments, decisions, and status changes. Not multi-organization isolation. |
| Multiple formats | **Implemented with limits:** text, PDF text, DOCX text, TXT/Markdown, PNG/JPEG. Scanned PDFs have no OCR; embedded DOCX images are not extracted. |
| Visual consistency and accessibility | **Basic MVP signals only:** human image review by default and a missing-alt-text reminder; optional AI image feedback when enabled. This is not a comprehensive visual or WCAG audit. |
| Recurring-problem insights | **Basic aggregate counts** by category/severity across saved findings; no statistical trend analysis or guideline-clarity detection. |
| Confidentiality/security | **Prototype safeguards:** password hashes, signed sessions, role checks, restricted CORS, and backend-only optional AI credentials. No password reset, rate limiting, managed identity, retention policy, or production security review. Draft text is stored in SQLite; it is sent to OpenRouter only when the operator explicitly enables AI mode. Uploaded source files themselves are not retained. |

This table describes capabilities implemented in this codebase. It does not replace the Round 1 evidence/plan submission or Round 2 deployment, user-testing, and contribution evidence.

## Architecture

- **Frontend:** React, TypeScript, Vite, Wouter, and Lucide icons in `frontend/inkguard/artifacts/inkguard`.
- **Backend:** Python, FastAPI, Pydantic, and SQLModel in `backend`.
- **Review engine:** deterministic Python checks are the default and require no AI account or external service. Optional OpenRouter chat completions use Python's standard HTTP client when `INKGUARD_AI_MODE=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` are configured. Select a model that supports the needed text/image and JSON response features.
- **Persistence:** SQLite stores account hashes, shared Brand Kit, extracted draft text, findings, decisions, and comments. The default file is `inkguard.db` in the working directory; set `INKGUARD_DATABASE_PATH` to an absolute path on a persistent mounted volume when hosting.
- **Uploads:** `pypdf` extracts PDF text; DOCX paragraphs are extracted with Python's standard ZIP/XML libraries. In rules mode, image binaries are not sent to an AI service; a human reviewer must inspect images. In optional OpenRouter mode, supported images are sent as base64 data URLs. Uploaded binary files are not retained in the database.
- **Authentication:** PBKDF2-HMAC-SHA256 password hashes and HMAC-signed 12-hour bearer tokens, using `INKGUARD_SECRET_KEY`. Public workspace registration is disabled after the first admin is created; admins create accounts with assigned roles.
- **Backend REST API:** FastAPI provides authentication, Brand Kit, review/upload, findings decisions, comments, status, history, and insights endpoints. This is InkGuard's own application service, not an external AI API. Frontend API base defaults to `http://localhost:8000`.

The MVP uses one shared workspace: all signed-in accounts can see its saved reviews and Brand Kit. Do not use confidential content without organizational approval. Default rule-based review does not send content to an AI provider, but saved reviews are still sent to the InkGuard backend and stored in its configured database. If OpenRouter mode is enabled, review the provider's current data-use terms before use.

## Round 2 release checklist

- Publish the completed, integrated source to the team's existing GitHub repository and make the final branch judge-accessible.
- Deploy the frontend and backend, configure the production frontend origin in `INKGUARD_CORS_ORIGINS`, and set a strong `INKGUARD_SECRET_KEY` on the backend.
- Configure persistent storage for `inkguard.db` before using hosted accounts or saving reviews. The default SQLite file is local to the backend process and may not survive redeployments without persistent storage.
- Verify first-admin registration, login, a rules-based review without AI credentials, file uploads, comments, reviewer decisions, approval/revision, and retained data after a backend restart.
- Add the actual deployed URL, genuine user-testing feedback (if collected), and each team member's actual contribution to the submission materials.
- Keep secrets and local `.env`, `.venv`, `node_modules`, and database files out of Git.

## Run locally on Windows

Use two **Command Prompt** windows. Keep the environment variables set in the terminal running the backend.

### 1. Start the backend

```cmd
cd /d D:\inkguard-main
py -m pip install -r backend\requirements.txt
set "INKGUARD_AI_MODE=rules"
set "INKGUARD_SECRET_KEY=REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
set "INKGUARD_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173"
py -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Generate a secret rather than using the example value:

```cmd
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the output into `INKGUARD_SECRET_KEY`. API documentation is at `http://127.0.0.1:8000/docs`. Register the first account to create the workspace admin. The default rules mode needs no AI key. To opt in to OpenRouter, set these backend variables before starting the server:

```cmd
set "INKGUARD_AI_MODE=openrouter"
set "OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY"
set "OPENROUTER_MODEL=YOUR_MODEL_SLUG"
```

Choose a model available to your OpenRouter account that supports the review's JSON response format and, if needed, images. Keep the key out of frontend settings and source control. On a hosting service, set these as backend service variables; leave `INKGUARD_AI_MODE=rules` for provider-free operation.

### 2. Start the frontend

```cmd
cd /d D:\inkguard-main\frontend\inkguard
pnpm install --filter "@workspace/inkguard..."
cd artifacts\inkguard
set "PORT=5173"
set "BASE_PATH=/"
set "VITE_API_BASE_URL=http://127.0.0.1:8000"
pnpm dev
```

Open `http://localhost:5173`. Initialize the first account; it becomes the workspace admin. The admin can create creator, reviewer, and admin accounts from **Team**. Passwords must be at least 12 characters.

## Limitations

- This is a local demo, not a production-ready multi-tenant service. There is no organization isolation, password reset, rate limiting, audit export, or data retention/deletion policy.
- Default checks are deterministic heuristics, not AI or factual verification; they can miss contextual issues. Optional AI findings can also be wrong or incomplete. Human approval remains required.
- PDF review extracts selectable text only. Image-only/scanned PDFs are not OCR'd.
- DOCX image relationships/embedded images are not reviewed.
- Asset entries in the Brand Kit are descriptions, not binary approved logo files; no pixel-level logo comparison is performed.
- Image accessibility review is limited to an alt-text reminder and model suggestions; it is not a WCAG conformance test.
- Insights are descriptive counts and do not infer guideline ambiguity or prove recurring organizational causes.
- The project does not include collected user research, user-testing results, a deployed link, or contributor statements. Add genuine submission evidence separately.
