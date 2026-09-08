import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeVersionTitle, type Artifact, type RunlitEvent, type Snapshot, type Task, type Version } from "@runlit/protocol";

export type RunlitMode = "normal" | "demo";

type DatabaseOptions = { mode?: RunlitMode; planPath?: string };
export type ApplyResult = { accepted: true; duplicate: boolean; resolvedTaskId?: string };
export type TaskCandidateRecord = {
  provider: Task["provider"];
  providerSessionId: string;
  title: string | null;
  workspacePath: string | null;
  status: "candidate" | "qualified";
  reason: string;
  missingEvidence: string[];
  resolvedTaskId: string | null;
  qualifiedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type ArtifactEvidenceRecord = {
  id: string;
  observationId: string;
  provider: Task["provider"];
  providerSessionId: string;
  kind: Artifact["kind"];
  label: string;
  target: string;
  verificationStatus: "verified" | "pending" | "rejected";
  confidence: Artifact["confidence"];
  reason: string;
  sha256?: string;
  sizeBytes?: number;
  modifiedAt?: string;
  verifiedAt?: string;
};

export class RunlitDatabase {
  readonly db: DatabaseSync;

  constructor(path: string, options: DatabaseOptions = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
    if ((options.mode ?? "normal") === "demo") this.seed(options.planPath);
    else this.removeLegacyTestRecords();
  }

  close() {
    this.db.close();
  }

  taskCount() {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count;
  }

  hiddenTaskCount() {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE hidden_at IS NOT NULL").get() as { count: number }).count;
  }

  hideTask(taskId: string, hiddenAt = new Date().toISOString()) {
    const result = this.db.prepare(`
      UPDATE tasks SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL
    `).run(hiddenAt, taskId);
    return result.changes > 0;
  }

  renameVersion(versionId: string, summary: string) {
    const customSummary = normalizeVersionTitle(summary);
    const result = this.db.prepare(`
      UPDATE versions SET custom_summary = ? WHERE id = ?
    `).run(customSummary, versionId);
    return result.changes > 0;
  }

  hasTaskForSession(provider: Task["provider"], providerSessionId: string) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM tasks WHERE provider = ? AND provider_session_id = ? LIMIT 1
    `).get(provider, providerSessionId));
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        title TEXT NOT NULL,
        project_path TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        source_link TEXT,
        last_activity_at TEXT
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        parent_version_id TEXT,
        ordinal INTEGER NOT NULL,
        summary TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        target TEXT NOT NULL,
        confidence TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        title TEXT,
        workspace_path TEXT,
        state TEXT NOT NULL,
        source TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY(provider, provider_session_id)
      );
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        strength TEXT NOT NULL,
        workspace_path TEXT,
        target TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_candidates (
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        title TEXT,
        workspace_path TEXT,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY(provider, provider_session_id)
      );
      CREATE TABLE IF NOT EXISTS provider_instances (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_session_links (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY(task_id, provider, provider_session_id)
      );
      CREATE TABLE IF NOT EXISTS artifact_evidence (
        id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        target TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        confidence TEXT NOT NULL,
        reason TEXT NOT NULL,
        sha256 TEXT,
        size_bytes INTEGER,
        modified_at TEXT,
        verified_at TEXT
      );
      CREATE TABLE IF NOT EXISTS adapter_checkpoints (
        adapter_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status TEXT NOT NULL,
        observation_id TEXT,
        reason TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS versions_task_idx ON versions(task_id, ordinal);
      CREATE INDEX IF NOT EXISTS artifacts_version_idx ON artifacts(version_id);
      CREATE INDEX IF NOT EXISTS observations_session_idx ON observations(provider, provider_session_id, occurred_at);
      CREATE INDEX IF NOT EXISTS candidates_status_idx ON task_candidates(status, last_seen_at);
      CREATE INDEX IF NOT EXISTS artifact_evidence_session_idx ON artifact_evidence(provider, provider_session_id, verification_status);
      CREATE INDEX IF NOT EXISTS transitions_task_idx ON state_transitions(task_id, occurred_at);
    `);
    this.ensureColumn("task_candidates", "missing_evidence_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("task_candidates", "resolved_task_id", "TEXT");
    this.ensureColumn("task_candidates", "qualified_at", "TEXT");
    this.ensureColumn("tasks", "hidden_at", "TEXT");
    this.ensureColumn("versions", "custom_summary", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  apply(event: RunlitEvent): ApplyResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let result: ApplyResult = { accepted: true, duplicate: false };
      if (event.type === "task.upsert") {
        const p = event.payload;
        this.db.prepare(`
          INSERT INTO tasks(
            id, provider, provider_session_id, title, project_path, status,
            started_at, ended_at, source_link, last_activity_at, hidden_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(id) DO UPDATE SET
            provider=excluded.provider, provider_session_id=excluded.provider_session_id,
            title=excluded.title, project_path=excluded.project_path, status=excluded.status,
            started_at=excluded.started_at, ended_at=excluded.ended_at,
            source_link=excluded.source_link, last_activity_at=excluded.last_activity_at,
            hidden_at=CASE
              WHEN excluded.status = 'running' AND excluded.last_activity_at > tasks.hidden_at THEN NULL
              ELSE tasks.hidden_at
            END
        `).run(p.id, p.provider, p.providerSessionId ?? null, p.title, p.projectPath ?? null,
          p.status, p.startedAt ?? null, p.endedAt ?? null, p.sourceLink ?? null,
          p.lastActivityAt ?? event.occurredAt);
      } else if (event.type === "version.upsert") {
        const p = event.payload;
        this.db.prepare(`
          INSERT INTO versions(id, task_id, parent_version_id, ordinal, summary, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET parent_version_id=excluded.parent_version_id,
            ordinal=excluded.ordinal, summary=excluded.summary, source=excluded.source,
            created_at=excluded.created_at
        `).run(p.id, p.taskId, p.parentVersionId ?? null, p.ordinal, p.summary, p.source, p.createdAt);
      } else if (event.type === "observation.recorded") {
        result = this.recordObservation(event);
      } else if (event.type === "adapter.checkpoint") {
        result = this.recordCheckpoint(event);
      } else {
        const p = event.payload;
        this.db.prepare(`
          INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, label=excluded.label,
            target=excluded.target, confidence=excluded.confidence
        `).run(p.id, p.versionId, p.kind, p.label, p.target, p.confidence);
      }

      if (!result.duplicate) {
        this.db.prepare("INSERT INTO event_log(event_type, occurred_at, payload_json) VALUES (?, ?, ?)")
          .run(event.type, event.occurredAt, JSON.stringify(event.payload));
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  snapshot(): Snapshot {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE hidden_at IS NULL
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, last_activity_at DESC
    `).all() as Record<string, unknown>[];
    const tasks: Task[] = rows.map((row) => {
      const versionRows = this.db.prepare(`
        SELECT * FROM versions
        WHERE task_id = ? AND id NOT LIKE 'version:codex:%:file:%'
        ORDER BY ordinal
      `).all(row.id as string) as Record<string, unknown>[];
      const versions: Version[] = versionRows.map((version, index) => {
        const artifactRows = this.db.prepare("SELECT * FROM artifacts WHERE version_id = ? ORDER BY label").all(version.id as string) as Record<string, unknown>[];
        const artifacts: Artifact[] = artifactRows.map((artifact) => ({
          id: artifact.id as string,
          versionId: artifact.version_id as string,
          kind: artifact.kind as Artifact["kind"],
          label: artifact.label as string,
          target: artifact.target as string,
          confidence: artifact.confidence as Artifact["confidence"],
        }));
        return {
          id: version.id as string,
          taskId: version.task_id as string,
          ...(index > 0 ? { parentVersionId: versionRows[index - 1]?.id as string } : {}),
          ordinal: index,
          summary: (version.custom_summary ?? version.summary) as string,
          source: version.source as Version["source"],
          createdAt: version.created_at as string,
          artifacts,
        };
      });
      return {
        id: row.id as string,
        provider: row.provider as Task["provider"],
        ...(row.provider_session_id ? { providerSessionId: row.provider_session_id as string } : {}),
        title: row.title as string,
        ...(row.project_path ? { projectPath: row.project_path as string } : {}),
        status: row.status as Task["status"],
        ...(row.started_at ? { startedAt: row.started_at as string } : {}),
        ...(row.ended_at ? { endedAt: row.ended_at as string } : {}),
        ...(row.source_link ? { sourceLink: row.source_link as string } : {}),
        ...(row.last_activity_at ? { lastActivityAt: row.last_activity_at as string } : {}),
        versions,
      };
    });
    return { generatedAt: new Date().toISOString(), tasks };
  }

  candidateCounts() {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS count FROM task_candidates GROUP BY status").all() as { status: string; count: number }[];
    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }

  observationCount() {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM observations").get() as { count: number }).count;
  }

  evidenceCounts() {
    const rows = this.db.prepare("SELECT verification_status AS status, COUNT(*) AS count FROM artifact_evidence GROUP BY verification_status").all() as { status: string; count: number }[];
    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }

  checkpointCount() {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM adapter_checkpoints").get() as { count: number }).count;
  }

  candidates(): TaskCandidateRecord[] {
    const rows = this.db.prepare(`
      SELECT provider, provider_session_id AS providerSessionId, title, workspace_path AS workspacePath,
        status, reason, missing_evidence_json AS missingEvidenceJson,
        resolved_task_id AS resolvedTaskId, qualified_at AS qualifiedAt,
        first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
      FROM task_candidates
      ORDER BY last_seen_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(({ missingEvidenceJson, ...row }) => ({
      ...row,
      missingEvidence: JSON.parse((missingEvidenceJson as string | null) ?? "[]") as string[],
    })) as TaskCandidateRecord[];
  }

  artifactEvidence() {
    return this.db.prepare(`
      SELECT id, observation_id AS observationId, provider,
        provider_session_id AS providerSessionId, kind, label, target,
        verification_status AS verificationStatus, confidence, reason, sha256,
        size_bytes AS sizeBytes, modified_at AS modifiedAt, verified_at AS verifiedAt
      FROM artifact_evidence
      ORDER BY COALESCE(verified_at, modified_at) DESC, id DESC
    `).all();
  }

  adapterCheckpoints() {
    return this.db.prepare(`
      SELECT adapter_id AS adapterId, provider, cursor, updated_at AS updatedAt
      FROM adapter_checkpoints ORDER BY adapter_id
    `).all();
  }

  adapterCheckpoint(adapterId: string) {
    return this.db.prepare(`
      SELECT adapter_id AS adapterId, provider, cursor, updated_at AS updatedAt
      FROM adapter_checkpoints WHERE adapter_id = ?
    `).get(adapterId) as { adapterId: string; provider: string; cursor: string; updatedAt: string } | undefined;
  }

  clearAdapterCheckpoint(adapterId: string) {
    return this.db.prepare("DELETE FROM adapter_checkpoints WHERE adapter_id = ?").run(adapterId).changes > 0;
  }

  private recordObservation(event: Extract<RunlitEvent, { type: "observation.recorded" }>): ApplyResult {
    const p = event.payload;
    const inserted = this.db.prepare(`
      INSERT OR IGNORE INTO observations(id, provider, provider_session_id, kind, source, strength, workspace_path, target, occurred_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.provider, p.providerSessionId, p.kind, p.source, p.strength, p.workspacePath ?? null, p.target ?? null, event.occurredAt, JSON.stringify(p));
    if (inserted.changes === 0) return { accepted: true, duplicate: true };

    const state = p.kind === "session.ended" ? "ended" : "active";
    const instanceId = p.providerInstanceId ?? `${p.provider}:${p.source}`;
    this.db.prepare(`
      INSERT INTO provider_instances(id, provider, source, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=MAX(provider_instances.last_seen_at, excluded.last_seen_at)
    `).run(instanceId, p.provider, p.source, event.occurredAt, event.occurredAt);

    this.db.prepare(`
      INSERT INTO sessions(provider, provider_session_id, title, workspace_path, state, source, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_session_id) DO UPDATE SET
        title=COALESCE(excluded.title, sessions.title),
        workspace_path=COALESCE(excluded.workspace_path, sessions.workspace_path),
        state=excluded.state,
        source=excluded.source,
        last_seen_at=MAX(sessions.last_seen_at, excluded.last_seen_at)
    `).run(p.provider, p.providerSessionId, p.title ?? null, p.workspacePath ?? null, state, p.source, event.occurredAt, event.occurredAt);

    const startsNewRun = p.kind === "build.started"
      || (p.kind === "session.activity" && (p.observedStatus === undefined || p.observedStatus === "running"));
    if (startsNewRun) {
      this.db.prepare(`
        UPDATE tasks SET hidden_at = NULL
        WHERE provider = ? AND provider_session_id = ?
          AND hidden_at IS NOT NULL AND hidden_at < ?
      `).run(p.provider, p.providerSessionId, event.occurredAt);
    }

    const evidence = this.verifyArtifactEvidence(event);
    if (evidence) this.saveArtifactEvidence(evidence);

    const session = this.db.prepare("SELECT title, workspace_path, first_seen_at, last_seen_at FROM sessions WHERE provider = ? AND provider_session_id = ?")
      .get(p.provider, p.providerSessionId) as { title: string | null; workspace_path: string | null; first_seen_at: string; last_seen_at: string };
    const observations = this.db.prepare("SELECT kind, source, strength, workspace_path, target FROM observations WHERE provider = ? AND provider_session_id = ?")
      .all(p.provider, p.providerSessionId) as { kind: string; source: string; strength: string; workspace_path: string | null; target: string | null }[];
    const evidenceRows = this.db.prepare(`
      SELECT ae.verification_status, ae.reason, o.strength
      FROM artifact_evidence ae
      JOIN observations o ON o.id = ae.observation_id
      WHERE ae.provider = ? AND ae.provider_session_id = ?
    `).all(p.provider, p.providerSessionId) as { verification_status: string; reason: string; strength: string }[];

    const hasScope = Boolean(session.workspace_path) || observations.some((observation) => Boolean(observation.workspace_path || observation.target));
    const hasBuildBehavior = observations.some((observation) => ["build.started", "file.changed", "artifact.detected"].includes(observation.kind));
    const hasVerifiedOutput = evidenceRows.some((item) => item.verification_status === "verified" && item.strength === "strong");
    const hasTrustedBuildStart = observations.some((observation) => observation.kind === "build.started"
      && observation.strength === "strong"
      && ["app_server", "hook", "editor_bridge", "local_store"].includes(observation.source));
    const missingEvidence = [
      ...(!hasScope ? ["工作对象"] : []),
      ...(!hasBuildBehavior ? ["构建行为"] : []),
      ...(!hasVerifiedOutput && !hasTrustedBuildStart ? ["已验证成果物"] : []),
    ];
    const status = missingEvidence.length === 0 ? "qualified" : "candidate";
    const unresolvedEvidence = evidenceRows.find((item) => item.verification_status !== "verified");
    const reason = status === "qualified"
      ? hasVerifiedOutput ? "已确认会话身份、工作对象、构建行为和成果物" : "已确认会话身份、工作对象和强构建活动；成果待生成"
      : unresolvedEvidence?.reason ?? `缺少：${missingEvidence.join("、")}`;

    this.db.prepare(`
      INSERT INTO task_candidates(
        provider, provider_session_id, title, workspace_path, status, reason,
        first_seen_at, last_seen_at, missing_evidence_json, resolved_task_id, qualified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(provider, provider_session_id) DO UPDATE SET
        title=COALESCE(excluded.title, task_candidates.title),
        workspace_path=COALESCE(excluded.workspace_path, task_candidates.workspace_path),
        status=excluded.status,
        reason=excluded.reason,
        missing_evidence_json=excluded.missing_evidence_json,
        qualified_at=COALESCE(task_candidates.qualified_at, excluded.qualified_at),
        last_seen_at=excluded.last_seen_at
    `).run(
      p.provider, p.providerSessionId, session.title, session.workspace_path, status, reason,
      session.first_seen_at, session.last_seen_at, JSON.stringify(missingEvidence),
      status === "qualified" ? event.occurredAt : null,
    );

    if (status !== "qualified") return { accepted: true, duplicate: false };
    const taskId = this.resolveQualifiedCandidate(event, session, evidence);
    this.db.prepare(`
      UPDATE task_candidates SET resolved_task_id = ?
      WHERE provider = ? AND provider_session_id = ?
    `).run(taskId, p.provider, p.providerSessionId);
    return { accepted: true, duplicate: false, resolvedTaskId: taskId };
  }

  private verifyArtifactEvidence(event: Extract<RunlitEvent, { type: "observation.recorded" }>): ArtifactEvidenceRecord | undefined {
    const p = event.payload;
    if (!["file.changed", "artifact.detected"].includes(p.kind) || !p.target) return undefined;

    const base = {
      id: `evidence:${p.id}`,
      observationId: p.id,
      provider: p.provider,
      providerSessionId: p.providerSessionId,
      target: p.target,
    };
    if (/^https?:\/\//i.test(p.target)) {
      let validUrl = false;
      try { validUrl = ["http:", "https:"].includes(new URL(p.target).protocol); } catch { /* rejected below */ }
      const trustedSource = p.strength === "strong" && ["app_server", "hook", "editor_bridge"].includes(p.source);
      const verified = validUrl && trustedSource;
      return {
        ...base,
        kind: "url",
        label: p.artifactLabel ?? p.target,
        verificationStatus: verified ? "verified" : validUrl ? "pending" : "rejected",
        confidence: verified ? "confirmed" : "candidate",
        reason: verified
          ? "远程 URL 来自受信适配器的强成果事件"
          : validUrl ? "远程 URL 尚未通过来源接口验证" : "成果物 URL 格式无效",
        ...(verified ? { verifiedAt: event.occurredAt } : {}),
      };
    }

    const target = resolve(p.target);
    if (p.workspacePath) {
      const workspace = resolve(p.workspacePath);
      const pathFromWorkspace = relative(workspace, target);
      const outsideWorkspace = pathFromWorkspace === ".."
        || pathFromWorkspace.startsWith(`..${sep}`)
        || isAbsolute(pathFromWorkspace);
      if (outsideWorkspace) {
        return {
          ...base,
          kind: p.artifactKind ?? "file",
          label: p.artifactLabel ?? basename(target),
          verificationStatus: "rejected",
          confidence: "candidate",
          reason: "成果物不在已识别工作区内",
        };
      }
    }

    try {
      const stat = statSync(target);
      const kind: Artifact["kind"] = p.artifactKind ?? (stat.isDirectory() ? "directory" : extname(target).toLowerCase() === ".md" ? "markdown" : "file");
      const sizeBytes = stat.isFile() ? stat.size : undefined;
      const sha256 = stat.isFile() && stat.size <= 16 * 1024 * 1024
        ? createHash("sha256").update(readFileSync(target)).digest("hex")
        : undefined;
      return {
        ...base,
        kind,
        label: p.artifactLabel ?? basename(target),
        verificationStatus: "verified",
        confidence: p.strength === "strong" ? "confirmed" : "candidate",
        reason: p.strength === "strong" ? "本地成果物存在且来源证据强" : "本地成果物存在，但来源证据不足",
        ...(sha256 ? { sha256 } : {}),
        ...(sizeBytes === undefined ? {} : { sizeBytes }),
        modifiedAt: stat.mtime.toISOString(),
        verifiedAt: event.occurredAt,
      };
    } catch {
      return {
        ...base,
        kind: p.artifactKind ?? "file",
        label: p.artifactLabel ?? basename(target),
        verificationStatus: "rejected",
        confidence: "candidate",
        reason: "本地成果物不存在或不可访问",
      };
    }
  }

  private saveArtifactEvidence(evidence: ArtifactEvidenceRecord) {
    this.db.prepare(`
      INSERT INTO artifact_evidence(
        id, observation_id, provider, provider_session_id, kind, label, target,
        verification_status, confidence, reason, sha256, size_bytes, modified_at, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        verification_status=excluded.verification_status, confidence=excluded.confidence,
        reason=excluded.reason, sha256=excluded.sha256, size_bytes=excluded.size_bytes,
        modified_at=excluded.modified_at, verified_at=excluded.verified_at
    `).run(
      evidence.id, evidence.observationId, evidence.provider, evidence.providerSessionId,
      evidence.kind, evidence.label, evidence.target, evidence.verificationStatus,
      evidence.confidence, evidence.reason, evidence.sha256 ?? null, evidence.sizeBytes ?? null,
      evidence.modifiedAt ?? null, evidence.verifiedAt ?? null,
    );
  }

  private resolveQualifiedCandidate(
    event: Extract<RunlitEvent, { type: "observation.recorded" }>,
    session: { title: string | null; workspace_path: string | null; first_seen_at: string; last_seen_at: string },
    currentEvidence?: ArtifactEvidenceRecord,
  ) {
    const p = event.payload;
    const taskId = `task:${p.provider}:${p.providerSessionId}`;
    const existing = this.db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: Task["status"] } | undefined;
    const latestLifecycle = this.db.prepare(`
      SELECT id, kind, strength, occurred_at, payload_json FROM observations
      WHERE provider = ? AND provider_session_id = ?
        AND kind IN ('session.activity', 'session.ended')
      ORDER BY CASE source WHEN 'local_store' THEN 0 ELSE 1 END,
        occurred_at DESC, rowid DESC LIMIT 1
    `).get(p.provider, p.providerSessionId) as {
      id: string; kind: string; strength: string; occurred_at: string; payload_json: string;
    } | undefined;
    const lifecyclePayload = latestLifecycle
      ? JSON.parse(latestLifecycle.payload_json) as { observedStatus?: Task["status"] }
      : undefined;
    const nextStatus: Task["status"] = lifecyclePayload?.observedStatus
      ?? (latestLifecycle?.kind === "session.activity"
        ? "running"
        : latestLifecycle?.kind === "session.ended" && latestLifecycle.strength === "strong"
          ? "completed"
          : latestLifecycle?.kind === "session.ended"
            ? "unknown"
            : existing?.status ?? "unknown");
    const isTerminal = ["completed", "stopped_by_user", "interrupted"].includes(nextStatus);
    const title = session.title ?? (session.workspace_path ? basename(session.workspace_path) : `${p.provider} 构建任务`);

    this.db.prepare(`
      INSERT INTO tasks(id, provider, provider_session_id, title, project_path, status, started_at, ended_at, source_link, last_activity_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, project_path=COALESCE(excluded.project_path, tasks.project_path),
        status=excluded.status, ended_at=excluded.ended_at, last_activity_at=excluded.last_activity_at
    `).run(
      taskId, p.provider, p.providerSessionId, title, session.workspace_path,
      nextStatus, session.first_seen_at, isTerminal ? latestLifecycle?.occurred_at ?? event.occurredAt : null, session.last_seen_at,
    );
    this.db.prepare(`
      INSERT OR IGNORE INTO task_session_links(task_id, provider, provider_session_id, relation, linked_at)
      VALUES (?, ?, ?, 'primary', ?)
    `).run(taskId, p.provider, p.providerSessionId, event.occurredAt);

    if (!existing || existing.status !== nextStatus) {
      this.db.prepare(`
        INSERT OR IGNORE INTO state_transitions(id, task_id, from_status, to_status, observation_id, reason, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        `transition:${taskId}:${latestLifecycle?.id ?? p.id}:${nextStatus}`, taskId, existing?.status ?? null,
        nextStatus, latestLifecycle?.id ?? p.id,
        nextStatus === "running" ? "检测到最新一轮正在执行" : isTerminal ? "检测到最新一轮已结束" : "候选满足真实任务准入规则",
        latestLifecycle?.occurred_at ?? event.occurredAt,
      );
    }

    if (currentEvidence?.verificationStatus === "verified") {
      const versionId = `version:${p.id}`;
      const previous = this.db.prepare("SELECT id, ordinal FROM versions WHERE task_id = ? ORDER BY ordinal DESC LIMIT 1")
        .get(taskId) as { id: string; ordinal: number } | undefined;
      this.db.prepare(`
        INSERT OR IGNORE INTO versions(id, task_id, parent_version_id, ordinal, summary, source, created_at)
        VALUES (?, ?, ?, ?, ?, 'result', ?)
      `).run(
        versionId, taskId, previous?.id ?? null, (previous?.ordinal ?? -1) + 1,
        `已确认成果物：${currentEvidence.label}`, event.occurredAt,
      );
      this.db.prepare(`
        INSERT OR IGNORE INTO artifacts(id, version_id, kind, label, target, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        `artifact:${p.id}`, versionId, currentEvidence.kind, currentEvidence.label,
        currentEvidence.target, currentEvidence.confidence,
      );
    }
    return taskId;
  }

  private recordCheckpoint(event: Extract<RunlitEvent, { type: "adapter.checkpoint" }>): ApplyResult {
    const p = event.payload;
    const current = this.db.prepare("SELECT cursor FROM adapter_checkpoints WHERE adapter_id = ?").get(p.adapterId) as { cursor: string } | undefined;
    if (current?.cursor === p.cursor) return { accepted: true, duplicate: true };
    this.db.prepare(`
      INSERT INTO adapter_checkpoints(adapter_id, provider, cursor, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(adapter_id) DO UPDATE SET provider=excluded.provider, cursor=excluded.cursor, updated_at=excluded.updated_at
    `).run(p.adapterId, p.provider, p.cursor, event.occurredAt);
    return { accepted: true, duplicate: false };
  }

  private removeLegacyTestRecords() {
    const legacy = this.db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id LIKE 'demo-%' OR id = 'native-smoke'").get() as { count: number };
    if (legacy.count === 0) return;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM event_log WHERE payload_json LIKE '%demo-%' OR payload_json LIKE '%native-smoke%'").run();
      this.db.prepare("DELETE FROM tasks WHERE id LIKE 'demo-%' OR id = 'native-smoke'").run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private seed(planPath?: string) {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    if (count.count > 0) return;
    const now = Date.now();
    const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const tasks = [
      ["demo-codex-runlit", "codex", "构建 Runlit 桌面端", "running", 42],
      ["demo-claude-research", "claude_code", "整理日本 AI 市场资料", "running", 18],
      ["demo-codex-report", "codex", "生成月度业务复盘", "completed", 95],
      ["demo-generic-clean", "generic_cli", "清洗客户数据", "interrupted", 127],
      ["demo-claude-copy", "claude_code", "修改产品介绍文案", "stopped_by_user", 180],
      ["demo-cursor-site", "cursor", "官网原型迭代", "unknown", 33],
      ["demo-codex-brief", "codex", "竞品简报排版", "completed", 260],
      ["demo-generic-export", "generic_cli", "导出合同索引", "completed", 310],
    ] as const;
    for (const [id, provider, title, status, age] of tasks) {
      this.apply({
        type: "task.upsert",
        occurredAt: iso(age),
        payload: {
          id, provider, title, status,
          startedAt: iso(age + 36),
          ...(status === "running" || status === "unknown" ? {} : { endedAt: iso(age) }),
          projectPath: planPath ? dirname(planPath) : process.cwd(),
          lastActivityAt: iso(age),
        },
      });
      this.apply({
        type: "version.upsert",
        occurredAt: iso(age + 30),
        payload: { id: `${id}-v0`, taskId: id, ordinal: 0, summary: `初始任务：${title}`, source: "prompt", createdAt: iso(age + 30) },
      });
      this.apply({
        type: "version.upsert",
        occurredAt: iso(age + 10),
        payload: { id: `${id}-v1`, taskId: id, parentVersionId: `${id}-v0`, ordinal: 1, summary: "补充输出结构并确认本地结果入口", source: "follow_up", createdAt: iso(age + 10) },
      });
    }
    if (planPath) {
      this.apply({
        type: "artifact.upsert",
        occurredAt: iso(2),
        payload: { id: "demo-runlit-plan", versionId: "demo-codex-runlit-v1", kind: "markdown", label: "Runlit 构建计划", target: planPath, confidence: "confirmed" },
      });
    }
  }
}
