import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunlitDatabase } from "./database.js";

test("persists normalized task, version, and artifact events", () => {
  const database = new RunlitDatabase(":memory:");
  const time = "2026-09-04T01:00:00.000Z";
  database.apply({ type: "task.upsert", occurredAt: time, payload: { id: "task", provider: "codex", title: "Build", status: "running" } });
  database.apply({ type: "version.upsert", occurredAt: time, payload: { id: "v0", taskId: "task", ordinal: 0, summary: "Initial", source: "prompt", createdAt: time } });
  database.apply({ type: "artifact.upsert", occurredAt: time, payload: { id: "a0", versionId: "v0", kind: "markdown", label: "Plan", target: "C:\\plan.md", confidence: "confirmed" } });
  const snapshot = database.snapshot();
  assert.equal(snapshot.tasks[0]?.versions[0]?.artifacts[0]?.label, "Plan");
  database.close();
});

test("normal mode starts empty and demo mode is explicitly seeded", () => {
  const normal = new RunlitDatabase(":memory:");
  assert.equal(normal.snapshot().tasks.length, 0);
  normal.close();

  const demo = new RunlitDatabase(":memory:", { mode: "demo" });
  assert.equal(demo.snapshot().tasks.length, 8);
  demo.close();
});

test("normal mode removes legacy demo and smoke records without touching a new database", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-db-"));
  const path = join(directory, "runlit-v2.db");
  try {
    const demo = new RunlitDatabase(path, { mode: "demo" });
    demo.apply({ type: "task.upsert", occurredAt: "2026-09-04T01:00:00.000Z", payload: { id: "native-smoke", provider: "codex", title: "Native smoke", status: "completed" } });
    demo.close();

    const normal = new RunlitDatabase(path);
    assert.equal(normal.taskCount(), 0);
    assert.equal((normal.db.prepare("SELECT COUNT(*) AS count FROM event_log").get() as { count: number }).count, 0);
    normal.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hides a task without deleting history and restores it on the next run", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-hidden-task-"));
  const databasePath = join(directory, "runlit-v2.db");
  const target = join(directory, "result.md");
  writeFileSync(target, "first result", "utf8");

  let database = new RunlitDatabase(databasePath);
  try {
    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-05T01:00:00.000Z",
      payload: {
        id: "restorable-file-v0",
        provider: "codex",
        providerSessionId: "restorable-session",
        kind: "file.changed",
        source: "app_server",
        strength: "strong",
        title: "可恢复任务",
        workspacePath: directory,
        target,
        artifactKind: "markdown",
      },
    });
    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-05T01:01:00.000Z",
      payload: {
        id: "restorable-completed-v0",
        provider: "codex",
        providerSessionId: "restorable-session",
        kind: "session.ended",
        source: "local_store",
        strength: "strong",
        workspacePath: directory,
        observedStatus: "completed",
      },
    });
    assert.equal(database.snapshot().tasks[0]?.versions.length, 1);
    assert.equal(database.hideTask("task:codex:restorable-session", "2026-09-05T01:02:00.000Z"), true);
    assert.equal(database.snapshot().tasks.length, 0);
    assert.equal(database.hiddenTaskCount(), 1);
    assert.equal(database.taskCount(), 1, "the preserved task remains in storage");
    database.close();

    database = new RunlitDatabase(databasePath);
    assert.equal(database.snapshot().tasks.length, 0, "hidden state survives a daemon restart");
    assert.equal((database.db.prepare("SELECT COUNT(*) AS count FROM versions").get() as { count: number }).count, 1);
    assert.equal((database.db.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as { count: number }).count, 1);

    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-05T01:03:00.000Z",
      payload: {
        id: "restorable-rediscovered",
        provider: "codex",
        providerSessionId: "restorable-session",
        kind: "session.discovered",
        source: "app_server",
        strength: "medium",
        workspacePath: directory,
      },
    });
    assert.equal(database.snapshot().tasks.length, 0, "metadata-only discovery does not restore a deleted light");

    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-05T01:04:00.000Z",
      payload: {
        id: "restorable-running-v1",
        provider: "codex",
        providerSessionId: "restorable-session",
        kind: "session.activity",
        source: "local_store",
        strength: "strong",
        workspacePath: directory,
        observedStatus: "running",
      },
    });
    const restored = database.snapshot().tasks[0];
    assert.equal(restored?.status, "running");
    assert.equal(restored?.versions.length, 1, "existing versions are retained when the task returns");
    assert.equal(restored?.versions[0]?.artifacts[0]?.target, target);
    assert.equal(database.hiddenTaskCount(), 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("admits a trusted material build while its first artifact is still pending", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-active-build-"));
  const database = new RunlitDatabase(":memory:");
  try {
    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-07T04:00:00.000Z",
      payload: {
        id: "workbuddy-active-start",
        provider: "workbuddy",
        providerSessionId: "active-session",
        kind: "build.started",
        source: "local_store",
        strength: "strong",
        title: "生成本地报告",
        workspacePath: directory,
        observedStatus: "running",
      },
    });
    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-07T04:00:00.001Z",
      payload: {
        id: "workbuddy-active-running",
        provider: "workbuddy",
        providerSessionId: "active-session",
        kind: "session.activity",
        source: "local_store",
        strength: "strong",
        title: "生成本地报告",
        workspacePath: directory,
        observedStatus: "running",
      },
    });
    assert.equal(database.snapshot().tasks[0]?.status, "running");
    assert.equal(database.snapshot().tasks[0]?.versions.length, 0);
    assert.equal(database.candidates()[0]?.reason, "已确认会话身份、工作对象和强构建活动；成果待生成");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps ordinary sessions out until a real local artifact qualifies and resolves them", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-evidence-"));
  const target = join(directory, "summary.md");
  writeFileSync(target, "verified output", "utf8");
  const database = new RunlitDatabase(":memory:");
  const time = "2026-09-04T01:00:00.000Z";
  try {
    database.apply({
      type: "observation.recorded",
      occurredAt: time,
      payload: {
        id: "session-1-prompt",
        provider: "codex",
        providerSessionId: "session-1",
        kind: "prompt.submitted",
        source: "app_server",
        strength: "medium",
        title: "生成总结文件",
        workspacePath: directory,
      },
    });
    assert.equal(database.taskCount(), 0);
    assert.deepEqual((database.candidates()[0] as { missingEvidence: string[] }).missingEvidence, ["构建行为", "已验证成果物"]);

    const artifactEvent = {
      type: "observation.recorded" as const,
      occurredAt: "2026-09-04T01:01:00.000Z",
      payload: {
        id: "session-1-file",
        provider: "codex" as const,
        providerSessionId: "session-1",
        kind: "file.changed" as const,
        source: "app_server" as const,
        strength: "strong" as const,
        workspacePath: directory,
        target,
        artifactKind: "markdown" as const,
        artifactLabel: "总结",
      },
    };
    const accepted = database.apply(artifactEvent);
    const duplicate = database.apply(artifactEvent);
    const candidate = database.candidates()[0] as { status: string; reason: string; resolvedTaskId: string };
    const evidence = database.artifactEvidence()[0] as { verificationStatus: string; sha256: string; sizeBytes: number };
    const snapshot = database.snapshot();

    assert.equal(accepted.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(database.observationCount(), 2);
    assert.equal(database.taskCount(), 1);
    assert.equal(candidate.status, "qualified");
    assert.equal(candidate.reason, "已确认会话身份、工作对象、构建行为和成果物");
    assert.match(candidate.resolvedTaskId, /^task:codex:/);
    assert.equal(evidence.verificationStatus, "verified");
    assert.equal(evidence.sha256.length, 64);
    assert.equal(evidence.sizeBytes, 15);
    assert.equal(snapshot.tasks[0]?.versions[0]?.artifacts[0]?.target, target);

    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-04T01:02:00.000Z",
      payload: {
        id: "session-1-ended",
        provider: "codex",
        providerSessionId: "session-1",
        kind: "session.ended",
        source: "app_server",
        strength: "strong",
        workspacePath: directory,
      },
    });
    assert.equal(database.snapshot().tasks[0]?.status, "completed");
    assert.equal((database.db.prepare("SELECT COUNT(*) AS count FROM state_transitions").get() as { count: number }).count, 2);

    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-04T01:00:30.000Z",
      payload: {
        id: "session-1-local-start",
        provider: "codex",
        providerSessionId: "session-1",
        kind: "session.activity",
        source: "local_store",
        strength: "strong",
        workspacePath: directory,
        observedStatus: "running",
      },
    });
    assert.equal(database.snapshot().tasks[0]?.status, "running", "explicit local lifecycle outranks a newer App Server history marker");

    database.apply({
      type: "observation.recorded",
      occurredAt: "2026-09-04T01:03:00.000Z",
      payload: {
        id: "session-1-local-complete",
        provider: "codex",
        providerSessionId: "session-1",
        kind: "session.ended",
        source: "local_store",
        strength: "strong",
        workspacePath: directory,
        observedStatus: "completed",
      },
    });
    assert.equal(database.snapshot().tasks[0]?.status, "completed");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps unverified remote artifacts as candidates", () => {
  const database = new RunlitDatabase(":memory:");
  database.apply({
    type: "observation.recorded",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: {
      id: "remote-result",
      provider: "codex",
      providerSessionId: "session-remote",
      kind: "artifact.detected",
      source: "manual",
      strength: "medium",
      title: "更新远程文档",
      target: "https://example.com/document/1",
      artifactKind: "url",
    },
  });
  assert.equal(database.taskCount(), 0);
  assert.equal((database.artifactEvidence()[0] as { verificationStatus: string }).verificationStatus, "pending");
  assert.equal((database.candidates()[0] as { reason: string }).reason, "远程 URL 尚未通过来源接口验证");
  database.close();
});

