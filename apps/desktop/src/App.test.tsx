import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  close = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    MockWebSocket.instances.push(this);
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  window.localStorage.clear();
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => Promise.resolve({ generatedAt: new Date().toISOString(), tasks: [] }) }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("automatically refreshes the task lights when the local snapshot changes", async () => {
  vi.useFakeTimers();
  const emptySnapshot = { generatedAt: "2026-09-04T09:00:00.000Z", tasks: [] };
  const updatedSnapshot = {
    generatedAt: "2026-09-04T09:00:05.000Z",
    tasks: [{
      id: "task-auto",
      provider: "codex",
      title: "自动出现的新任务",
      projectPath: "C:\\work\\runlit",
      status: "running",
      versions: [],
    }],
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce({ json: () => Promise.resolve(emptySnapshot) } as Response)
    .mockResolvedValue({ json: () => Promise.resolve(updatedSnapshot) } as Response);

  render(<App />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.queryByTitle(/自动出现的新任务/)).not.toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByTitle("自动出现的新任务 · 进行中")).toBeInTheDocument();
});

test("pulls the latest snapshot immediately after a WebSocket reconnect", async () => {
  vi.useFakeTimers();
  const emptySnapshot = { generatedAt: "2026-09-04T09:00:00.000Z", tasks: [] };
  const updatedSnapshot = {
    generatedAt: "2026-09-04T09:00:02.000Z",
    tasks: [{
      id: "task-reconnect",
      provider: "codex",
      title: "重连后出现的新任务",
      projectPath: "C:\\work\\runlit",
      status: "completed",
      versions: [],
    }],
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce({ json: () => Promise.resolve(emptySnapshot) } as Response)
    .mockResolvedValueOnce({ json: () => Promise.resolve(emptySnapshot) } as Response)
    .mockResolvedValue({ json: () => Promise.resolve(updatedSnapshot) } as Response);

  render(<App />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => MockWebSocket.instances[0]!.onopen?.());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => MockWebSocket.instances[0]!.onclose?.());
  act(() => vi.advanceTimersByTime(1_800));
  expect(MockWebSocket.instances).toHaveLength(2);

  act(() => MockWebSocket.instances[1]!.onopen?.());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByTitle("重连后出现的新任务 · 已完成")).toBeInTheDocument();
});

test("starts as a floating ball and expands without inventing progress", async () => {
  render(<App />);
  expect(screen.queryByText("RUNLIT")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  expect(await screen.findByText("RUNLIT")).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});

test("deletes a task light through its right-click menu while preserving recovery semantics", async () => {
  const task = {
    id: "task:codex:session-delete",
    provider: "codex",
    providerSessionId: "session-delete",
    title: "需要暂时删除的任务",
    projectPath: "C:\\work\\runlit",
    status: "completed",
    versions: [],
  };
  vi.mocked(fetch)
    .mockResolvedValueOnce({ json: () => Promise.resolve({ generatedAt: "2026-09-05T01:00:00.000Z", tasks: [task] }) } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ hidden: true, snapshot: { generatedAt: "2026-09-05T01:01:00.000Z", tasks: [] } }),
    } as Response);
  vi.spyOn(window, "confirm").mockReturnValue(true);

  render(<App />);
  const light = await screen.findByTitle("需要暂时删除的任务 · 已完成");
  fireEvent.contextMenu(light, { clientX: 300, clientY: 120 });

  expect(screen.getByRole("menu", { name: "需要暂时删除的任务 任务菜单" })).toBeInTheDocument();
  expect(screen.getByText("仅从灯带移除，不删除版本和成果物；再次运行时自动恢复。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "删除任务" }));

  await waitFor(() => expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:47831/tasks/task%3Acodex%3Asession-delete",
    { method: "DELETE" },
  ));
  expect(screen.queryByTitle("需要暂时删除的任务 · 已完成")).not.toBeInTheDocument();
  expect(screen.queryByText("任务已从灯带删除；再次运行时会自动恢复")).not.toBeInTheDocument();
});

test("opens the project directory when a version has no separate artifact", async () => {
  vi.mocked(fetch).mockResolvedValue({
    json: () => Promise.resolve({
      generatedAt: "2026-09-04T01:00:00.000Z",
      tasks: [{
        id: "task-1",
        provider: "codex",
        title: "竞品简报排版",
        projectPath: "C:\\work\\runlit",
        status: "completed",
        versions: [{ id: "v0", taskId: "task-1", ordinal: 0, summary: "初始任务：竞品简报排版", source: "prompt", createdAt: "2026-09-04T01:00:00.000Z", artifacts: [] }],
      }],
    }),
  } as Response);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  await screen.findByText("初始任务：竞品简报排版");
  expect(screen.getAllByRole("img", { name: "Codex" }).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByTitle("未关联独立结果，打开项目目录"));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining("C:\\work\\runlit"));
});

