# AgentMesh Cloud Run Evidence

Captured: 2026-08-15

## Successful private deployment

- Google Cloud project: `agentmesh-505611`
- Region: `us-central1`
- Service: `agentmesh-intelligence`
- Ready revision: `agentmesh-intelligence-00001-4nr`
- Traffic: 100% to the ready revision
- Runtime identity: `[redacted-runtime-service-account]`
- Builder identity: `[redacted-builder-service-account]`
- Successful Cloud Build: `800d1d28-5597-4e89-9554-ed4d912ec7f8`
- Build log: https://console.cloud.google.com/cloud-build/builds;region=us-central1/800d1d28-5597-4e89-9554-ed4d912ec7f8?project=[redacted-project-number]

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

These pre-fix source archives contain the broader repository upload and remain pending separately approved deletion:

- `gs://[redacted-sources-bucket]/services/agentmesh-intelligence/1786794843.182772-6a2473f231c84e93a2257a0d8c044a56.zip` — 251,060 bytes
- `gs://[redacted-sources-bucket]/services/agentmesh-intelligence/1786796449.757093-d66cf06b8f2b4c95b64c3b96bc9ddf06.zip` — 251,714 bytes
- `gs://[redacted-sources-bucket]/services/agentmesh-intelligence/1786797202.07876-e9c17fffc7854a26856669fd8756c846.zip` — 253,067 bytes

Visible failed regional build records:

- `b454f9db-2848-4f6e-b77f-3f279f58a04c`
- `d1206c5c-45af-451a-906f-5758f5bafa56`

The inventory showed no images produced by the failed builds. No historical artifact was deleted during Item 10.
