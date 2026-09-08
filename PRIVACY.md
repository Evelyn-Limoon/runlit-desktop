# RunLit privacy policy

Last updated: 2026-09-08

RunLit is a local-first desktop observer for AI tasks. This policy describes the
data handled by the RunLit application distributed from this repository.

## Data RunLit processes

RunLit may process the following information on the computer where it is
installed:

- AI provider and local session identifiers;
- task title and verified lifecycle state;
- local workspace and artifact paths;
- trusted result URLs supplied by an adapter;
- timestamps, evidence strength, settings, and diagnostic logs.

RunLit does not intentionally store AI chat bodies, browser cookies, passwords,
provider access tokens, or the contents of result files.

## Local storage and network behavior

Installed application data is stored under:

```text
%LOCALAPPDATA%\com.runlit.desktop
```

RunLit binds its local service to `127.0.0.1`. The built-in application has no
analytics, advertising, telemetry upload, or RunLit cloud account.

**This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating
it.** Examples of a user-requested network action include opening a trusted web
result or visiting the GitHub release and support pages. The AI tools observed by
RunLit have their own network behavior and privacy policies; RunLit does not
control those services.

## Release infrastructure

GitHub Actions processes public source code and generated build artifacts to
test and package releases. For signed releases, SignPath.io may process unsigned
release artifacts solely to apply and verify the SignPath Foundation code-signing
certificate. Runtime task data from users is not part of this release pipeline.

## Retention and deletion

RunLit retains local observation data until the user removes it. Hiding a task
light does not erase its history. To erase RunLit data completely, exit RunLit,
optionally back up the directory above, and delete that directory. Uninstalling
the application may preserve it so that an upgrade does not silently destroy
user history.

## Reports and questions

Use [GitHub Issues](https://github.com/Evelyn-Limoon/runlit-desktop/issues) for
ordinary privacy questions. Use the private channel described in
[`SECURITY.md`](SECURITY.md) for a suspected security vulnerability. Never post
tokens, chat content, complete logs, user names, session identifiers, or private
workspace paths in a public issue.
