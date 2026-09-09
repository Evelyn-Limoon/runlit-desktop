import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveCodexExecutable,
  scanCodexThreads,
  type CodexLifecycle,
  type CodexReadClient,
  type CodexThreadDetail,
} from "./codex-app-server.js";
import { RunlitDatabase } from "./database.js";

test("resolves Codex for portable Windows source launches", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-codex-resolution-"));
  try {
    const explicit = join(directory, "configured", "codex.exe");
    mkdirSync(join(directory, "configured"), { recursive: true });
    writeFileSync(explicit, "");
    assert.deepEqual(resolveCodexExecutable({
      env: { RUNLIT_CODEX_PATH: explicit, PATH: "" },
      platform: "win32",
      pathDelimiter: ";",
    }), { executable: explicit, source: "environment", shell: false });

    const pathDirectory = join(directory, "on-path");
    const pathExecutable = join(pathDirectory, "codex.exe");
    mkdirSync(pathDirectory);
    writeFileSync(pathExecutable, "");
    assert.deepEqual(resolveCodexExecutable({
      env: { PATH: pathDirectory },
      platform: "win32",
      pathDelimiter: ";",
    }), { executable: pathExecutable, source: "path", shell: false });

    const desktopRoot = join(directory, "OpenAI", "Codex", "bin");
    const oldExecutable = join(desktopRoot, "old-build", "codex.exe");
    const currentExecutable = join(desktopRoot, "current-build", "codex.exe");
    mkdirSync(join(desktopRoot, "old-build"), { recursive: true });
    mkdirSync(join(desktopRoot, "current-build"), { recursive: true });
    writeFileSync(oldExecutable, "");
    writeFileSync(currentExecutable, "");
    utimesSync(oldExecutable, new Date("2026-01-01"), new Date("2026-01-01"));
    utimesSync(currentExecutable, new Date("2026-09-04"), new Date("2026-09-04"));
    assert.deepEqual(resolveCodexExecutable({
      env: { PATH: "", LOCALAPPDATA: directory },
      platform: "win32",
      pathDelimiter: ";",
    }), { executable: currentExecutable, source: "codex_desktop", shell: false });

    rmSync(join(desktopRoot, "old-build"), { recursive: true, force: true });
    rmSync(join(desktopRoot, "current-build"), { recursive: true, force: true });
    const legacyExecutable = join(desktopRoot, "codex.exe");
    writeFileSync(legacyExecutable, "");
    assert.deepEqual(resolveCodexExecutable({
      env: { PATH: "", LOCALAPPDATA: directory },
      platform: "win32",
      pathDelimiter: ";",
    }), { executable: legacyExecutable, source: "codex_desktop", shell: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports Codex as unavailable instead of guessing when it is not installed", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-no-codex-"));
  try {
    assert.throws(() => resolveCodexExecutable({
      env: { PATH: "", LOCALAPPDATA: directory },
      platform: "win32",
      pathDelimiter: ";",
    }), /未找到 Codex CLI/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("qualifies a candidate when lifecycle advances but the App Server revision does not", async () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-codex-static-revision-"));
  const target = join(directory, "development-log.md");
  const updatedAt = Date.parse("2026-09-04T08:51:24.000Z") / 1000;
  const detail: CodexThreadDetail = {
    id: "static-revision",
    name: "编写项目开发复盘日志",
    cwd: directory,
    updatedAt,
    turns: [{ id: "turn-log", status: "inProgress", startedAt: updatedAt, items: [] }],
  };
  let lifecycle: CodexLifecycle = {
    turnId: "turn-log",
    status: "running",
    occurredAt: "2026-09-04T08:51:24.000Z",
  };
  const client: CodexReadClient = {
    async listThreads() { return { data: [detail], nextCursor: null }; },
    async readThread() { return detail; },
    readLifecycle() { return lifecycle; },
  };
  const database = new RunlitDatabase(":memory:");
  try {
    await scanCodexThreads(client, database, { now: new Date("2026-09-04T08:51:30.000Z") });
    assert.equal(database.snapshot().tasks.length, 0);
    assert.equal(database.candidates()[0]?.status, "candidate");

    writeFileSync(target, "completed development log", "utf8");
    detail.turns = [{
      id: "turn-log",
      status: "completed",
      startedAt: updatedAt,
      completedAt: updatedAt + 169,
      items: [{
        id: "change-log",
        type: "fileChange",
        status: "completed",
        changes: [{ path: target, kind: { type: "create" } }],
      }],
    }];
    lifecycle = {
      turnId: "turn-log",
      status: "completed",
      occurredAt: "2026-09-04T08:54:13.000Z",
    };

    const completed = await scanCodexThreads(client, database, { now: new Date("2026-09-04T08:54:15.000Z") });
    const task = database.snapshot().tasks[0];
    assert.equal(completed.tasksResolved, 1);
    assert.equal(task?.title, "编写项目开发复盘日志");
    assert.equal(task?.status, "completed");
    assert.equal(task?.versions.length, 1);
    assert.equal(task?.versions[0]?.artifacts[0]?.target, target);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creates one version per completed Codex turn and follows the latest turn lifecycle", async () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-codex-adapter-"));
  const target = join(directory, "result.md");
  const secondTarget = join(directory, "notes.txt");
  writeFileSync(target, "real Codex artifact", "utf8");
  writeFileSync(secondTarget, "second artifact in the same turn", "utf8");
  const updatedAt = Date.parse("2026-09-04T05:00:00.000Z") / 1000;
  const details: Record<string, CodexThreadDetail> = {
    build: {
      id: "build",
      name: "构建 RunLit",
      cwd: directory,
      updatedAt,
      turns: [{
        id: "turn-build",
        status: "completed",
        startedAt: updatedAt - 30,
        completedAt: updatedAt,
        items: [
          { id: "change-1", type: "fileChange", status: "completed", changes: [{ path: target, kind: { type: "update" } }] },
          { id: "change-2", type: "fileChange", status: "completed", changes: [{ path: secondTarget, kind: { type: "create" } }] },
        ],
      }],
    },
    chat: {
      id: "chat",
      name: "解释一个概念",
      cwd: directory,
      updatedAt,
      turns: [{ id: "turn-chat", status: "completed", items: [{ id: "message", type: "agentMessage", status: "completed" }] }],
    },
  };
  const lifecycles: Record<string, CodexLifecycle> = {
    build: { turnId: "turn-build", status: "completed", occurredAt: "2026-09-04T05:00:00.000Z" },
    chat: { turnId: "turn-chat", status: "completed", occurredAt: "2026-09-04T05:00:00.000Z" },
  };
  const client: CodexReadClient = {
    async listThreads() { return { data: Object.values(details), nextCursor: null }; },
    async readThread(threadId) { return details[threadId] as CodexThreadDetail; },
    readLifecycle(threadId) { return lifecycles[threadId]; },
  };
  const database = new RunlitDatabase(":memory:");
  try {
    const first = await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:01:00.000Z") });
    const second = await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:02:00.000Z") });
    const snapshot = database.snapshot();

    assert.deepEqual(first, { threadsSeen: 2, threadsRead: 2, observationsAdded: 5, tasksResolved: 1 });
    assert.deepEqual(second, { threadsSeen: 2, threadsRead: 1, observationsAdded: 0, tasksResolved: 0 });
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0]?.providerSessionId, "build");
    assert.equal(snapshot.tasks[0]?.status, "completed");
    assert.equal(snapshot.tasks[0]?.versions.length, 1);
    assert.equal(snapshot.tasks[0]?.versions[0]?.artifacts[0]?.kind, "directory");
    assert.equal(snapshot.tasks[0]?.versions[0]?.artifacts[0]?.target, directory);
    assert.equal(database.candidates().find((candidate) => candidate.providerSessionId === "chat")?.status, "candidate");

    details.build?.turns?.push({ id: "turn-running", status: "inProgress", startedAt: updatedAt + 60, items: [] });
    if (details.build) details.build.updatedAt = updatedAt + 60;
    lifecycles.build = { turnId: "turn-running", status: "running", occurredAt: "2026-09-04T05:01:00.000Z" };
    const running = await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:01:05.000Z") });
    assert.equal(running.observationsAdded, 2);
    assert.equal(database.snapshot().tasks[0]?.status, "running");
    assert.equal(database.snapshot().tasks[0]?.versions.length, 1);

    const activeTurn = details.build?.turns?.at(-1);
    if (activeTurn) {
      activeTurn.status = "completed";
      activeTurn.completedAt = updatedAt + 120;
    }
    if (details.build) details.build.updatedAt = updatedAt + 120;
    lifecycles.build = { turnId: "turn-running", status: "completed", occurredAt: "2026-09-04T05:02:00.000Z" };
    const completed = await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:02:20.000Z") });
    assert.equal(completed.observationsAdded, 2);
    assert.equal(database.snapshot().tasks[0]?.status, "completed");
    assert.equal(database.snapshot().tasks[0]?.versions.length, 1);

    if (activeTurn) {
      activeTurn.status = "interrupted";
      activeTurn.completedAt = undefined;
    }
    if (details.build) details.build.updatedAt = updatedAt + 180;
    lifecycles.build = { turnId: "turn-running", status: "running", occurredAt: "2026-09-04T05:03:00.000Z" };
    await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:03:05.000Z") });
    assert.equal(database.snapshot().tasks[0]?.status, "running", "task_started overrides a stale App Server turn marker");
    lifecycles.build = { turnId: "turn-running", status: "interrupted", occurredAt: "2026-09-04T05:03:10.000Z" };
    if (details.build) details.build.updatedAt = updatedAt + 190;
    await scanCodexThreads(client, database, { now: new Date("2026-09-04T05:03:20.000Z") });
    assert.equal(database.snapshot().tasks[0]?.status, "interrupted", "turn_aborted is recorded as an actual interruption");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
