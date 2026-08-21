# Screenshot evidence

- `belay-cockpit-approval.png`: live capture (2448×1406) of the pending human approval intercept, taken against the seeded VPS deployment through an SSH tunnel. Shows requester, target, digest, expiry, and policy reason for a real `demo-staging-reload` request. No secret value or browser session token is present.
- `belay-cockpit-fail-closed.png`: local capture after the restricted Windows host denied the disposable child-process boundary. The audit records `indeterminate`, demonstrating that Belay does not silently claim success or auto-retry an ambiguous mutation.

Cloud Console and Gemini response captures remain manual because they must be reviewed for account identifiers and credentials before inclusion. The exact non-image evidence is in `docs/hackathon-build/cloud-run-evidence.md`.
