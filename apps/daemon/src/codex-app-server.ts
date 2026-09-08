import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import type { ArtifactKind, RunlitEvent, TaskStatus } from "@runlit/protocol";
import type { RunlitDatabase } from "./database.js";
import type { AdapterStatus } from "./adapter.js";

const ADAPTER_ID = "codex-app-server-v2";
const ALL_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];

type JsonRpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

export type CodexThreadSummary = {
  id: string;
  name?: string | null;
  cwd?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type CodexFileChange = {
  path?: string;
  kind?: { type?: string } | string;
};

type CodexItem = {
  id?: string;
  type?: string;
  status?: string;
  changes?: CodexFileChange[];
};

type CodexTurn = {
  id?: string;
  status?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  items?: CodexItem[];
};

export type CodexThreadDetail = CodexThreadSummary & { turns?: CodexTurn[] };

export interface CodexReadClient {
  listThreads(cursor?: string): Promise<{ data: CodexThreadSummary[]; nextCursor?: string | null }>;
  readThread(threadId: string): Promise<CodexThreadDetail>;
  readLifecycle?(threadId: string): CodexLifecycle | undefined;
}

export type CodexLifecycle = {
  turnId: string;
  status: TaskStatus;
  occurredAt: string;
};

export type CodexScanResult = {
  threadsSeen: number;
  threadsRead: number;
  observationsAdded: number;
  tasksResolved: number;
};

export type CodexAdapterStatus = AdapterStatus & {
  executablePath?: string;
  executableSource?: CodexExecutableSource;
  lastResult?: CodexScanResult;
};

export type CodexExecutableSource = "environment" | "path" | "codex_desktop";

export type CodexExecutableResolution = {
  executable: string;
  source: CodexExecutableSource;
  shell: boolean;
};

type ResolveCodexExecutableOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathDelimiter?: string;
};

