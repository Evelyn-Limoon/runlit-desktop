# Changelog

All notable changes to RunLit are documented here.

## [Unreleased]

## [0.1.0-preview.2] - 2026-09-08

### Added

- Rename meaningful version summaries from an inline pencil control.
- Preserve manually assigned version titles across daemon restarts and later adapter synchronization.
- Resize the task detail window vertically to reveal the latest three versions and task metadata.

### Changed

- Version-title validation now uses a shared Chinese/English-aware limit of approximately 40 Chinese or 80 English characters.
- The root test workflow rebuilds the shared protocol package before daemon and desktop tests, preventing stale runtime exports.

### Verification

- 51 TypeScript tests, 3 Rust tests, production build, isolated persistence replay, and Windows installer upgrade passed.

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