test("creates a directly linked version for a trusted remote result", () => {
  const database = new RunlitDatabase(":memory:");
  database.apply({
    type: "observation.recorded",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: {
      id: "trusted-remote-result",
      provider: "codex",
      providerSessionId: "session-remote-trusted",
      kind: "artifact.detected",
      source: "app_server",
      strength: "strong",
      title: "部署网页",
      workspacePath: "C:\\work\\site",
      target: "https://example.com/deployment/1",
      artifactKind: "url",
      artifactLabel: "部署结果",
    },
  });
  const task = database.snapshot().tasks[0];
  assert.equal(task?.versions.length, 1);
  assert.equal(task?.versions[0]?.artifacts[0]?.kind, "url");
  assert.equal(task?.versions[0]?.artifacts[0]?.target, "https://example.com/deployment/1");
  database.close();
});

test("rejects artifacts outside the declared workspace, including another drive", () => {
  const database = new RunlitDatabase(":memory:");
  database.apply({
    type: "observation.recorded",
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: {
      id: "outside-workspace",
      provider: "codex",
      providerSessionId: "session-outside",
      kind: "file.changed",
      source: "app_server",
      strength: "strong",
      workspacePath: "F:\\approved-workspace",
      target: "C:\\other-drive\\result.md",
      artifactKind: "markdown",
    },
  });
  assert.equal(database.taskCount(), 0);
  assert.equal((database.artifactEvidence()[0] as { verificationStatus: string }).verificationStatus, "rejected");
  assert.equal((database.candidates()[0] as { reason: string }).reason, "成果物不在已识别工作区内");
  database.close();
});

test("stores adapter checkpoints and ignores an unchanged cursor", () => {
  const database = new RunlitDatabase(":memory:");
  const event = {
    type: "adapter.checkpoint" as const,
    occurredAt: "2026-09-04T01:00:00.000Z",
    payload: { adapterId: "codex-local-v1", provider: "codex" as const, cursor: "event-42" },
  };
  assert.equal(database.apply(event).duplicate, false);
  assert.equal(database.apply(event).duplicate, true);
  assert.equal(database.checkpointCount(), 1);
  assert.equal((database.adapterCheckpoints()[0] as { cursor: string }).cursor, "event-42");
  database.close();
});
