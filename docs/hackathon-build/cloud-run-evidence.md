# AgentMesh Cloud Run Evidence

Captured: 2026-08-15

## Successful private deployment

- Google Cloud project: `agentmesh-505611`
- Region: `us-central1`
- Service: `agentmesh-intelligence`
- Ready revision: `agentmesh-intelligence-00001-4nr`
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
