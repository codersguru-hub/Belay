# Screenshot evidence

- `agentmesh-cockpit-approval.png`: local 1440×960 capture of the pending human approval intercept. No secret value or browser session token is present.
- `agentmesh-cockpit-fail-closed.png`: local capture after the restricted Windows host denied the disposable child-process boundary. The audit records `indeterminate`, demonstrating that AgentMesh does not silently claim success or auto-retry an ambiguous mutation.

Cloud Console and Gemini response captures remain manual because they must be reviewed for account identifiers and credentials before inclusion. The exact non-image evidence is in `docs/hackathon-build/cloud-run-evidence.md`.
