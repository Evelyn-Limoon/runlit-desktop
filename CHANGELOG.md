# Changelog

All notable changes to RunLit are documented here.

## [0.1.0] - Unreleased

### Added

- Windows Tauri desktop shell with a local-only Node.js daemon.
- Evidence-backed task, version, and artifact observation.
- Read-only Codex and WorkBuddy adapters.
- User-configurable artifact-folder monitoring for additional local AI tools.
- Adapter health summaries, editable connections, and latest-first version history.
- Windows MSI and NSIS installer packaging.
- English and Simplified Chinese user guides.

### Security

- The daemon listens only on `127.0.0.1`.
- Sensitive local HTTP and WebSocket routes require a trusted RunLit origin or
  an installation-scoped bearer token.
- Provider chat bodies are not stored by the built-in adapters.

> The first public installer is a development preview until it is code-signed.
