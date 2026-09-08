# Changelog

All notable changes to RunLit are documented here.

## [Unreleased]

## [0.1.0-preview.1] - 2026-09-08

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

> This public installer is an unsigned development preview. Windows may display
> an unknown-publisher or Microsoft Defender SmartScreen warning.