function existingFile(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function executableNames(platform: NodeJS.Platform) {
  return platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
}

function resolveFromPath(pathValue: string | undefined, platform: NodeJS.Platform, pathDelimiter: string) {
  if (!pathValue) return undefined;
  for (const rawDirectory of pathValue.split(pathDelimiter)) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    for (const name of executableNames(platform)) {
      const candidate = join(directory, name);
      if (existingFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveFromCodexDesktop(localAppData: string | undefined) {
  if (!localAppData) return undefined;
  const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
  if (!existsSync(binRoot)) return undefined;

  const candidates: string[] = [];
  const directCandidate = join(binRoot, "codex.exe");
  if (existingFile(directCandidate)) candidates.push(directCandidate);
  try {
    for (const entry of readdirSync(binRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(binRoot, entry.name, "codex.exe");
      if (existingFile(candidate)) candidates.push(candidate);
    }
  } catch {
    return undefined;
  }

  return candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}

/** Resolve Codex without relying on the environment inherited by a desktop shortcut. */
export function resolveCodexExecutable(options: ResolveCodexExecutableOptions = {}): CodexExecutableResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathDelimiter = options.pathDelimiter ?? delimiter;
  const configured = env.RUNLIT_CODEX_PATH?.trim().replace(/^"|"$/g, "");

  if (configured) {
    const resolvedConfigured = existingFile(configured)
      ? resolve(configured)
      : resolveFromPath(configured, platform, pathDelimiter);
    if (!resolvedConfigured) {
      throw new Error(`RUNLIT_CODEX_PATH 指向的 Codex 程序不存在：${configured}`);
    }
    return {
      executable: resolvedConfigured,
      source: "environment",
      shell: /\.(?:cmd|bat)$/i.test(resolvedConfigured),
    };
  }

  const pathExecutable = resolveFromPath(env.PATH, platform, pathDelimiter);
  if (pathExecutable) {
    return {
      executable: pathExecutable,
      source: "path",
      shell: /\.(?:cmd|bat)$/i.test(pathExecutable),
    };
  }

  if (platform === "win32") {
    const desktopExecutable = resolveFromCodexDesktop(env.LOCALAPPDATA);
    if (desktopExecutable) {
      return { executable: desktopExecutable, source: "codex_desktop", shell: false };
    }
  }

  throw new Error(
    "未找到 Codex CLI。请安装 Codex，或用 RUNLIT_CODEX_PATH 指向 codex 可执行文件；RunLit 已检查 PATH 和 Codex 桌面版安装目录。",
  );
}

function eventTime(value?: number) {
  if (!value || !Number.isFinite(value)) return new Date().toISOString();
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString();
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function artifactKind(path: string): ArtifactKind {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".mdx") return "markdown";
  return "file";
}

function isInside(base: string, candidate: string) {
  const pathFromBase = relative(base, candidate);
  return pathFromBase === "" || (!pathFromBase.startsWith(`..${sep}`) && pathFromBase !== ".." && !isAbsolute(pathFromBase));
}

function aggregateLocalTargets(paths: string[], workspacePath: string) {
  const unique = [...new Set(paths.map((path) => resolve(path)).filter((path) => existsSync(path)))];
  if (unique.length === 0) return undefined;
  if (unique.length === 1) {
    const target = unique[0] as string;
    return { target, kind: artifactKind(target), label: basename(target), count: 1 };
  }

  const workspace = resolve(workspacePath);
  let common = dirname(unique[0] as string);
  while (!unique.every((target) => isInside(common, target))) {
    const parent = dirname(common);
    if (parent === common) break;
    common = parent;
  }
  if (!isInside(workspace, common)) common = workspace;
  return { target: common, kind: "directory" as const, label: `${unique.length} 个成果物 · ${basename(common)}`, count: unique.length };
}

function mapTurnStatus(status?: string): { kind: "session.activity" | "session.ended"; status: TaskStatus } | undefined {
  if (status === "inProgress") return { kind: "session.activity", status: "running" };
  if (status === "completed") return { kind: "session.ended", status: "completed" };
  if (status === "interrupted" || status === "failed") return { kind: "session.ended", status: "interrupted" };
  return undefined;
}

function parseLifecycleLine(line: string): CodexLifecycle | undefined {
  if (!line.includes('"type":"event_msg"')
    || !/("type":"task_started"|"type":"task_complete"|"type":"turn_aborted")/.test(line)) return undefined;
  try {
    const event = JSON.parse(line) as {
      timestamp?: string;
      payload?: { type?: string; turn_id?: string; started_at?: number; completed_at?: number };
    };
    const payload = event.payload;
    if (!event.timestamp || !payload?.turn_id) return undefined;
    if (payload.type === "task_started") return { turnId: payload.turn_id, status: "running", occurredAt: event.timestamp };
    if (payload.type === "task_complete") return { turnId: payload.turn_id, status: "completed", occurredAt: event.timestamp };
    if (payload.type === "turn_aborted") return { turnId: payload.turn_id, status: "interrupted", occurredAt: event.timestamp };
  } catch {
    return undefined;
  }
  return undefined;
}

type RolloutState = { path: string; offset: number; remainder: string; lifecycle?: CodexLifecycle };

class CodexRolloutLifecycleReader {
  private readonly states = new Map<string, RolloutState>();
  private readonly sessionsRoot = resolve(process.env.RUNLIT_CODEX_SESSIONS_DIR ?? join(homedir(), ".codex", "sessions"));

  read(threadId: string) {
    let state = this.states.get(threadId);
    if (!state) {
      const path = this.findRollout(threadId);
      if (!path) return undefined;
      const size = statSync(path).size;
      state = { path, offset: size, remainder: "", lifecycle: this.findLatestLifecycle(path, size) };
      this.states.set(threadId, state);
      return state.lifecycle;
    }

    const size = statSync(state.path).size;
    if (size < state.offset) {
      state.offset = size;
      state.remainder = "";
      state.lifecycle = this.findLatestLifecycle(state.path, size);
      return state.lifecycle;
    }
    if (size === state.offset) return state.lifecycle;

    const handle = openSync(state.path, "r");
    try {
      const buffer = Buffer.alloc(size - state.offset);
      readSync(handle, buffer, 0, buffer.length, state.offset);
      state.offset = size;
      const lines = `${state.remainder}${buffer.toString("utf8")}`.split(/\r?\n/);
      state.remainder = lines.pop() ?? "";
      for (const line of lines) state.lifecycle = parseLifecycleLine(line) ?? state.lifecycle;
    } finally {
      closeSync(handle);
    }
    return state.lifecycle;
  }

  private findRollout(threadId: string) {
    if (!existsSync(this.sessionsRoot)) return undefined;
    const relativePaths = readdirSync(this.sessionsRoot, { recursive: true, encoding: "utf8" });
    const relativePath = relativePaths.find((path) => path.endsWith(".jsonl") && basename(path).includes(threadId));
    return relativePath ? resolve(this.sessionsRoot, relativePath) : undefined;
  }

  private findLatestLifecycle(path: string, size: number) {
    const blockSize = 256 * 1024;
    const handle = openSync(path, "r");
    let position = size;
    let trailingFragment = "";
    try {
      while (position > 0) {
        const start = Math.max(0, position - blockSize);
        const buffer = Buffer.alloc(position - start);
        readSync(handle, buffer, 0, buffer.length, start);
        const lines = `${buffer.toString("utf8")}${trailingFragment}`.split(/\r?\n/);
        trailingFragment = start > 0 ? lines.shift() ?? "" : "";
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const lifecycle = parseLifecycleLine(lines[index] ?? "");
          if (lifecycle) return lifecycle;
        }
        position = start;
      }
      return parseLifecycleLine(trailingFragment);
    } finally {
      closeSync(handle);
    }
  }
}

function parseCheckpoint(value?: string) {
  if (!value) return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, number>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return {} as Record<string, number>;
  }
}

export async function scanCodexThreads(
  client: CodexReadClient,
  database: RunlitDatabase,
  options: { lookbackHours?: number; now?: Date } = {},
): Promise<CodexScanResult> {
  const lookbackHours = options.lookbackHours ?? 24;
  const scanNow = options.now ?? new Date();
  const cutoff = scanNow.getTime() - lookbackHours * 60 * 60 * 1000;
  const previous = parseCheckpoint(database.adapterCheckpoint(ADAPTER_ID)?.cursor);
  const revisions = { ...previous };
  const threads: CodexThreadSummary[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.listThreads(cursor);
    threads.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && threads.length < 1000);

  let threadsRead = 0;
  let observationsAdded = 0;
  const resolvedTasks = new Set<string>();

  for (const thread of threads) {
    const revision = thread.updatedAt ?? thread.createdAt ?? 0;
    const timestamp = eventTime(revision);
    const timestampMs = new Date(timestamp).getTime();
    if (!thread.cwd || !existsSync(thread.cwd) || timestampMs < cutoff) continue;
    const workspacePath = thread.cwd;
    const previousRevision = previous[thread.id];
    const isTrackedTask = database.hasTaskForSession("codex", thread.id);
    const revisionUnchanged = previousRevision !== undefined && previousRevision >= revision;

    const title = thread.name?.trim() || basename(thread.cwd) || "Codex 构建任务";
    const discovered: RunlitEvent = {
      type: "observation.recorded",
      occurredAt: timestamp,
      payload: {
        id: `codex:${thread.id}:discovered:${revision}`,
        provider: "codex",
        providerSessionId: thread.id,
        providerInstanceId: "codex-app-server",
        kind: "session.discovered",
        source: "app_server",
        strength: "medium",
        title,
        workspacePath: thread.cwd,
      },
    };
    if (!database.apply(discovered).duplicate) observationsAdded += 1;

    const loggedLifecycle = client.readLifecycle?.(thread.id);
    let lifecycleChanged = false;
    if (loggedLifecycle) {
      const lifecycleKind = loggedLifecycle.status === "running" ? "session.activity" as const : "session.ended" as const;
      const result = database.apply({
        type: "observation.recorded",
        occurredAt: loggedLifecycle.occurredAt,
        payload: {
          id: `codex:${thread.id}:lifecycle-v2:${loggedLifecycle.turnId}:${loggedLifecycle.status}:${shortHash(loggedLifecycle.occurredAt)}`,
          provider: "codex",
          providerSessionId: thread.id,
          providerInstanceId: "codex-local-store",
          kind: lifecycleKind,
          source: "local_store",
          strength: "strong",
          title,
          workspacePath,
          observedStatus: loggedLifecycle.status,
        },
      });
      lifecycleChanged = !result.duplicate;
      if (!result.duplicate) observationsAdded += 1;
      if (result.resolvedTaskId) resolvedTasks.add(result.resolvedTaskId);
    }

    // Codex Desktop can append lifecycle and FileChange records without changing
    // the App Server thread revision. A new lifecycle record must therefore
    // force one detail read; otherwise a running candidate can never qualify.
    if (revisionUnchanged && !isTrackedTask && !lifecycleChanged) continue;

    let detail: CodexThreadDetail;
    try {
      detail = await client.readThread(thread.id);
    } catch {
      continue;
    }
    threadsRead += 1;
    for (const turn of detail.turns ?? []) {
      if (!turn.id || turn.status !== "completed") continue;
      const targets = (turn.items ?? [])
        .filter((item) => item.type === "fileChange" && item.status === "completed")
        .flatMap((item) => item.changes ?? [])
        .flatMap((change) => change.path ? [isAbsolute(change.path) ? resolve(change.path) : resolve(workspacePath, change.path)] : []);
      const artifact = aggregateLocalTargets(targets, workspacePath);
      if (!artifact) continue;
      const observation: RunlitEvent = {
        type: "observation.recorded",
        occurredAt: eventTime(turn.completedAt ?? revision),
        payload: {
          id: `codex:${thread.id}:turn:${turn.id}:artifact:${shortHash(artifact.target)}`,
          provider: "codex",
          providerSessionId: thread.id,
          providerInstanceId: "codex-app-server",
          kind: "file.changed",
          source: "app_server",
          strength: "strong",
          title,
          workspacePath,
          target: artifact.target,
          artifactKind: artifact.kind,
          artifactLabel: artifact.label,
        },
      };
      const result = database.apply(observation);
      if (!result.duplicate) observationsAdded += 1;
      if (result.resolvedTaskId) resolvedTasks.add(result.resolvedTaskId);
    }

    const latestTurn = detail.turns?.at(-1);
    const lifecycle = loggedLifecycle ? undefined : mapTurnStatus(latestTurn?.status);
    if (latestTurn?.id && lifecycle) {
      const lifecycleTime = lifecycle.kind === "session.activity"
        ? eventTime(latestTurn.startedAt ?? revision)
        : eventTime(latestTurn.completedAt ?? revision);
      const result = database.apply({
        type: "observation.recorded",
        occurredAt: lifecycleTime,
        payload: {
          id: `codex:${thread.id}:lifecycle-v2:${latestTurn.id}:${lifecycle.status}:${shortHash(lifecycleTime)}`,
          provider: "codex",
          providerSessionId: thread.id,
          providerInstanceId: "codex-app-server",
          kind: lifecycle.kind,
          source: "app_server",
          strength: "strong",
          title,
          workspacePath: thread.cwd,
          observedStatus: lifecycle.status,
        },
      });
      if (!result.duplicate) observationsAdded += 1;
      if (result.resolvedTaskId) resolvedTasks.add(result.resolvedTaskId);
    }
    revisions[thread.id] = revision;
  }

  database.apply({
    type: "adapter.checkpoint",
    occurredAt: new Date().toISOString(),
    payload: { adapterId: ADAPTER_ID, provider: "codex", cursor: JSON.stringify(revisions) },
  });

  return { threadsSeen: threads.length, threadsRead, observationsAdded, tasksResolved: resolvedTasks.size };
}

class CodexStdioClient implements CodexReadClient {
  private process?: ChildProcessWithoutNullStreams;
  private lines?: ReadLineInterface;
  private nextId = 1;
  private readonly lifecycleReader = new CodexRolloutLifecycleReader();
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly resolution: CodexExecutableResolution) {}

  async connect() {
    if (this.process) return;
    const child = spawn(this.resolution.executable, ["app-server", "--stdio"], {
      windowsHide: true,
      shell: this.resolution.shell,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.onLine(line));
    child.stderr.resume();
    child.once("error", (error) => this.failAll(error));
    child.once("close", () => this.failAll(new Error("Codex App Server 已停止")));
    await this.request("initialize", {
      clientInfo: { name: "runlit", title: "RunLit", version: "0.1.0" },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  }

  async listThreads(cursor?: string) {
    const result = await this.request("thread/list", {
      limit: 100,
      ...(cursor ? { cursor } : {}),
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ALL_SOURCE_KINDS,
    }) as { data?: CodexThreadSummary[]; nextCursor?: string | null };
    return { data: result.data ?? [], nextCursor: result.nextCursor };
  }

  async readThread(threadId: string) {
    const result = await this.request("thread/read", { threadId, includeTurns: true }) as { thread?: CodexThreadDetail };
    if (!result.thread) throw new Error(`Codex thread/read 未返回线程 ${threadId}`);
    return result.thread;
  }

  readLifecycle(threadId: string) {
    return this.lifecycleReader.read(threadId);
  }

  close() {
    this.lines?.close();
    this.process?.kill();
    this.process = undefined;
    this.lines = undefined;
    this.failAll(new Error("Codex App Server 连接已关闭"));
  }

  private request(method: string, params: unknown) {
    if (!this.process) return Promise.reject(new Error("Codex App Server 尚未连接"));
    const id = this.nextId++;
    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Codex App Server 请求超时：${method}`));
      }, 7_000);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.process?.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  private onLine(line: string) {
    let message: JsonRpcResponse;
    try { message = JSON.parse(line) as JsonRpcResponse; } catch { return; }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || "Codex App Server 请求失败"));
    else pending.resolve(message.result);
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class CodexAppServerAdapter {
  private client?: CodexStdioClient;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  readonly status: CodexAdapterStatus = {
    id: "codex",
    provider: "codex",
    displayName: "Codex",
    enabled: true,
    state: "starting",
    connectionMode: "app_server",
    detail: "通过 Codex App Server 和本地生命周期记录自动同步",
  };

  constructor(
    private readonly database: RunlitDatabase,
    private readonly onChange: () => void,
    private readonly pollIntervalMs = Number(process.env.RUNLIT_CODEX_POLL_MS ?? 5000),
    private readonly lookbackHours = Number(process.env.RUNLIT_CODEX_LOOKBACK_HOURS ?? 24),
  ) {}

  async start() {
    this.stopped = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.status.state = "starting";
    try {
      const resolution = resolveCodexExecutable();
      this.status.executablePath = resolution.executable;
      this.status.executableSource = resolution.source;
      this.client = new CodexStdioClient(resolution);
      await this.client.connect();
      await this.scan();
      this.timer = setInterval(() => void this.scan(), this.pollIntervalMs);
      this.timer.unref();
    } catch (error) {
      this.status.state = "unavailable";
      this.status.lastError = error instanceof Error ? error.message : "Codex App Server 不可用";
      this.client?.close();
      this.client = undefined;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.start(), 15_000);
        this.timer.unref();
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.client?.close();
    this.client = undefined;
  }

  async refresh() {
    if (this.client) await this.scan();
    else await this.start();
  }

  private async scan() {
    if (!this.client || this.status.state === "error") return;
    try {
      const result = await scanCodexThreads(this.client, this.database, { lookbackHours: this.lookbackHours });
      this.status.state = "ready";
      this.status.lastScanAt = new Date().toISOString();
      this.status.lastResult = result;
      delete this.status.lastError;
      if (result.observationsAdded > 0) this.onChange();
    } catch (error) {
      this.status.state = "error";
      this.status.lastError = error instanceof Error ? error.message : "Codex 扫描失败";
    }
  }
}
