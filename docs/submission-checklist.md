# Devpost handoff checklist

This is a local preparation inventory. Nothing in this file means the project has been submitted.

## Repository

- [x] Public repository: `https://github.com/codersguru-hub/AgentMesh`.
- [x] Create and review the initial project commit on `main`.
- [ ] Confirm `git status` contains no `.env`, `.vault`, identity, database, WAL, log, `.tools`, or cloud credential material.
- [ ] Confirm the repository license and copyright owner are correct.
- [ ] Tag the demo-tested revision and record its commit SHA in the submission draft.

## Required proof

- [x] Clean `npm ci` completed.
- [x] Workspace build passed.
- [x] Full suite passed: 36 tests across 10 files.
- [x] Integrated hero verifier passed.
- [x] Expanded canary/leak verifier passed.
- [x] Private Cloud Run/Gemini smoke evidence recorded.
- [x] Unauthenticated Cloud Run request returned 403.
- [x] Exact minimal cloud upload boundary documented.
- [x] Architecture source, editable SVG, and Devpost-compatible 1440×900 PNG export included.
- [x] Threat boundary, limitations, dependencies, and audit status disclosed.

## Screenshot inventory

- [x] `docs/screenshots/agentmesh-cockpit-approval.png` — hero approval intercept with requester, target, digest, policy reason, and local-degraded/cloud-optional posture.
- [x] `docs/screenshots/agentmesh-cockpit-fail-closed.png` — negative proof that an ambiguous execution becomes `indeterminate` rather than silently succeeding or retrying.
- [ ] Capture the Cloud Run service page showing the ready revision, region, private IAM posture, and runtime identity. Crop out account identifiers not needed for judging.
- [ ] Capture the successful Gemini smoke response showing request ID, model, risk label, and generated timestamp; do not show auth tokens or local gcloud configuration.

## Video

- [ ] Record using `docs/demo-script.md` in four minutes or less.
- [ ] Keep terminal and cockpit text readable at 1080p.
- [ ] Show measured results; do not claim a fixed 30k-token saving without a reproducible comparison.
- [ ] Do not display secret values, private keys, identity paths, bearer tokens, browser cookies, or Cloud SDK credential directories.
- [ ] Upload to the video host required by the hackathon and add the final URL to the Devpost draft.

## Google Cloud proof

- Project: `agentmesh-505611`
- Region: `us-central1`
- Private service: `agentmesh-intelligence`
- Ready revision: `agentmesh-intelligence-00001-4nr`
- Successful minimal-context build: `800d1d28-5597-4e89-9554-ed4d912ec7f8`
- Gemini smoke request: `582b5e2a-8f57-4d13-a314-289d9a07e5fa`
- Model: `gemini-3.6-flash`
- Full sanitized record: `docs/hackathon-build/cloud-run-evidence.md`

## Official Devpost requirements

Live submission requirements were fetched from Devpost on 2026-08-15 and reported complete for hackathon ID `30845` (`allthingsagentichackathon`). A video is required; a hosted website and ZIP upload are not required. The narrative must cover the problem, value proposition, features, technologies, data sources, findings, and learnings. The approximately four-minute demo must show the app and proof that its backend ran on Google Cloud.

| Field ID | Required answer/evidence | AgentMesh response |
| --- | --- | --- |
| `28083` | Submitter type | Confirm `Individuals`, `Team of individuals`, or `Organization`. |
| `28084` | Country of residence | Confirm at submission. |
| `28085` | Category | `Fortified Enterprise Fleet`. |
| `28086` | Organization name | Required by the form; use the truthful organization name or `N/A` for an individual if accepted. |
| `28087` | Start date (`MM-DD-YY`) | Confirm the truthful hackathon-period start date. Projects must be newly created during the submission period. |
| `28141` | Public/private code repository URL | Add after publishing; private repos must be shared with `testing@devpost.com` and `cloudhackathons@google.com`. |
| `28089` | Reproducible README instructions | `Yes`; commands are in the README. |
| `28088` | Hosted project URL | Optional. The local cockpit need not be public. |
| `28090` | Private testing instructions | Optional; derive from the README and hero verifier. |
| `28091` | Google SDKs (multi-select) | `Genkit`. The implementation uses the `@genkit-ai/google-genai` plugin, not the standalone `@google/genai` SDK. |
| `28142` | Google Cloud services (multi-select) | `Cloud Run`. |
| `28092` | Architecture upload | Required file; upload `docs/assets/agentmesh-architecture.png` (PNG/JPG/PDF/PPT/PPTX accepted, max 35 MiB). Do not send it as a text custom answer. |
| `28093`, `28101` | Startup Prize organization/email | Optional; complete only if eligible and opting in. |
| `28143` | Google AI models | `gemini-3.6-flash`, satisfying the Gemini 3.5-or-newer requirement. |
| `28106`, `28107` | Public content/social links | Optional bonus; content must state it was created for this hackathon, and social posts use `#AllThingsAgenticHackathon`. |

The required video URL and standard Devpost project description are also pending until `$prepare-submission`.

## Claims and limitations review

- [x] Position as a local agent control plane, not an autonomous orchestrator.
- [x] Say “secret-safe” or “zero-leak in verified interfaces and artifacts,” not protection from a malicious local administrator or memory debugger.
- [x] Describe the approval executor as a disposable local simulation; production SSH fleet execution is not implemented.
- [x] Describe Gemini output as advisory and cloud operation as optional.
- [x] Disclose Windows ACL reliance, `age` identity-file limitation, single-user/single-machine scope, and transitive npm advisories.
- [x] Disclose the three historical pre-fix source archives in the participant-owned GCP project until separately deleted.

## Assisted and pre-existing work disclosure

- Product scope, constraints, security/privacy boundary, architecture decisions, visual direction, cloud account ownership, billing authorization, and action approvals were provided by Ahmed Soliman.
- OpenAI Codex assisted with planning documents, implementation, tests, debugging, documentation, and verification throughout the hackathon workflow.
- Superdesign generated an initial cockpit canvas from an explicitly approved non-secret design-system upload; Codex implemented and refined the React UI.
- Gemini is a runtime feature used for privacy-filtered structural summaries; it did not receive the local repository or vault values.
- Open-source dependencies are listed in `docs/dependencies.md`; no third-party proprietary source is claimed.
- [ ] Ahmed must confirm whether any code predates the hackathon and add an exact disclosure before submission. The current notes do not establish a pre-existing-code inventory.

## Before `$prepare-submission`

- [ ] Review the two local screenshots and replace either if a stronger recording frame is available.
- [ ] Add the public repository and final video URLs.
- [ ] Confirm the assisted/pre-existing work statement.
- [ ] Decide whether to remove the exact historical GCP source archives in a separately approved cleanup.
- [x] Review the current official Devpost submission fields and record every requirement and field ID above.
