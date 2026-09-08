import { z } from "zod";

export const providers = [
  "claude_code",
  "codex",
  "cursor",
  "gemini_cli",
  "github_copilot",
  "opencode",
  "windsurf",
  "workbuddy",
  "generic_cli",
] as const;
export const taskStatuses = [
  "running",
  "completed",
  "stopped_by_user",
  "interrupted",
  "unknown",
] as const;
export const versionSources = ["prompt", "follow_up", "plan", "result", "manual"] as const;
export const artifactKinds = ["session", "markdown", "file", "directory", "url", "git_diff"] as const;
export const observationKinds = [
  "session.discovered",
  "session.activity",
  "prompt.submitted",
  "build.started",
  "file.changed",
  "artifact.detected",
  "session.ended",
] as const;
export const observationSources = ["app_server", "hook", "editor_bridge", "local_store", "process", "file_system", "manual"] as const;
export const observationStrengths = ["weak", "medium", "strong"] as const;
export const VERSION_TITLE_MAX_UNITS = 80;

// ASCII characters use one unit while Chinese and other wide Unicode
// characters use two. This keeps mixed Chinese/English titles visually close
// to one line without making either language disproportionately restrictive.
export function versionTitleUnits(value: string) {
  return Array.from(value).reduce((total, character) => total + (character.codePointAt(0)! > 0x7f ? 2 : 1), 0);
}

export function normalizeVersionTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error("版本标题不能为空");
  if (versionTitleUnits(title) > VERSION_TITLE_MAX_UNITS) {
    throw new Error("版本标题最多 40 个中文字符或 80 个英文字符");
  }
  return title;
}

// Provider IDs are intentionally extensible. Built-in providers remain listed
// above for discovery and presentation, while third-party adapters can use a
// stable lowercase slug without requiring a RunLit core release.
export type Provider = string;
export type TaskStatus = (typeof taskStatuses)[number];
export type VersionSource = (typeof versionSources)[number];
export type ArtifactKind = (typeof artifactKinds)[number];
export type ObservationKind = (typeof observationKinds)[number];
export type ObservationSource = (typeof observationSources)[number];
export type ObservationStrength = (typeof observationStrengths)[number];

export type Artifact = {
  id: string;
  versionId: string;
  kind: ArtifactKind;
  label: string;
  target: string;
  confidence: "confirmed" | "candidate";
};

export type Version = {
  id: string;
  taskId: string;
  parentVersionId?: string;
  ordinal: number;
  summary: string;
  source: VersionSource;
  createdAt: string;
  artifacts: Artifact[];
};

export type Task = {
  id: string;
  provider: Provider;
  providerSessionId?: string;
  title: string;
  projectPath?: string;
  status: TaskStatus;
  startedAt?: string;
  endedAt?: string;
  sourceLink?: string;
  lastActivityAt?: string;
  versions: Version[];
};

export type Snapshot = {
  generatedAt: string;
  tasks: Task[];
};

export type Observation = {
  id: string;
  provider: Provider;
  providerSessionId: string;
  providerInstanceId?: string;
  kind: ObservationKind;
  source: ObservationSource;
  strength: ObservationStrength;
  occurredAt: string;
  title?: string;
  workspacePath?: string;
  target?: string;
  artifactKind?: ArtifactKind;
  artifactLabel?: string;
  observedStatus?: TaskStatus;
};

export type AdapterCheckpoint = {
  adapterId: string;
  provider: Provider;
  cursor: string;
};

const taskPayload = z.object({
  id: z.string().min(1),
  provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  providerSessionId: z.string().min(1).optional(),
  title: z.string().min(1),
  projectPath: z.string().min(1).optional(),
  status: z.enum(taskStatuses),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  sourceLink: z.string().min(1).optional(),
  lastActivityAt: z.iso.datetime().optional(),
});

const versionPayload = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  parentVersionId: z.string().min(1).optional(),
  ordinal: z.number().int().nonnegative(),
  summary: z.string().min(1),
  source: z.enum(versionSources),
  createdAt: z.iso.datetime(),
});

const artifactPayload = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  kind: z.enum(artifactKinds),
  label: z.string().min(1),
  target: z.string().min(1),
  confidence: z.enum(["confirmed", "candidate"]),
});

const observationPayload = z.object({
  id: z.string().min(1),
  provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  providerSessionId: z.string().min(1),
  providerInstanceId: z.string().min(1).optional(),
  kind: z.enum(observationKinds),
  source: z.enum(observationSources),
  strength: z.enum(observationStrengths),
  title: z.string().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  artifactKind: z.enum(artifactKinds).optional(),
  artifactLabel: z.string().min(1).optional(),
  observedStatus: z.enum(taskStatuses).optional(),
});

const adapterCheckpointPayload = z.object({
  adapterId: z.string().min(1),
  provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  cursor: z.string().min(1),
});

export const runlitEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task.upsert"), occurredAt: z.iso.datetime(), payload: taskPayload }),
  z.object({ type: z.literal("version.upsert"), occurredAt: z.iso.datetime(), payload: versionPayload }),
  z.object({ type: z.literal("artifact.upsert"), occurredAt: z.iso.datetime(), payload: artifactPayload }),
  z.object({ type: z.literal("observation.recorded"), occurredAt: z.iso.datetime(), payload: observationPayload }),
  z.object({ type: z.literal("adapter.checkpoint"), occurredAt: z.iso.datetime(), payload: adapterCheckpointPayload }),
]);

export type RunlitEvent = z.infer<typeof runlitEventSchema>;

export function parseRunlitEvent(input: unknown): RunlitEvent {
  return runlitEventSchema.parse(input);
}
