# Contributing to RunLit

Thank you for helping improve RunLit.

## Before opening a change

- Search existing issues and pull requests first.
- Keep each change focused on one user-visible behavior, adapter rule, or build
  concern.
- Do not add private task data, provider chat content, access tokens, local
  database files, or generated Windows bundle output to commits.
- Preserve the local-first boundary: adapters may observe and normalize
  evidence, but must not infer unverified completion or copy chat bodies.

## Local checks

Run these commands from the repository root before opening a pull request:

```powershell
npm ci
npm test
npm run build
```

Native Windows packaging additionally requires the Rust MSVC toolchain and
WebView2. Use `npm run tauri -- build` when your change affects the Tauri shell,
installer, or bundled daemon.

## Pull requests

Explain the user impact, tests run, and any platform assumptions. Include a
short screenshot only when a visual change cannot be understood from the code or
tests. Do not upload screenshots containing real task contents.

By contributing, you agree that your contribution is licensed under the
repository's `LICENSE`.