test("opens the artifact folder from the version action and the file from its named row", async () => {
  vi.mocked(fetch).mockResolvedValue({
    json: () => Promise.resolve({
      generatedAt: "2026-09-04T09:54:00.000Z",
      tasks: [{
        id: "task-artifact-actions",
        provider: "codex",
        title: "编写项目开发复盘日志",
        projectPath: "C:\\work\\runlit",
        status: "completed",
        versions: [{
          id: "version-artifact-actions",
          taskId: "task-artifact-actions",
          ordinal: 0,
          summary: "已确认成果物：开发日志_2026-09-04.md",
          source: "result",
          createdAt: "2026-09-04T09:54:00.000Z",
          artifacts: [{
            id: "artifact-development-log",
            versionId: "version-artifact-actions",
            kind: "markdown",
            label: "开发日志_2026-09-04.md",
            target: "C:\\work\\runlit\\开发日志_2026-09-04.md",
            confidence: "confirmed",
          }],
        }],
      }],
    }),
  } as Response);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));

  fireEvent.click(await screen.findByText("打开文件夹"));
  expect(alert).toHaveBeenLastCalledWith(expect.stringContaining("C:\\work\\runlit"));
  expect(alert).not.toHaveBeenLastCalledWith(expect.stringContaining("开发日志_2026-09-04.md"));

  fireEvent.click(screen.getByRole("button", { name: "开发日志_2026-09-04.md" }));
  expect(alert).toHaveBeenLastCalledWith(expect.stringContaining("C:\\work\\runlit\\开发日志_2026-09-04.md"));
});

test("uses a local image under 1MB as the floating ball", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  fireEvent.change(screen.getByLabelText("上传浮球图片"), {
    target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "orb.png", { type: "image/png" })] },
  });
  expect(await screen.findByRole("img", { name: "自定义浮球" })).toBeInTheDocument();
  expect(window.localStorage.getItem("runlit.orb-image")).toMatch(/^data:image\/png;base64,/);
});

test("moves floating ball settings into the orb right-click menu", () => {
  render(<App />);
  const orb = screen.getByRole("button", { name: "R" });
  fireEvent.contextMenu(orb, { clientX: 30, clientY: 30 });

  expect(screen.getByRole("menu", { name: "RunLit 浮球设置" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "更换浮球图案…" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "恢复默认图案" })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: "AI 工具接入…" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "刷新" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "退出 RunLit" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "更换浮球图片" })).not.toBeInTheDocument();
});

test("opens the AI adapter settings from the orb menu and shows live adapter state", async () => {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/adapters")) return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        codex: { id: "codex", provider: "codex", displayName: "Codex", enabled: true, state: "ready", connectionMode: "app_server", executablePath: "C:\\Apps\\codex.exe" },
        workbuddy: { id: "workbuddy", provider: "workbuddy", displayName: "WorkBuddy AI", enabled: true, state: "ready", connectionMode: "local_store", dataPath: "C:\\Users\\tester\\.workbuddy-ai" },
      }),
    } as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ generatedAt: new Date().toISOString(), tasks: [] }) } as Response);
  });

  render(<App />);
  const orb = screen.getByRole("button", { name: "R" });
  fireEvent.contextMenu(orb, { clientX: 30, clientY: 30 });
  fireEvent.click(screen.getByRole("menuitem", { name: "AI 工具接入…" }));

  expect(await screen.findByRole("heading", { name: "自动发现，必要时手动校准" })).toBeInTheDocument();
  expect(screen.getByText("WorkBuddy AI")).toBeInTheDocument();
  expect(screen.getAllByText("已连接")).toHaveLength(2);
  expect(screen.getByText("C:\\Users\\tester\\.workbuddy-ai")).toBeInTheDocument();
});

test("adds a new AI tool from the visible folder-monitoring form", async () => {
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = String(input);
    if (url.endsWith("/adapters") && init?.method === "POST") return Promise.resolve({
      ok: true,
      status: 201,
      json: () => Promise.resolve({
        created: true,
        status: { id: "custom-kimi", provider: "kimi", displayName: "Kimi", enabled: true, state: "ready", connectionMode: "generic", dataPath: "C:\\outputs", removable: true },
      }),
    } as Response);
    if (url.endsWith("/adapters")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ generatedAt: new Date().toISOString(), tasks: [] }) } as Response);
  });

  render(<App />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "R" }), { clientX: 30, clientY: 30 });
  fireEvent.click(screen.getByRole("menuitem", { name: "AI 工具接入…" }));
  fireEvent.click(await screen.findByRole("button", { name: "添加 AI 工具" }));

  fireEvent.change(screen.getByLabelText("工具名称"), { target: { value: "Kimi" } });
  fireEvent.change(screen.getByLabelText("本地成果目录"), { target: { value: "C:\\outputs" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并开始监控" }));

  expect(await screen.findByText("Kimi")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:47831/adapters", expect.objectContaining({ method: "POST" }));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/adapters") && init?.method === "POST")?.[1]?.body))).toEqual(expect.objectContaining({ displayName: "Kimi", watchPath: "C:\\outputs" }));
  expect(screen.queryByLabelText("Provider ID")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "添加 AI 工具" })).not.toBeInTheDocument();
});

