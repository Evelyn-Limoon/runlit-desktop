# Security policy

## Supported versions

Security fixes are applied to the latest published RunLit release. The current
development line is `0.1.x`.

## Reporting a vulnerability

Please use this repository's **Private vulnerability reporting** feature to
report suspected security issues. Do not open a public issue for a vulnerability
until the maintainers have confirmed that a fix or mitigation is available.

Include the affected version, Windows version, clear reproduction steps, impact,
and any relevant non-sensitive logs. Do not attach private task data, access
tokens, or personal information.

The project will acknowledge the report, assess its impact, and coordinate a
fix before public disclosure when practical.

## Local trust boundary

RunLit binds its daemon to `127.0.0.1`. The public `/health` route returns only
readiness metadata. Task snapshots, diagnostics, WebSocket snapshots, event
ingestion, and configuration mutations require either an approved RunLit UI
origin or the installation-scoped bearer token stored in the current user's
RunLit data directory.

Do not share or commit `auth-token`. A process already running as the same Windows
user may be able to read that user's application data; RunLit does not claim to
protect against a fully compromised local account.
