# RunLit

[简体中文](README.zh-CN.md) · [User guide](docs/user-guide.en.md) · [Releases](https://github.com/Evelyn-Limoon/runlit-desktop/releases)

**A small window into the work your AI tools have already done.**

RunLit is a local desktop app that watches supported AI tools and gives you one place to find active work, meaningful changes, and the files they produced. A floating task dock stays out of the way until you need it. Select a task to see its status and versions, then open the actual result.

RunLit observes existing work. It does not send prompts, start AI tasks, or control the tools it watches.

> **Public preview:** Windows x64 and Linux x64. Windows installers are currently unsigned. There is no automatic updater or cloud sync.

## What you can do

- **Find work across tools.** Codex and WorkBuddy AI have built-in connections. You can also watch a dedicated output folder for another file-producing tool.
- **See state with evidence.** RunLit shows running, completed, interrupted, or unknown when the source provides enough information. Finding an installed AI app alone does not create a task.
- **Follow material versions.** A version represents a user interaction that changed a result, rather than every temporary save or tool call. You can rename a version without losing the automatic history.
- **Open the result.** Open a file, its containing folder, the project directory, or a trusted result URL from the task view.
- **Understand missing tasks.** The connection page shows scan reasons and can save a diagnostic JSON report for troubleshooting.

## How RunLit decides what to show

| Connection | Evidence RunLit uses | Limit |
| --- | --- | --- |
| Codex | Local session and workspace, completed turns, lifecycle records, and existing result files | A shell command may write a file without a direct file-change record. A file found in that command's time window is marked **possible**, because timing cannot prove who wrote it. |
| WorkBuddy AI | Local session, change, and artifact records | Availability depends on the local data format and access to its data directory. |
| Output folder | Files created or modified after you connect a specific folder | Shows artifacts only; it cannot prove which tool or prompt produced them. |

Chat-only conversations, an installed executable, and unverified mentions of files or URLs do not become task lights. RunLit keeps uncertain evidence visible as uncertain instead of presenting it as a confirmed result.

## Get started

1. Download the package for your system from the [RunLit Releases page](https://github.com/Evelyn-Limoon/runlit-desktop/releases). Use the checksum file from the same release to verify the download.
2. Start RunLit and open **AI Tool Connections** from the floating orb or notification-area menu.
3. Check the Codex or WorkBuddy connection. For another tool, choose **Add AI Tool** and select a dedicated folder where that tool saves its results.
4. Make a real local change with the AI tool. RunLit normally scans built-in connections about every five seconds; the current acceptance target is detection within 20 seconds.
5. Select the task light to inspect its versions and open the result.

If Codex is connected but a project or result does not appear, check the scan counts in **AI Tool Connections** and choose **Save diagnostic report**. The report contains adapter state and counts, without local paths, session IDs, tokens, or chat bodies. Review it before sharing.

For detailed controls and troubleshooting, see the [English guide](docs/user-guide.en.md) or [Chinese guide](docs/user-guide.zh-CN.md).

## Local data and privacy

RunLit listens on `127.0.0.1`. Its installed-app database and settings stay in the current user's application data directory. It stores the identifiers, state, workspace paths, timestamps, evidence, and artifact references needed to navigate work. It does not store provider chat bodies, browser cookies, passwords, or provider login tokens.

The RunLit daemon protects local API access with a trusted app origin or installation-scoped token. The app has no RunLit account, analytics, or background upload of task data. Read the [privacy policy](PRIVACY.md) and [security policy](SECURITY.md) for details.

## Preview boundaries

- Supported release platforms: Windows x64 and Linux x64. macOS and ARM64 are not yet supported.
- The Windows preview is unsigned and may show an unknown-publisher warning. Verify the installer against its release checksum before installing.
- Only Codex and WorkBuddy AI have built-in task adapters. Other tools can use output-folder monitoring when they create local files.
- Provider data formats can change. The connection status and diagnostic report help distinguish discovery from successful task detection.
- Cloud sync and automatic application updates are not included.

## Develop from source

You need Node.js 24+, npm, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```powershell
npm ci
npm test
npm run build
npm run start:runlit
```

On Linux, use `npm run start:runlit:linux`. The installed packages include their own Node.js runtime; end users do not need these build tools. See the [adapter guide](docs/adapter-development.md), [contributing guide](CONTRIBUTING.md), and [release process](docs/release-process.md).

RunLit is available under the [MIT License](LICENSE). Provider names and marks identify observed sources and do not imply sponsorship or endorsement.