test("shows adapter health instead of treating the daemon connection as provider health", async () => {
  const now = new Date().toISOString();
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/adapters")) return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        codex: { id: "codex", provider: "codex", displayName: "Codex", enabled: true, state: "ready", connectionMode: "app_server", lastScanAt: now },
        workbuddy: { id: "workbuddy", provider: "workbuddy", displayName: "WorkBuddy AI", enabled: true, state: "error", connectionMode: "local_store", lastScanAt: now, lastError: "index unavailable" },
      }),
    } as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ generatedAt: now, tasks: [] }) } as Response);
  });

  render(<App />);
  act(() => MockWebSocket.instances[0]!.onopen?.());
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  await waitFor(() => expect(screen.getByText("1/2 工具正常")).toBeInTheDocument());
  expect(screen.queryByText("本地实时")).not.toBeInTheDocument();
  expect(screen.getByText("1/2 工具正常")).toHaveAttribute("title", expect.stringContaining("WorkBuddy AI"));
});

test("shows the newest three versions first and reveals older history on demand", async () => {
  const versions = Array.from({ length: 6 }, (_, ordinal) => ({
    id: `v${ordinal}`, taskId: "task-history", ordinal, summary: `版本内容 ${ordinal}`,
    source: "result", createdAt: `2026-09-04T0${ordinal}:00:00.000Z`, artifacts: [],
  }));
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve({
    generatedAt: new Date().toISOString(),
    tasks: [{ id: "task-history", provider: "codex", title: "长期任务", projectPath: "C:\\work", status: "completed", versions }],
  }) } as Response);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  expect(await screen.findByText("版本内容 5")).toBeInTheDocument();
  expect(screen.getByText("版本内容 3")).toBeInTheDocument();
  expect(screen.queryByText("版本内容 2")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看更早 3 个版本" }));
  expect(screen.getByText("版本内容 0")).toBeInTheDocument();
});

test("offers AI tool setup directly from the empty task state", async () => {
  vi.mocked(fetch).mockImplementation((input) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(input).endsWith("/adapters") ? {} : { generatedAt: new Date().toISOString(), tasks: [] }) } as Response));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  fireEvent.click(await screen.findByRole("button", { name: "连接 AI 工具" }));
  expect(await screen.findByRole("heading", { name: "自动发现，必要时手动校准" })).toBeInTheDocument();
});

test("edits an existing folder connection without exposing its internal provider id", async () => {
  const custom = { id: "custom-kimi", provider: "kimi", displayName: "Kimi", enabled: true, state: "error", connectionMode: "generic", dataPath: "C:\\old", removable: true, capability: "artifacts_only", lastError: "成果目录不存在" };
  vi.mocked(fetch).mockImplementation((input, init) => {
    const url = String(input);
    if (url.endsWith("/adapters/custom-kimi") && init?.method === "PUT") return Promise.resolve({ ok: true, json: () => Promise.resolve({ updated: true, status: { ...custom, state: "ready", dataPath: "C:\\new", lastError: undefined } }) } as Response);
    if (url.endsWith("/adapters")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ "custom-kimi": custom }) } as Response);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ generatedAt: new Date().toISOString(), tasks: [] }) } as Response);
  });

  render(<App />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "R" }), { clientX: 30, clientY: 30 });
  fireEvent.click(screen.getByRole("menuitem", { name: "AI 工具接入…" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑 Kimi" }));
  expect(screen.queryByLabelText("Provider ID")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("本地成果目录"), { target: { value: "C:\\new" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:47831/adapters/custom-kimi", expect.objectContaining({ method: "PUT" })));
});

test("closes in-app menus with Escape", () => {
  render(<App />);
  const orb = screen.getByRole("button", { name: "R" });
  fireEvent.contextMenu(orb, { clientX: 30, clientY: 30 });
  expect(screen.getByRole("menu", { name: "RunLit 浮球设置" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "RunLit 浮球设置" })).not.toBeInTheDocument();
});

test("suppresses the WebView browser context menu", () => {
  const { container } = render(<App />);
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  const accepted = container.querySelector("main")!.dispatchEvent(event);
  expect(accepted).toBe(false);
});

test("rejects a floating ball image larger than 1MB", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  fireEvent.change(screen.getByLabelText("上传浮球图片"), {
    target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], "large.png", { type: "image/png" })] },
  });
  expect(await screen.findByRole("status")).toHaveTextContent("图片不能超过 1MB");
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("runlit.orb-image")).toBeNull();
});

test("automatically clears transient floating-ball feedback", () => {
  vi.useFakeTimers();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "R" }));
  fireEvent.change(screen.getByLabelText("上传浮球图片"), {
    target: { files: [new File([new Uint8Array(1024 * 1024 + 1)], "large.png", { type: "image/png" })] },
  });
  expect(screen.getByRole("status")).toHaveTextContent("图片不能超过 1MB");

  act(() => vi.advanceTimersByTime(3_200));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
