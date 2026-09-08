import type { Provider } from "@runlit/protocol";

export type AdapterState = "disabled" | "starting" | "ready" | "unavailable" | "error";

export type AdapterStatus = {
  id: string;
  provider: Provider;
  displayName: string;
  enabled: boolean;
  state: AdapterState;
  connectionMode: "app_server" | "local_store" | "hook" | "generic";
  detail?: string;
  dataPath?: string;
  lastScanAt?: string;
  lastError?: string;
  lastResult?: unknown;
  [key: string]: unknown;
};

export interface RunlitAdapter {
  readonly status: AdapterStatus;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  refresh?(): Promise<void> | void;
  configure?(config: Record<string, unknown>): Promise<void> | void;
}

export class AdapterManager {
  private readonly adapters = new Map<string, RunlitAdapter>();

  register(adapter: RunlitAdapter) {
    if (this.adapters.has(adapter.status.id)) throw new Error(`Adapter already registered: ${adapter.status.id}`);
    this.adapters.set(adapter.status.id, adapter);
    return adapter;
  }

  has(id: string) {
    return this.adapters.has(id);
  }

  async unregister(id: string) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown adapter: ${id}`);
    await adapter.stop();
    this.adapters.delete(id);
  }

  async startAll() {
    await Promise.allSettled([...this.adapters.values()].map((adapter) => adapter.start()));
  }

  stopAll() {
    for (const adapter of this.adapters.values()) void adapter.stop();
  }

  statuses() {
    return Object.fromEntries([...this.adapters].map(([id, adapter]) => [id, { ...adapter.status }]));
  }

  async refresh(id?: string) {
    const selected = id ? [this.adapters.get(id)].filter(Boolean) as RunlitAdapter[] : [...this.adapters.values()];
    if (id && selected.length === 0) throw new Error(`Unknown adapter: ${id}`);
    await Promise.all(selected.map(async (adapter) => {
      if (adapter.refresh) await adapter.refresh();
      else await adapter.start();
    }));
    return this.statuses();
  }

  async configure(id: string, config: Record<string, unknown>) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown adapter: ${id}`);
    if (!adapter.configure) throw new Error(`Adapter does not expose manual settings: ${id}`);
    await adapter.configure(config);
    return { ...adapter.status };
  }
}
