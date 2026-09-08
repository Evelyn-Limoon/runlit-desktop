import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactKind, RunlitEvent } from "@runlit/protocol";
import type { AdapterStatus } from "./adapter.js";
import type { RunlitDatabase } from "./database.js";

type WorkBuddyRecord = {
  id?: string;
  timestamp?: number;
  type?: string;
  role?: string;
  status?: string;
  name?: string;
  sessionId?: string;
  cwd?: string;
  aiTitle?: string;
  message?: { usage?: unknown };
  providerData?: {
    conversationRequestId?: string;
    traceId?: string;
    rawUsage?: unknown;
    usage?: unknown;
  };
};

type IndexedArtifact = {
  name?: string;
  uri?: string;
  _meta?: { requestId?: string; "codebuddy.ai/requestId"?: string };
};

type ChangeIndex = {
  changes?: Array<{
    requestId?: string;
    files?: Array<{ filePath?: string }>;
  }>;
};

type Interaction = {
  id: string;
  requestId?: string;
  startedAt: number;
  lastAt: number;
  hasToolActivity: boolean;
  completedAt?: number;
};

export type WorkBuddyScanResult = {
  sessionsSeen: number;
  sessionsRead: number;
  observationsAdded: number;
  tasksResolved: number;
};

export type WorkBuddyAdapterStatus = AdapterStatus & {
  lastResult?: WorkBuddyScanResult;
};

function isDirectory(path: string) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

export function resolveWorkBuddyDataDirectory(env: NodeJS.ProcessEnv = process.env, userHome = homedir()) {
  const candidates = [env.RUNLIT_WORKBUDDY_DATA_DIR, join(userHome, ".workbuddy-ai")].filter(Boolean) as string[];
  return candidates.map((candidate) => resolve(candidate)).find((candidate) => isDirectory(join(candidate, "projects")));
}

function parseJsonFile<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return undefined; }
}

function parseJsonLines(path: string) {
  const records: WorkBuddyRecord[] = [];
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line) as WorkBuddyRecord); } catch { /* tolerate a partially-written final line */ }
    }
  } catch { /* a session may rotate while it is being read */ }
  return records;
}

function iso(timestamp: number | undefined, fallback = Date.now()) {
  return new Date(typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : fallback).toISOString();
}

function requestIdFrom(record: WorkBuddyRecord) {
  return record.providerData?.conversationRequestId ?? record.providerData?.traceId;
}

function interactionsFrom(records: WorkBuddyRecord[]) {
  const interactions: Interaction[] = [];
  let current: Interaction | undefined;
  for (const record of records) {
    const timestamp = record.timestamp ?? current?.lastAt ?? Date.now();
    if (record.type === "message" && record.role === "user") {
      current = {
        id: record.id ?? `prompt-${timestamp}`,
        startedAt: timestamp,
        lastAt: timestamp,
        hasToolActivity: false,
      };
      interactions.push(current);
      continue;
    }
    if (!current) continue;
    current.lastAt = Math.max(current.lastAt, timestamp);
    current.requestId ??= requestIdFrom(record);
    if (record.type === "function_call" || record.type === "function_call_result") current.hasToolActivity = true;
    const hasFinalUsage = Boolean(record.message?.usage || record.providerData?.rawUsage || record.providerData?.usage);
    if (record.type === "message" && record.role === "assistant" && record.status === "completed" && hasFinalUsage) {
      current.completedAt = timestamp;
    }
  }
  return interactions;
}

