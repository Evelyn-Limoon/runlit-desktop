# Runlit

User guides: [简体中文](docs/user-guide.zh-CN.md) | [English](docs/user-guide.en.md)

Runlit is a local-first desktop observer for AI tasks. Its built-in adapters
currently observe Codex and WorkBuddy AI; other tools that write local results
can use artifact-folder monitoring. Selecting a task reveals its evidence-backed
version history and local artifacts.

This repository contains a runnable Windows application foundation:

- a Tauri 2 + React desktop shell;
- a localhost-only Node.js daemon with SQLite persistence and WebSocket updates;
- a shared provider/task/version/artifact event protocol;
- a normal mode that starts empty until it receives real task events;
- an explicit, isolated Demo mode for UI development;
- a read-only Codex adapter that combines App Server history with local
  `task_started` / `task_complete` / `turn_aborted` lifecycle events, without
  storing chat bodies;
- a read-only WorkBuddy adapter that correlates local session, change, and
  artifact indexes without storing chat bodies;
- an adapter manager and extensible provider protocol so new providers do not
  require changes to task qualification, version, or UI logic;
- portable source launch plus MSI/NSIS installers that bundle the daemon runtime;
- a Windows taskbar icon plus a system-tray menu for opening AI tool settings,
  refreshing, and fully exiting both the desktop window and its local daemon;
- a Windows GitHub Actions test and packaging workflow;
- unit tests for protocol validation, qualification, adapter import, and event persistence.

## Install RunLit on Windows

