import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import type { ArtifactKind, RunlitEvent } from "@runlit/protocol";
import type { AdapterStatus, RunlitAdapter } from "./adapter.js";
import type { RunlitDatabase } from "./database.js";

const IGNORED_DIRECTORIES = new Set([".git", ".runlit", "node_modules"]);
const MAX_FILES = 20_000;

export type GenericFolderAdapterConfig = {
  kind: "folder_watch";
  id: string;
  provider: string;
  displayName: string;
  watchPath: string;
};

export type GenericFolderAdapterStatus = AdapterStatus & {
  connectionMode: "generic";
  removable: true;
  watchPath: string;
  capability: "artifacts_only";
};

type ValidateGenericFolderOptions = {
  requireExistingPath?: boolean;
  id?: string;
};

function apply(database: RunlitDatabase, event: RunlitEvent) {
  return database.apply(event);
}

function filesModifiedAfter(root: string, since: number) {
  const changed: string[] = [];
  let filesSeen = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        filesSeen += 1;
        if (filesSeen > MAX_FILES) throw new Error(`监控目录超过 ${MAX_FILES.toLocaleString()} 个文件，请选择更具体的成果目录`);
        if (statSync(target).mtimeMs > since) changed.push(target);
      }
    }
  };
  visit(root);
  return { changed, filesSeen };
}

function artifactFor(paths: string[], workspace: string) {
  if (paths.length === 1) {
    const target = paths[0]!;
    const kind: ArtifactKind = extname(target).toLowerCase() === ".md" ? "markdown" : "file";
    return { target, kind, label: basename(target) };
  }
  const parents = new Set(paths.map((target) => dirname(target).toLowerCase()));
  const target = parents.size === 1 ? dirname(paths[0]!) : workspace;
  return { target, kind: "directory" as const, label: `${paths.length} 个成果物 · ${basename(target)}` };
}

function providerSlug(value: string) {
  const slug = value.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "local-ai";
}

export function validateGenericFolderConfig(value: unknown, options: ValidateGenericFolderOptions = {}): GenericFolderAdapterConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("新增工具配置无效");
  const input = value as Record<string, unknown>;
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const provider = typeof input.provider === "string" && input.provider.trim()
    ? input.provider.trim().toLowerCase()
    : providerSlug(displayName);
  const watchPath = typeof input.watchPath === "string" ? resolve(input.watchPath.trim()) : "";
  const requestedId = options.id ?? (typeof input.id === "string" ? input.id.trim().toLowerCase() : "");
  const id = requestedId || `custom-${provider}`;
  if (!displayName || displayName.length > 40) throw new Error("工具名称应为 1–40 个字符");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider)) throw new Error("Provider ID 只能使用小写字母、数字、下划线和连字符");
  if (["codex", "workbuddy"].includes(provider)) throw new Error("该 Provider ID 已由内置适配器使用");
  if (!/^custom-[a-z0-9][a-z0-9_-]{0,71}$/.test(id)) throw new Error("接入标识无效");
  if (!watchPath || !isAbsolute(watchPath)) throw new Error("请选择具体的本地成果目录");
  if (options.requireExistingPath !== false && (!existsSync(watchPath) || !statSync(watchPath).isDirectory())) throw new Error("成果目录不存在或不是文件夹");
  if (dirname(watchPath) === watchPath) throw new Error("不能监控整个磁盘，请选择具体的成果目录");
  return { kind: "folder_watch", id, provider, displayName, watchPath };
}

export class GenericFolderAdapter implements RunlitAdapter {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private pending = new Set<string>();
  private pendingStartedAt?: number;
  private lastChangedAt?: number;
  private cursorMs?: number;
  readonly status: GenericFolderAdapterStatus;

  constructor(
    readonly config: GenericFolderAdapterConfig,
    private readonly database: RunlitDatabase,
    private readonly onChanged: () => void,
    private readonly pollMs = 2_000,
    private readonly quietMs = 6_000,
  ) {
    this.status = {
      id: config.id,
      provider: config.provider,
      displayName: config.displayName,
      enabled: true,
      state: "starting",
      connectionMode: "generic",
      detail: "监控本地成果目录；文件写入稳定后聚合为一个版本",
      dataPath: config.watchPath,
      watchPath: config.watchPath,
      removable: true,
      capability: "artifacts_only",
    };
  }

