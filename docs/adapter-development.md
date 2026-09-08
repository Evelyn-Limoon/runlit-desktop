# RunLit adapter development

End-user connection and usage: [简体中文](user-guide.zh-CN.md) | [English](user-guide.en.md)

RunLit adapters observe an AI tool and emit normalized evidence. They do not
create UI elements, write directly to SQLite, or decide whether a session is a
qualified task. Those responsibilities remain in the RunLit core.

## Runtime contract

Implement `RunlitAdapter` from `apps/daemon/src/adapter.ts`:

```ts
interface RunlitAdapter {
  readonly status: AdapterStatus;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  refresh?(): Promise<void> | void;
  configure?(config: Record<string, unknown>): Promise<void> | void;
}
```

Register the adapter with `AdapterManager`. Use a stable lowercase provider
slug such as `vendor_tool`; the shared protocol accepts extension slugs without
a core schema release.

## Preferred evidence order

1. Public App Server, SDK, or documented local API.
2. Official lifecycle hooks.
3. Stable local session and artifact indexes.
4. Process and workspace file activity only as a lower-confidence fallback.

Never infer completion from silence or from a process merely existing. Do not
store chat bodies. Keep only session identity, title, workspace, lifecycle,
artifact paths or URLs, timestamps, and evidence strength.

## Event mapping

- session first seen: `session.discovered`
- material user interaction starts: `build.started`
- continuing execution: `session.activity`
- verified result: one `file.changed` or `artifact.detected` event per interaction
- explicit normal end: `session.ended` with `observedStatus: completed`
- explicit cancellation or failure: `session.ended` with the corresponding status

Use deterministic event IDs. One provider interaction/request ID must produce at
most one artifact event. Aggregate multiple local outputs to their common folder.
The core verifies that local outputs exist and remain inside the observed
workspace before a task enters the dock.

## Local API authorization

The localhost daemon is not an unauthenticated extension bus. On first startup it
creates a random 256-bit token in `auth-token` beside the RunLit database. External
adapter processes must read that per-user file and send the token as:

```text
Authorization: Bearer <token>
```

Use the same header for HTTP event ingestion and adapter-management requests. A
non-browser WebSocket client may pass the token as the `token` query parameter.
The token must never be committed, logged, placed in an artifact, or sent over
the network. `/health` intentionally exposes only a minimal readiness response
without authentication; task snapshots, diagnostics, mutations, and WebSocket
snapshots require an allowed RunLit UI origin or the token.

## Discovery and configuration

Do not hard-code usernames, drive letters, version hashes, or a developer's
installation directory. Discovery should try, in order:

1. a documented `RUNLIT_<PROVIDER>_...` environment override;
2. standard `PATH` or OS installation records;
3. current-user application-data locations;
4. executable process arguments when available;
5. a path explicitly saved through RunLit's AI Tool Connections screen.

An unavailable adapter must not prevent RunLit or another adapter from starting.
Expose its reason through `AdapterStatus.lastError`.

## End-user quick connection

The **Add AI Tool** action is the no-code fallback for tools that create local
files. It creates a persisted `folder_watch` adapter with a display name,
provider slug, and a specific output directory. The first scan records only a
baseline. Later file additions or modifications are grouped until the folder
has been quiet for six seconds, then emitted as one verified result: a single
file links directly to that file and multiple files link to their common folder.

This mode deliberately reports an artifact-backed completed task only. It does
not infer prompt submission or live execution from an always-running desktop
process. Build a dedicated adapter when accurate lifecycle events are required.
Custom folder connections can be removed from the settings card; removal stops
monitoring and deletes its per-user configuration while preserving existing
RunLit task history.

## Acceptance checklist

- task and terminal state arrive within 20 seconds;
- ordinary chat without a material result remains a candidate;
- one material interaction creates one version;
- one output opens that file and multiple outputs open their common folder;
- rescanning and restarting are idempotent;
- custom installation paths work without source changes;
- absence or upgrade of the provider degrades independently;
- tests use temporary data and never modify a user's real provider history.