Open the [GitHub Releases page](https://github.com/Evelyn-Limoon/runlit-desktop/releases)
and select `v0.1.0-preview.1`. Download either the x64 MSI or the Setup executable.
The installed application includes its own Node.js runtime, bundled daemon, and
Node.js license; end users do not need Node.js, npm, or Rust. Starting the installed
`Runlit` application automatically starts the localhost daemon and stores data in
the current user's application-data directory.

`v0.1.0-preview.1` is an unsigned development preview. Windows may display an
unknown-publisher or Microsoft Defender SmartScreen warning. Only download RunLit
from this repository's Releases page, and compare the downloaded file with the
published `SHA256SUMS.txt` before installing:

```powershell
Get-FileHash -Algorithm SHA256 .\Runlit_0.1.0_x64-setup.exe
```

Code signing remains a requirement before a public production launch. Automatic
updates are not included in this preview; install a newer release manually.

## Start from source on Windows

From a cloned repository, double-click `RunLit.cmd`, or run:

```powershell
npm run start:runlit
```

The launcher resolves every path relative to the repository. It does not contain
user-specific drive or profile paths. On the first run it builds missing outputs;
that requires Node.js 24+, npm, the Rust MSVC toolchain, and WebView2.

Codex discovery is portable as well: RunLit checks `RUNLIT_CODEX_PATH`, then the
user's `PATH`, then the versioned Codex Desktop installation under
`%LOCALAPPDATA%\OpenAI\Codex\bin`. It never stores a username or a Codex build
hash in source code. If Codex is installed later, the adapter retries discovery;
`GET /adapters` reports the selected executable and discovery source.

Create a desktop shortcut pointing to this checkout with:

```powershell
npm run shortcut:install
```

The generated `.lnk` is necessarily local to Windows, while the installer script
is portable and committed to the repository. GitHub CI tests a clean checkout,
smoke-tests the daemon entrypoint, and builds native Windows bundle artifacts via
`.github/workflows/windows-build.yml`.

The packaging build bundles the daemon into one CommonJS file and copies the
build machine's Node.js runtime into Tauri resources. The Node.js license is also
included. GitHub Actions uses Node.js 24, so release output does not depend on a
developer's globally installed runtime after installation.

While RunLit is running, its branded icon is visible in the Windows taskbar and
notification area. Left-click the notification-area icon to bring RunLit to the
front; right-click it for **Open RunLit**, **AI Tool Connections**, **Refresh**,
and **Exit RunLit**. The exit action also stops the local daemon. The floating
orb exposes the same AI-tool settings, refresh, and exit actions in its own
right-click menu. WebView browser context menus are disabled, so browser-only
sharing and developer entries are not shown.

Right-click an individual task light and choose **Delete task** to remove it from
the dock. This is a recoverable visibility action: RunLit keeps the task's local
versions, artifacts, and evidence. A new running event from the same provider
session restores the task with its existing history; metadata-only rediscovery
does not restore it. Starting a separate AI conversation creates a separate task.

## Run locally

Prerequisites: Node.js 24+. Rust is only required for the native Tauri window.

```powershell
npm install
npm run dev
```

Open `http://localhost:1420` for browser development. The daemon listens only on
`127.0.0.1:47831` and stores development data in `.runlit/runlit-v2.db`.

Normal mode never creates fake provider tasks. Its Codex adapter uses the official
local `codex app-server` interface when Codex is installed and reads explicit
lifecycle records from the matching local Codex session log. A thread enters the
task dock only after a completed Codex file-change item points to an artifact that
RunLit can verify inside that thread's workspace. Each completed turn with material
changes creates one version; multiple local artifacts from that turn link to their
common folder. A remote result URL is linked directly only when a trusted adapter
emits it as a strong artifact event; URLs mentioned in chat are not inferred as
results. Set `RUNLIT_CODEX_ADAPTER=0` to disable this adapter, or
`RUNLIT_CODEX_LOOKBACK_HOURS` to change the default 24-hour import window.

WorkBuddy is discovered from `RUNLIT_WORKBUDDY_DATA_DIR` or the current user's
portable `~/.workbuddy-ai` data directory. RunLit groups artifacts by WorkBuddy
request ID, excludes WorkBuddy's internal project memory, and creates at most one
RunLit version for one material interaction. If automatic discovery fails, open
**AI Tool Connections** and save the WorkBuddy data directory manually. This
setting is stored in RunLit's per-user application data, never in repository
source. Set `RUNLIT_WORKBUDDY_ADAPTER=0` to disable the adapter.

The adapter contract and extension rules are documented in
[`docs/adapter-development.md`](docs/adapter-development.md).

For an AI tool that writes results to a local folder but has no dedicated
adapter yet, open **AI Tool Connections → Add AI Tool**. Enter a display name
and choose a dedicated output folder; RunLit creates the internal provider ID.
It records a baseline on first connection, then groups files created or modified in one
write burst into one completed version after six quiet seconds. The connection
is restored on the next RunLit launch and can be removed without deleting task
history. This generic mode proves local outputs only; it does not claim to know
the provider's internal prompt or live execution state.

To run a separate demo database
with sample tasks, set `RUNLIT_MODE=demo` before starting the daemon. Demo data
is stored in `.runlit/runlit-demo-v2.db` and is never mixed with normal data.

For the native window, install the Rust MSVC toolchain and WebView2, then run:

```powershell
npm run tauri -- dev
```

## Event ingestion

Adapters send normalized events to `POST http://127.0.0.1:47831/events`. The UI
receives the resulting snapshot over an authenticated local WebSocket. An
external adapter must read the installation-scoped token from `auth-token` in
RunLit's data directory and send `Authorization: Bearer <token>`. Browser origins
other than RunLit's Tauri window and local development server are rejected. A
minimal event body is:

```json
{
  "type": "task.upsert",
  "occurredAt": "2026-09-04T01:00:00.000Z",
  "payload": {
    "id": "codex-session-123",
    "provider": "codex",
    "title": "Build a local report",
    "status": "running",
    "projectPath": "C:\\work\\report"
  }
}
```

Runlit does not infer fake completion percentages. If an adapter cannot prove an
end state, it must emit `unknown`.

## License

RunLit source code is available under the [MIT License](LICENSE). Provider names
and marks identify observed task sources and do not imply endorsement.