  async start() {
    this.stopped = false;
    const stored = this.database.adapterCheckpoint(this.status.id)?.cursor;
    const parsed = stored ? Date.parse(stored) : Number.NaN;
    this.cursorMs = Number.isFinite(parsed) ? parsed : Date.now();
    this.status.state = "ready";
    this.status.lastError = undefined;
    await this.scan();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async refresh() {
    await this.scan(true);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.scan().finally(() => this.schedule()), this.pollMs);
  }

  private async scan(forceFinalize = false) {
    try {
      const now = Date.now();
      const result = filesModifiedAfter(this.config.watchPath, this.cursorMs ?? now);
      for (const target of result.changed) this.pending.add(target);
      if (result.changed.length > 0) {
        this.pendingStartedAt ??= now;
        this.lastChangedAt = now;
      }
      const shouldFinalize = this.pending.size > 0 && (forceFinalize || now - (this.lastChangedAt ?? now) >= this.quietMs);
      if (shouldFinalize) this.finalize(now);
      else if (this.pending.size === 0) this.saveCursor(now);
      this.status.state = "ready";
      this.status.lastError = undefined;
      this.status.lastScanAt = new Date(now).toISOString();
      this.status.lastResult = { filesSeen: result.filesSeen, pendingFiles: this.pending.size };
    } catch (error) {
      this.status.state = "error";
      this.status.lastError = error instanceof Error ? error.message : "本地成果目录扫描失败";
      this.status.lastScanAt = new Date().toISOString();
    }
  }

  private finalize(now: number) {
    const paths = [...this.pending].filter((target) => existsSync(target));
    if (paths.length === 0) {
      this.pending.clear();
      this.saveCursor(now);
      return;
    }
    const batch = String(this.pendingStartedAt ?? now);
    const sessionId = this.config.id;
    const title = `${this.config.displayName} 本地成果任务`;
    const artifact = artifactFor(paths, this.config.watchPath);
    const startedAt = new Date(this.pendingStartedAt ?? now).toISOString();
    const completedAt = new Date(now).toISOString();
    apply(this.database, { type: "observation.recorded", occurredAt: startedAt, payload: {
      id: `${sessionId}:${batch}:discovered`, provider: this.config.provider, providerSessionId: sessionId,
      providerInstanceId: sessionId, kind: "session.discovered", source: "file_system", strength: "strong",
      title, workspacePath: this.config.watchPath,
    } });
    apply(this.database, { type: "observation.recorded", occurredAt: startedAt, payload: {
      id: `${sessionId}:${batch}:started`, provider: this.config.provider, providerSessionId: sessionId,
      kind: "build.started", source: "file_system", strength: "strong", title,
      workspacePath: this.config.watchPath, observedStatus: "running",
    } });
    apply(this.database, { type: "observation.recorded", occurredAt: completedAt, payload: {
      id: `${sessionId}:${batch}:artifact`, provider: this.config.provider, providerSessionId: sessionId,
      kind: "artifact.detected", source: "file_system", strength: "strong", title,
      workspacePath: this.config.watchPath, target: artifact.target, artifactKind: artifact.kind, artifactLabel: artifact.label,
    } });
    apply(this.database, { type: "observation.recorded", occurredAt: new Date(now + 1).toISOString(), payload: {
      id: `${sessionId}:${batch}:ended`, provider: this.config.provider, providerSessionId: sessionId,
      kind: "session.ended", source: "file_system", strength: "strong", title,
      workspacePath: this.config.watchPath, observedStatus: "completed",
    } });
    this.pending.clear();
    this.pendingStartedAt = undefined;
    this.lastChangedAt = undefined;
    this.saveCursor(now + 1);
    this.onChanged();
  }

  private saveCursor(value: number) {
    this.cursorMs = value;
    apply(this.database, {
      type: "adapter.checkpoint",
      occurredAt: new Date(value).toISOString(),
      payload: { adapterId: this.status.id, provider: this.config.provider, cursor: new Date(value).toISOString() },
    });
  }
}
