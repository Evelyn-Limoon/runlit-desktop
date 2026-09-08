import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type RunlitSettings = {
  adapters?: Record<string, Record<string, unknown>>;
};

export class SettingsStore {
  private value: RunlitSettings = {};

  constructor(private readonly path: string) {
    if (!existsSync(path)) return;
    try { this.value = JSON.parse(readFileSync(path, "utf8")) as RunlitSettings; } catch { this.value = {}; }
  }

  adapter(id: string) {
    return this.value.adapters?.[id] ?? {};
  }

  adapters() {
    return Object.entries(this.value.adapters ?? {}).map(([id, config]) => ({ id, config: { ...config } }));
  }

  saveAdapter(id: string, config: Record<string, unknown>) {
    this.value = { ...this.value, adapters: { ...this.value.adapters, [id]: config } };
    writeFileSync(this.path, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
  }

  removeAdapter(id: string) {
    const adapters = { ...this.value.adapters };
    delete adapters[id];
    this.value = { ...this.value, adapters };
    writeFileSync(this.path, `${JSON.stringify(this.value, null, 2)}\n`, "utf8");
  }
}
