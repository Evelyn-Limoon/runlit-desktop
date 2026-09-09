# RunLit agent guide

This file contains durable constraints that are not safe to infer from code alone; put design detail in `docs/`.

## Product contract

- RunLit is a local-first observer and result navigator for existing AI tools.
- It observes work; it does not launch, control, or impersonate an AI provider.
- A task enters the dock only when an adapter has verifiable work and result evidence.
- Never infer completion from an open process, ordinary chat, or elapsed silence.
- One version represents one user interaction that materially changed a result.
- Do not create a version for every filesystem write, tool call, or temporary save.
- A remote URL is a result only when a trusted adapter supplies strong evidence.
- Hiding a task must preserve its history and source artifacts; later activity may restore it.
- Built-in adapters are Codex and WorkBuddy AI; folder-watch connections are artifact-only.
- Normal automatic detection should satisfy the current 20-second acceptance target.

## Architecture

- `packages/protocol`: shared events, validation, and user-visible title limits.
- `apps/daemon`: adapters, evidence qualification, SQLite persistence, HTTP, and WebSocket.
- `apps/desktop`: React UI plus Tauri window, tray, file opening, and daemon lifecycle.
- `.github/workflows`: clean-runner build, security, packaging, and release evidence.

Keep provider parsing inside adapters; do not add provider conditions to shared UI or qualification rules without a protocol need.

## Sources of truth

- `README.md` and `README.zh-CN.md`: current public product scope and download entry.
- `docs/adapter-development.md`: adapter contract and extension boundary.
- `docs/user-guide.en.md` and `docs/user-guide.zh-CN.md`: user-visible behavior.
- `docs/release-process.md` and `docs/release-preflight.md`: release procedure and executable release gates.
- `SECURITY.md` and `PRIVACY.md`: security reporting and data-handling promises.
- Protocol schemas and tests define accepted event shapes; update docs with behavior changes.

When documents disagree, report the conflict and restore consistency with the current user-approved behavior.

## Setup and verification

Use Node.js 24+, npm, Rust stable, and the platform-specific Tauri prerequisites.

```text
npm ci && npm test && npm run build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

- Windows source entry: `npm run start:runlit`.
- Linux source entry: `npm run start:runlit:linux`.
- Native bundle: `npm run tauri -- build`.
- Windows builds must produce MSI and NSIS packages.
- Linux x64 builds must produce `.deb` and `.AppImage` packages.
- A package is not accepted until its bundled daemon starts and answers `/health`.
- Installer changes require a clean-runner install, launch, exit, and removal check.

## Data, privacy, and security invariants

- Bind the daemon only to `127.0.0.1`; never expose it on all network interfaces.
- Keep `/health` read-only; protect other HTTP and WebSocket access with a trusted RunLit origin or installation token.
- Do not store provider chat bodies, browser cookies, passwords, or provider login tokens.
- Persist only identifiers, state, workspace, timestamps, evidence, and artifact references.
- Validate local artifacts for existence and workspace boundaries before qualification.
- Treat provider records, filenames, URLs, logs, and adapter output as untrusted input.
- Never commit `.runlit`, SQLite files, `auth-token`, logs, build caches, or installed data.
- Never commit real usernames, absolute developer paths, session IDs, or conversation text.
- Database changes must be backward-compatible migrations that preserve installed user data.

## Cross-platform rules

- Keep shared application behavior platform-neutral; isolate OS behavior in Tauri or scripts.
- Never hard-code a user's home directory, drive letter, Codex version hash, or install path.
- Discover Codex through `RUNLIT_CODEX_PATH`, system `PATH`, and supported platform fallbacks.
- Windows uses bundled `node.exe`; Linux uses an executable bundled ELF `node` runtime.
- Linux tray support is optional; the orb must remain a complete entry without a StatusNotifier host.
- Current release targets are Windows x64 and Linux x64; do not claim macOS or ARM64 support.

## UI behavior

- Preserve the compact 52-by-52 orb and the existing yellow, black, and green visual system.
- The compact orb stays where the user drops it; only an expanded window snaps at an edge.
- Keep text and artifact controls keyboard accessible and usable in privacy mode.
- The named artifact control opens the artifact; the smaller folder control opens its folder.
- Do not add persistent success notices or large empty areas to the compact interface.

## Definition of done

- Test at the owning protocol, daemon, desktop, or Rust layer; report exact pass counts and skipped checks.
- For platform packaging, use the matching clean GitHub runner and test the produced package.
- Verify observable effects, not only configuration, compilation, or file existence.
- Update user guides, changelog, release notes, and known limitations when behavior changes.
- Preserve unrelated work in a dirty checkout; never reset or overwrite user changes.

## GitHub and release limits

- The public repository is `Evelyn-Limoon/runlit-desktop` under the MIT License.
- Use `vX.Y.Z-preview.N` for unsigned previews; stable Windows releases require valid signing.
- Publish SHA-256 files for Windows and Linux assets and verify them through public downloads.
- Never publish internal plans, local validation databases, credentials, or sanitized-out history.
- Do not claim a release is available until its public Release, assets, and hashes are verified.
- Provider names and marks identify observed sources; they do not imply sponsorship.
