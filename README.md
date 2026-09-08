# RunLit

[English](README.md) | [简体中文](README.zh-CN.md) | [Bilingual user manual / 中英双语用户手册](docs/RunLit-user-manual-bilingual.md)

**See what your AI tools are doing, and open the result in one click.**

RunLit is a local-first Windows and Linux desktop observer and result navigator for AI work. It turns verified AI work into a compact floating task dock, shows the task state and material versions, and links each version back to the actual file, folder, project, or trusted web result.

> Current release: **v0.1.0-preview.3 — Windows x64 and Linux x64 preview**
>
> RunLit observes existing AI tools. It does not launch, control, or impersonate them.

RunLit has selected the SignPath Foundation open-source program for future
Windows signatures. The application is not yet approved, so the current preview
remains unsigned. Free code signing provided by SignPath.io, certificate by
SignPath Foundation. See the [code signing policy](docs/code-signing-policy.md).

## What you can do

- **Watch multiple AI tools in one place.** Codex and WorkBuddy AI are built in; other tools that create local files can be connected through an output folder.
- **See meaningful task states.** RunLit displays running, completed, interrupted, or unknown only when the adapter has supporting evidence.
- **Keep useful version history.** One version represents one user interaction that materially changed a result—not every temporary filesystem write.
- **Name versions in your own words.** Edit any meaningful version title and keep that manual label across later automatic synchronization.
- **Open the real result.** Open a single artifact directly, open the common folder for multiple artifacts, or follow a trusted result URL.
- **Stay out of the way.** Drag the floating orb, click it to expand the task window, or use the notification-area menu when the desktop provides one.
- **Control visibility.** Hide a task light without deleting its source files or history. New activity from the same session can restore it.
- **Keep data local.** RunLit stores its observation database and settings on the current computer and does not store chat bodies.

## Supported connections

| AI tool | Connection | What RunLit can observe |
| --- | --- | --- |
| Codex | Automatically discovers Codex Desktop or CLI | Verified task lifecycle, workspace, material versions, and local artifacts |
| WorkBuddy AI | Automatically discovers local data; manual directory selection is available | Local session, change, and artifact evidence |
| Other file-producing AI tools | Add the tool and select a dedicated output folder | Created or modified artifacts, grouped into completed versions |
| Other tools requiring exact live status | Dedicated RunLit adapter | Depends on the adapter; not built in yet |

The provider status in **AI Tool Connections** is the source of truth. A logo alone does not mean that a provider is connected.

## Download and install

Download only from the official [RunLit Releases page](https://github.com/Evelyn-Limoon/runlit-desktop/releases/tag/v0.1.0-preview.3).

- **Windows x64:** [Setup executable](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/Runlit_0.1.0_x64-setup.exe), [MSI installer](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/Runlit_0.1.0_x64_en-US.msi), and [checksums](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/SHA256SUMS.txt).
- **Linux x64:** Debian/Ubuntu `.deb` and portable `.AppImage`, with [Linux checksums](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/SHA256SUMS-linux.txt). Use the exact filenames shown on the Release page.

The Windows preview is not code-signed, so Windows may show **Unknown publisher** or a Microsoft Defender SmartScreen warning. Verify the download before installing:

```powershell
Get-FileHash -Algorithm SHA256 .\Runlit_0.1.0_x64-setup.exe
```

Compare the result with `SHA256SUMS.txt`. The installed app includes its own daemon runtime; end users do not need Node.js, npm, or Rust.

## Quick start

1. Install and launch RunLit from the Windows Start menu or the Linux application launcher. AppImage users can mark the file executable and run it directly.
2. Right-click the RunLit orb or notification-area icon and open **AI Tool Connections**.
3. Confirm that Codex or WorkBuddy shows **Connected**. For another tool, choose **Add AI Tool**, enter a name, and select its dedicated output folder.
4. In the AI tool, perform work that creates or materially modifies a local result.
5. Wait for automatic detection. Built-in adapters scan about every five seconds; the current acceptance target is no more than 20 seconds.
6. Click the new task light to inspect its state and versions.
7. Click an artifact row to open that artifact. Use **Open folder** on the version card to open its containing or common result folder.

Chat-only conversations, merely opening an AI tool, and unverified file or URL mentions normally do not create a task light.

## Everyday controls

- **Left-click the orb:** expand or collapse RunLit.
- **Drag the orb:** move it on the desktop.
- **Drag the expanded window to a screen edge:** collapse it into the orb.
- **Right-click the orb or notification-area icon:** open connections, refresh, or exit RunLit completely.
- **Right-click a task light:** hide that task from the dock. Its RunLit history and source artifacts remain intact.
- **Pencil beside a version title:** rename that version; use up to about 40 Chinese or 80 English characters.
- **Bottom-center resize handle:** drag downward to reveal the newest three versions together with task metadata.
- **Eye button:** conceal task names and paths while sharing your screen.

## Local data and privacy

RunLit listens only on `127.0.0.1` and stores installed-app data under the platform user-data directory:

```text
Windows: %LOCALAPPDATA%\com.runlit.desktop
Linux:   ${XDG_DATA_HOME:-$HOME/.local/share}/com.runlit.desktop
```

Built-in adapters retain only the identifiers, state, workspace, timestamps, evidence, and artifact references needed for observation. They do not store chat bodies. External adapters must authenticate to the localhost service with RunLit's installation-scoped token.

## Preview limitations

- Windows x64 and Linux x64 only; macOS and ARM64 are not yet supported.
- The Windows installers are currently unsigned. Linux packages publish SHA-256 checksums but are not repository-signed.
- Linux notification-area availability depends on the desktop environment; the floating orb remains the primary entry when no compatible tray host exists.
- Codex and WorkBuddy AI are the only built-in adapters.
- Generic output-folder connections prove artifacts, not the provider's exact prompt or live lifecycle.
- Provider data-format changes may require adapter updates.
- No cloud synchronization and no automatic updater yet.

## Guides and support

- [Bilingual user manual / 中英双语用户手册](docs/RunLit-user-manual-bilingual.md)
- [Detailed English guide](docs/user-guide.en.md)
- [详细中文手册](docs/user-guide.zh-CN.md)
- [Report a functional problem](https://github.com/Evelyn-Limoon/runlit-desktop/issues)
- [Security policy](SECURITY.md)
- [Privacy policy](PRIVACY.md)
- [Code signing policy](docs/code-signing-policy.md)

Before posting logs publicly, remove user names, local paths, session IDs, tokens, and chat content.

## For developers

Prerequisites for source development are Node.js 24+, npm, Rust, and the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run start:runlit
```

On Linux, use `npm run start:runlit:linux` after installing the Tauri system dependencies.

- [Adapter development guide](docs/adapter-development.md)
- [Contributing guide](CONTRIBUTING.md)
- [Release process](docs/release-process.md)

RunLit is licensed under the [MIT License](LICENSE). Provider names and marks identify observed task sources and do not imply sponsorship, endorsement, or an official relationship.
