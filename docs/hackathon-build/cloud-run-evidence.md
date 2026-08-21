# Belay Cloud Run Evidence

## 2026-08-20 fleet-intelligence deployment

- Implemented private `POST /v1/decompose-fleet-task` in the Genkit TypeScript service.
- Added a structured Gemini 3.6 Flash output contract for Claude Code, Codex, and Antigravity task assignment, dependency order, acceptance criteria, risk labels, and repository-relative lease paths.
- Added local and server-side validation that rejects invented agents, invented paths, unknown fields, secrets, raw-source fields, and oversized payloads.
- Verified the updated minimal deployment context locally: exactly 21 allowlisted files; no daemon/dashboard implementation, tests, docs, state, vaults, keys, databases, logs, or credentials.
- Local verification: workspace build passed, full regression passed 55/55, and the no-leak/security subset passed 20/20.
- Google Cloud project: `belay-505611`; region: `us-central1`; service: `belay-intelligence`.
- Ready revision: `belay-intelligence-00004-lnd`, serving 100% of traffic.
- Successful regional Cloud Build: `44ee6830-8e2b-4b0c-be2f-7ad20204a21d`.
- Authenticated manifest summary smoke: request `92e83e9f-1a9b-4aef-805f-05c529258c84`, model `gemini-3.6-flash`, risk `low`.
- Authenticated fleet decomposition smoke: request `6afbcd8c-1ec7-40ed-9508-d19077e2b570`, plan `c55524ed-2dda-44c0-8945-b99ff0233be2`, model `gemini-3.6-flash`, three structured tasks.
- Cloud Run emitted `gemini_fleet_plan_completed` with the matching request/plan IDs and task count at `2026-08-20T08:59:24.338729Z`.
- Service IAM grants `roles/run.invoker` only to the authenticated participant account; there is no `allUsers` or `allAuthenticatedUsers` binding. An unauthenticated fleet-endpoint POST returned HTTP `403`.
- Two intermediate ready revisions exposed a Vertex structured-output compatibility issue during smoke verification. The generation schema was reduced to Vertex's supported subset while the strict shared Zod contract retained post-generation slug, enum, bounds, DAG, agent, and path validation. Neither intermediate revision is receiving traffic.

Captured: 2026-08-15

## Successful private deployment

- Google Cloud project: `belay-505611`
- Region: `us-central1`
- Service: `belay-intelligence`
- Ready revision: `belay-intelligence-00001-4nr`
- Traffic: 100% to the ready revision
- Runtime identity: a dedicated, non-default service account scoped to this service (address
  omitted here; it is not the Compute Engine default identity)
- Builder identity: a separate dedicated build service account, distinct from the runtime identity
- Successful Cloud Build: `800d1d28-5597-4e89-9554-ed4d912ec7f8`
- Build log: available in the participant's Cloud Build console for the build ID above

> Service-account addresses and the numeric project ID are intentionally omitted from this public
> repository. They are identities rather than credentials, but publishing them serves no
> verification purpose and widens the targeting surface. The project ID, region, service, revision,
> and build ID above are sufficient to cross-reference the deployment.

## Minimal upload boundary

The deployment script generated and verified a temporary 19-file context before any gcloud request. It contained only:

- `Dockerfile`, root package manifests, and `tsconfig.base.json`
- `packages/cloud-service` package metadata, TypeScript config, and source
- `packages/contracts` package metadata, TypeScript config, and source
- `packages/daemon/package.json` and `packages/dashboard/package.json` solely for npm lockfile/workspace validation

No daemon source, dashboard source, tests, docs, repository state, `.tools`, environment files, vaults, identities, keys, databases, or logs were present. The temporary context was deleted after deployment; zero matching temporary directories remained.

## Gemini smoke proof

- Request ID: `582b5e2a-8f57-4d13-a314-289d9a07e5fa`
- Model: `gemini-3.6-flash`
- Risk label: `low`
- Generated at: `2026-08-15T14:41:20.386Z`
- Result: an authenticated structural-metadata request returned a labeled repository summary.

## Private-IAM proof

- Authenticated invocation succeeded.
- An unauthenticated POST to `/v1/summarize` returned HTTP `403`.
- The service IAM policy grants `roles/run.invoker` only to the authenticated participant account; it contains no `allUsers` or `allAuthenticatedUsers` binding.

## Local negative proof

`npm test -- cloud-egress` passed 8/8 tests after deployment. The suite verifies that raw source fields, unknown keys, private-key markers, connection strings, known canaries and encodings, oversized payloads, and unsafe audit values are rejected before network invocation, while local operation degrades safely when cloud intelligence is unavailable.

## Historical artifact inventory

Three pre-fix source archives (251,060 / 251,714 / 253,067 bytes) in the private Cloud Run
sources bucket contain the broader repository upload that predates the exact 19-file build
context. Their exact object paths are intentionally omitted from this public repository; the
bucket is private and returns HTTP 403 to unauthenticated requests. The paths are available to
judges on request, and the archives are scheduled for deletion.

Visible failed regional build records:

- `b454f9db-2848-4f6e-b77f-3f279f58a04c`
- `d1206c5c-45af-451a-906f-5758f5bafa56`

The inventory showed no images produced by the failed builds. No historical artifact was deleted during Item 10.
