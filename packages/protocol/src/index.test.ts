import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVersionTitle, parseRunlitEvent, VERSION_TITLE_MAX_UNITS, versionTitleUnits } from "./index.js";

test("accepts an evidence-backed task event", () => {
  const event = parseRunlitEvent({
    type: "task.upsert",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: { id: "task-1", provider: "codex", title: "Test task", status: "unknown" },
  });
  assert.equal(event.type, "task.upsert");
  if (event.type !== "task.upsert") throw new Error("Expected task event");
  assert.equal(event.payload.id, "task-1");
});

test("rejects unsupported or invented status values", () => {
  assert.throws(() =>
    parseRunlitEvent({
      type: "task.upsert",
      occurredAt: "2026-09-04T01:00:00.000Z",
      payload: { id: "task-1", provider: "codex", title: "Test task", status: "67_percent" },
    }),
  );
});

test("accepts built-in and extension provider slugs", () => {
  for (const provider of ["claude_code", "codex", "cursor", "gemini_cli", "github_copilot", "opencode", "windsurf", "workbuddy", "generic_cli", "future_ai"]) {
    assert.doesNotThrow(() => parseRunlitEvent({
      type: "task.upsert",
      occurredAt: "2026-09-04T01:00:00.000Z",
      payload: { id: `task-${provider}`, provider, title: "Test task", status: "unknown" },
    }));
  }
});

test("rejects unsafe provider identifiers", () => {
  assert.throws(() => parseRunlitEvent({
    type: "task.upsert",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: { id: "task-unsafe", provider: "../unsafe", title: "Test task", status: "unknown" },
  }));
});

test("accepts an observation without treating it as a task", () => {
  const event = parseRunlitEvent({
    type: "observation.recorded",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: {
      id: "codex-session-1-file-1",
      provider: "codex",
      providerSessionId: "session-1",
      kind: "file.changed",
      source: "app_server",
      strength: "strong",
      workspacePath: "C:\\work\\report",
      target: "C:\\work\\report\\report.md",
    },
  });
  assert.equal(event.type, "observation.recorded");
});

test("accepts an observed lifecycle status", () => {
  const event = parseRunlitEvent({
    type: "observation.recorded",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: {
      id: "codex-session-1-turn-1-ended",
      provider: "codex",
      providerSessionId: "session-1",
      kind: "session.ended",
      source: "app_server",
      strength: "strong",
      observedStatus: "interrupted",
    },
  });
  assert.equal(event.type, "observation.recorded");
});

test("accepts an adapter checkpoint for idempotent resume", () => {
  const event = parseRunlitEvent({
    type: "adapter.checkpoint",
    occurredAt: "2026-09-04T01:02:00.000Z",
    payload: { adapterId: "codex-local-v1", provider: "codex", cursor: "event-42" },
  });
  assert.equal(event.type, "adapter.checkpoint");
  if (event.type !== "adapter.checkpoint") throw new Error("Expected checkpoint event");
  assert.equal(event.payload.cursor, "event-42");
});

test("limits mixed-language version titles by visual width", () => {
  assert.equal(VERSION_TITLE_MAX_UNITS, 80);
  assert.equal(versionTitleUnits("A".repeat(80)), 80);
  assert.equal(versionTitleUnits("版本".repeat(20)), 80);
  assert.equal(normalizeVersionTitle("  调整 RunLit 版本标题  "), "调整 RunLit 版本标题");
  assert.throws(() => normalizeVersionTitle("版".repeat(41)), /最多 40 个中文字符/);
  assert.throws(() => normalizeVersionTitle("   "), /不能为空/);
});