function sessionFiles(projectsDirectory: string, cutoff: number) {
  const files: string[] = [];
  for (const project of readdirSync(projectsDirectory, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDirectory = join(projectsDirectory, project.name);
    for (const entry of readdirSync(projectDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl") || entry.name.endsWith(".file-rollback.ndjson")) continue;
      const path = join(projectDirectory, entry.name);
      try { if (statSync(path).mtimeMs >= cutoff) files.push(path); } catch { /* ignore rotated files */ }
    }
  }
  return files;
}

function fromFileUri(uri: string | undefined) {
  if (!uri) return undefined;
  try { return uri.startsWith("file:") ? fileURLToPath(uri) : isAbsolute(uri) ? uri : undefined; }
  catch { return undefined; }
}

function isInternalArtifact(target: string, workspace?: string) {
  if (!workspace) return target.toLowerCase().includes(`${sep}.workbuddy-ai${sep}`.toLowerCase());
  const local = relative(resolve(workspace), resolve(target));
  return local === ".workbuddy-ai" || local.startsWith(`.workbuddy-ai${sep}`);
}

function indexedTargets(dataDirectory: string, sessionId: string, workspace?: string) {
  const byRequest = new Map<string, Array<{ target: string; label: string }>>();
  const add = (requestId: string | undefined, target: string | undefined, label?: string) => {
    if (!requestId || !target || isInternalArtifact(target, workspace) || !existsSync(target)) return;
    const items = byRequest.get(requestId) ?? [];
    if (!items.some((item) => resolve(item.target) === resolve(target))) items.push({ target: resolve(target), label: label ?? basename(target) });
    byRequest.set(requestId, items);
  };

  const artifactIndex = parseJsonFile<{ artifacts?: IndexedArtifact[] }>(join(dataDirectory, "artifact-index", `${sessionId}.json`));
  for (const artifact of artifactIndex?.artifacts ?? []) {
    add(artifact._meta?.requestId ?? artifact._meta?.["codebuddy.ai/requestId"], fromFileUri(artifact.uri), artifact.name);
  }

  const changes = parseJsonFile<ChangeIndex>(join(dataDirectory, "changes-index", `${sessionId}.json`));
  for (const change of changes?.changes ?? []) {
    for (const file of change.files ?? []) add(change.requestId, file.filePath);
  }
  return byRequest;
}

function artifactFor(targets: Array<{ target: string; label: string }>, workspace?: string) {
  if (targets.length === 1) {
    const single = targets[0]!;
    const extension = single.target.toLowerCase();
    const kind: ArtifactKind = extension.endsWith(".md") ? "markdown" : "file";
    return { target: single.target, label: single.label, kind };
  }
  const parents = new Set(targets.map((item) => dirname(item.target).toLowerCase()));
  const target = parents.size === 1 ? dirname(targets[0]!.target) : workspace ?? dirname(targets[0]!.target);
  return { target, label: `${targets.length} 个成果物 · ${basename(target)}`, kind: "directory" as const };
}

function hasMaterialIntent(title: string | undefined) {
  return Boolean(title && /(生成|输出|创建|制作|编写|修改|编辑|整理|导出|构建|build|create|write|edit|generate|export)/i.test(title));
}

function applyObservation(database: RunlitDatabase, event: RunlitEvent) {
  const result = database.apply(event);
  return { added: result.duplicate ? 0 : 1, resolvedTaskId: result.resolvedTaskId };
}

export function scanWorkBuddySessions(
  dataDirectory: string,
  database: RunlitDatabase,
  options: { now?: Date; lookbackHours?: number } = {},
): WorkBuddyScanResult {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - (options.lookbackHours ?? 24) * 60 * 60 * 1000;
  const files = sessionFiles(join(dataDirectory, "projects"), cutoff);
  const result: WorkBuddyScanResult = { sessionsSeen: files.length, sessionsRead: 0, observationsAdded: 0, tasksResolved: 0 };
  const resolvedTasks = new Set<string>();

  for (const file of files) {
    const records = parseJsonLines(file);
    if (records.length === 0) continue;
    result.sessionsRead += 1;
    const sessionId = records.find((record) => record.sessionId)?.sessionId ?? basename(file, ".jsonl");
    const workspace = records.find((record) => record.cwd)?.cwd;
    const title = [...records].reverse().find((record) => record.type === "ai-title" && record.aiTitle)?.aiTitle;
    const firstTimestamp = records[0]?.timestamp ?? statSync(file).birthtimeMs;
    const targetsByRequest = indexedTargets(dataDirectory, sessionId, workspace);
    const discovered = applyObservation(database, {
      type: "observation.recorded",
      occurredAt: iso(firstTimestamp),
      payload: {
        id: `workbuddy:${sessionId}:discovered`, provider: "workbuddy", providerSessionId: sessionId,
        providerInstanceId: `workbuddy:${dataDirectory}`, kind: "session.discovered", source: "local_store", strength: "strong",
        ...(title ? { title } : {}), ...(workspace ? { workspacePath: workspace } : {}),
      },
    });
    result.observationsAdded += discovered.added;
    if (discovered.resolvedTaskId) resolvedTasks.add(discovered.resolvedTaskId);

    for (const interaction of interactionsFrom(records)) {
      const interactionId = interaction.requestId ?? interaction.id;
      const targets = interaction.requestId ? targetsByRequest.get(interaction.requestId) ?? [] : [];
      const shouldTrackRunning = interaction.hasToolActivity
        && (targets.length > 0 || hasMaterialIntent(title) || database.hasTaskForSession("workbuddy", sessionId));
      if (shouldTrackRunning) {
        const started = applyObservation(database, {
          type: "observation.recorded",
          occurredAt: iso(interaction.startedAt),
          payload: {
            id: `workbuddy:${sessionId}:${interactionId}:started`, provider: "workbuddy", providerSessionId: sessionId,
            kind: "build.started", source: "local_store", strength: "strong",
            ...(title ? { title } : {}), ...(workspace ? { workspacePath: workspace } : {}), observedStatus: "running",
          },
        });
        result.observationsAdded += started.added;
        if (started.resolvedTaskId) resolvedTasks.add(started.resolvedTaskId);
        const activity = applyObservation(database, {
          type: "observation.recorded",
          occurredAt: iso(interaction.startedAt + 1),
          payload: {
            id: `workbuddy:${sessionId}:${interactionId}:activity`, provider: "workbuddy", providerSessionId: sessionId,
            kind: "session.activity", source: "local_store", strength: "strong",
            ...(title ? { title } : {}), ...(workspace ? { workspacePath: workspace } : {}), observedStatus: "running",
          },
        });
        result.observationsAdded += activity.added;
        if (activity.resolvedTaskId) resolvedTasks.add(activity.resolvedTaskId);
      }
      if (targets.length > 0) {
        const artifact = artifactFor(targets, workspace);
        const detected = applyObservation(database, {
          type: "observation.recorded",
          occurredAt: iso(Math.max(interaction.startedAt, ...targets.map((item) => {
            try { return statSync(item.target).mtimeMs; } catch { return interaction.lastAt; }
          }))),
          payload: {
            id: `workbuddy:${sessionId}:${interactionId}:artifact`, provider: "workbuddy", providerSessionId: sessionId,
            kind: "artifact.detected", source: "local_store", strength: "strong",
            ...(title ? { title } : {}), ...(workspace ? { workspacePath: workspace } : {}),
            target: artifact.target, artifactKind: artifact.kind, artifactLabel: artifact.label,
          },
        });
        result.observationsAdded += detected.added;
        if (detected.resolvedTaskId) resolvedTasks.add(detected.resolvedTaskId);
      }
      if (interaction.completedAt) {
        const ended = applyObservation(database, {
          type: "observation.recorded",
          occurredAt: iso(interaction.completedAt),
          payload: {
            id: `workbuddy:${sessionId}:${interactionId}:ended`, provider: "workbuddy", providerSessionId: sessionId,
            kind: "session.ended", source: "local_store", strength: "strong", observedStatus: "completed",
            ...(title ? { title } : {}), ...(workspace ? { workspacePath: workspace } : {}),
          },
        });
        result.observationsAdded += ended.added;
        if (ended.resolvedTaskId) resolvedTasks.add(ended.resolvedTaskId);
      }
    }
  }
  result.tasksResolved = resolvedTasks.size;
  return result;
}

export class WorkBuddyLocalStoreAdapter {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  readonly status: WorkBuddyAdapterStatus = {
    id: "workbuddy",
    provider: "workbuddy",
    displayName: "WorkBuddy AI",
    enabled: true,
    state: "starting",
    connectionMode: "local_store",
    detail: "读取本地会话、修改索引和成果物索引；不保存聊天正文",
  };

  constructor(
    private readonly database: RunlitDatabase,
    private readonly onChange: () => void,
    private readonly pollIntervalMs = Number(process.env.RUNLIT_WORKBUDDY_POLL_MS ?? 5000),
    private readonly lookbackHours = Number(process.env.RUNLIT_WORKBUDDY_LOOKBACK_HOURS ?? 24),
    private configuredDataPath?: string,
  ) {}

  async start() {
    this.stopped = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const dataDirectory = resolveWorkBuddyDataDirectory(
      this.configuredDataPath ? { ...process.env, RUNLIT_WORKBUDDY_DATA_DIR: this.configuredDataPath } : process.env,
    );
    if (!dataDirectory) {
      this.status.state = "unavailable";
      this.status.lastError = "未发现 WorkBuddy 本地数据目录";
      return;
    }
    this.status.dataPath = dataDirectory;
    await this.scan();
    if (!this.stopped) {
      this.timer = setInterval(() => void this.scan(), this.pollIntervalMs);
      this.timer.unref();
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh() {
    if (!this.status.dataPath) await this.start();
    else await this.scan();
  }

  async configure(config: Record<string, unknown>) {
    const dataPath = typeof config.dataPath === "string" ? config.dataPath.trim() : "";
    if (!dataPath || !isDirectory(join(resolve(dataPath), "projects"))) {
      throw new Error("所选目录不是有效的 WorkBuddy 数据目录（缺少 projects 文件夹）");
    }
    this.configuredDataPath = resolve(dataPath);
    this.status.dataPath = this.configuredDataPath;
    await this.start();
  }

  private async scan() {
    if (!this.status.dataPath) return;
    try {
      const result = scanWorkBuddySessions(this.status.dataPath, this.database, { lookbackHours: this.lookbackHours });
      this.status.state = "ready";
      this.status.lastScanAt = new Date().toISOString();
      this.status.lastResult = result;
      delete this.status.lastError;
      if (result.observationsAdded > 0) this.onChange();
    } catch (error) {
      this.status.state = "error";
      this.status.lastError = error instanceof Error ? error.message : "WorkBuddy 本地数据扫描失败";
    }
  }
}
