import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { RunlitDatabase } from "./database.js";
import { resolveWorkBuddyDataDirectory, scanWorkBuddySessions } from "./workbuddy-local-store.js";

test("discovers a portable WorkBuddy data directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-workbuddy-discovery-"));
  try {
    mkdirSync(join(directory, "projects"));
    assert.equal(resolveWorkBuddyDataDirectory({ RUNLIT_WORKBUDDY_DATA_DIR: directory }, join(directory, "unused")), directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("imports one completed WorkBuddy interaction as one version", () => {
  const directory = mkdtempSync(join(tmpdir(), "runlit-workbuddy-adapter-"));
  const workspace = join(directory, "workspace");
  const sessionId = "workbuddy-session";
  const requestId = "request-1";
  const projectDirectory = join(directory, "projects", "workspace");
  const output = join(workspace, "result.md");
  const memory = join(workspace, ".workbuddy-ai", "memory", "today.md");
  mkdirSync(projectDirectory, { recursive: true });
  mkdirSync(join(directory, "artifact-index"), { recursive: true });
  mkdirSync(join(directory, "changes-index"), { recursive: true });
  mkdirSync(join(workspace, ".workbuddy-ai", "memory"), { recursive: true });
  writeFileSync(output, "# Result", "utf8");
  writeFileSync(memory, "internal", "utf8");
  const records = [
    { id: "prompt-1", timestamp: 1788752600000, type: "message", role: "user", sessionId, cwd: workspace },
    { timestamp: 1788752601000, type: "ai-title", aiTitle: "生成测试报告", sessionId, cwd: workspace },
    { id: "call-1", timestamp: 1788752602000, type: "function_call", name: "Write", sessionId, cwd: workspace, providerData: { conversationRequestId: requestId } },
    { id: "result-1", timestamp: 1788752603000, type: "function_call_result", name: "Write", status: "completed", sessionId, cwd: workspace, providerData: { conversationRequestId: requestId } },
    { id: "answer-1", timestamp: 1788752604000, type: "message", role: "assistant", status: "completed", sessionId, cwd: workspace, message: { usage: {} }, providerData: { conversationRequestId: requestId, rawUsage: {} } },
  ];
  writeFileSync(join(projectDirectory, `${sessionId}.jsonl`), records.map((item) => JSON.stringify(item)).join("\n"), "utf8");
  writeFileSync(join(directory, "artifact-index", `${sessionId}.json`), JSON.stringify({ artifacts: [
    { name: "result.md", uri: pathToFileURL(output).href, _meta: { requestId } },
    { name: "today.md", uri: pathToFileURL(memory).href, _meta: { requestId } },
  ] }), "utf8");
  writeFileSync(join(directory, "changes-index", `${sessionId}.json`), JSON.stringify({ changes: [{ requestId, files: [
    { filePath: output }, { filePath: memory },
  ] }] }), "utf8");

  const database = new RunlitDatabase(":memory:");
  try {
    const first = scanWorkBuddySessions(directory, database, { now: new Date("2026-09-07T04:00:10.000Z"), lookbackHours: 48 });
    const second = scanWorkBuddySessions(directory, database, { now: new Date("2026-09-07T04:00:15.000Z"), lookbackHours: 48 });
    const task = database.snapshot().tasks[0];
    assert.equal(first.sessionsRead, 1);
    assert.equal(first.tasksResolved, 1);
    assert.equal(second.observationsAdded, 0);
    assert.equal(task?.provider, "workbuddy");
    assert.equal(task?.title, "生成测试报告");
    assert.equal(task?.projectPath, workspace);
    assert.equal(task?.status, "completed");
    assert.equal(task?.versions.length, 1);
    assert.equal(task?.versions[0]?.artifacts.length, 1);
    assert.equal(task?.versions[0]?.artifacts[0]?.target, output);

    appendFileSync(join(projectDirectory, `${sessionId}.jsonl`), `\n${[
      { id: "prompt-2", timestamp: 1788752700000, type: "message", role: "user", sessionId, cwd: workspace },
      { id: "call-2", timestamp: 1788752701000, type: "function_call", name: "Read", sessionId, cwd: workspace, providerData: { conversationRequestId: "request-2" } },
    ].map((item) => JSON.stringify(item)).join("\n")}`, "utf8");
    scanWorkBuddySessions(directory, database, { now: new Date("2026-09-07T04:05:05.000Z"), lookbackHours: 48 });
    assert.equal(database.snapshot().tasks[0]?.status, "running");
    assert.equal(database.snapshot().tasks[0]?.versions.length, 1, "a new interaction without output does not create a version");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
