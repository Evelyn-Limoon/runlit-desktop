import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { normalizeVersionTitle, VERSION_TITLE_MAX_UNITS, versionTitleUnits, type Artifact, type Snapshot, type Task, type TaskStatus } from "@runlit/protocol";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ExternalLink, Eye, EyeOff, FileText, FolderOpen, ImagePlus, Link2, Pencil, Plus, PlugZap, Radio, RotateCcw, Settings, Trash2, WifiOff, X } from "lucide-react";
import { getProviderMeta, ProviderMark } from "./provider";
import runlitMarkUrl from "../src-tauri/icons/runlit.svg";

const API = "http://127.0.0.1:47831";
const WS = "ws://127.0.0.1:47831/events";
const SNAPSHOT_POLL_MS = 5_000;
const RECONNECT_DELAY_MS = 1_800;
const ADAPTER_STALE_MS = 20_000;
const ORB_IMAGE_KEY = "runlit.orb-image";
const PANEL_HEIGHT_KEY = "runlit.panel-height";
const PANEL_MIN_HEIGHT = 420;
const PANEL_DEFAULT_HEIGHT = 650;
const MAX_ORB_IMAGE_BYTES = 1024 * 1024;
const ALLOWED_ORB_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function readPanelHeight() {
  try {
    const saved = window.localStorage.getItem(PANEL_HEIGHT_KEY);
    const stored = saved === null ? Number.NaN : Number(saved);
    const screenLimit = Math.max(PANEL_MIN_HEIGHT, window.screen.availHeight - 24);
    return Number.isFinite(stored) ? Math.min(screenLimit, Math.max(PANEL_MIN_HEIGHT, stored)) : Math.min(screenLimit, PANEL_DEFAULT_HEIGHT);
  } catch {
    return PANEL_DEFAULT_HEIGHT;
  }
}

function detailContentMaxHeight(panel: HTMLElement | null) {
  const screenLimit = Math.max(PANEL_MIN_HEIGHT, window.screen.availHeight - 24);
  if (!panel) return screenLimit;
  const topbar = panel.querySelector<HTMLElement>(".topbar")?.offsetHeight ?? 58;
  const content = panel.querySelector<HTMLElement>(".detail-content");
  const resizeHandle = panel.querySelector<HTMLElement>(".panel-resize-handle")?.offsetHeight ?? 14;
  const fullContent = topbar + (content?.scrollHeight ?? PANEL_MIN_HEIGHT) + resizeHandle;
  return Math.max(PANEL_MIN_HEIGHT, Math.min(screenLimit, fullContent));
}

type AdapterStatus = {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
  state: "disabled" | "starting" | "ready" | "unavailable" | "error";
  connectionMode: "app_server" | "local_store" | "hook" | "generic";
  detail?: string;
  dataPath?: string;
  executablePath?: string;
  lastScanAt?: string;
  lastError?: string;
  removable?: boolean;
  capability?: "artifacts_only";
};

type AdapterHealth = {
  label: string;
  title: string;
  tone: "healthy" | "warning" | "offline";
};

function adapterIsFresh(adapter: AdapterStatus, now = Date.now()) {
  if (adapter.state !== "ready" || !adapter.lastScanAt) return false;
  const lastScan = Date.parse(adapter.lastScanAt);
  return Number.isFinite(lastScan) && now - lastScan <= ADAPTER_STALE_MS;
}

function adapterHealth(connected: boolean, adapters: Record<string, AdapterStatus>): AdapterHealth {
  if (!connected) return { label: "等待后台", title: "正在连接 RunLit 本地后台", tone: "offline" };
  const enabled = Object.values(adapters).filter((adapter) => adapter.enabled);
  if (enabled.length === 0) return { label: "后台已连接", title: "RunLit 后台已连接，正在读取 AI 工具状态", tone: "warning" };
  const healthy = enabled.filter((adapter) => adapterIsFresh(adapter));
  if (healthy.length === enabled.length) {
    return { label: `${healthy.length}/${enabled.length} 工具正常`, title: "后台与全部 AI 工具连接正常", tone: "healthy" };
  }
  const failedNames = enabled.filter((adapter) => !adapterIsFresh(adapter)).map((adapter) => adapter.displayName).join("、");
  return { label: `${healthy.length}/${enabled.length} 工具正常`, title: `${failedNames || "AI 工具"} 超过 20 秒未成功检测或连接异常`, tone: "warning" };
}

function formatScanAge(value?: string) {
  if (!value) return "尚未完成检测";
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return "检测时间不可用";
  if (elapsed < 60_000) return `最近检测 ${Math.max(1, Math.round(elapsed / 1_000))} 秒前`;
  return `最近检测 ${Math.round(elapsed / 60_000)} 分钟前`;
}

function isTauri() {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

const statusMeta: Record<TaskStatus, { label: string; short: string }> = {
  running: { label: "进行中", short: "运行" },
  completed: { label: "已完成", short: "完成" },
  stopped_by_user: { label: "手动停止", short: "停止" },
  interrupted: { label: "异常中止", short: "异常" },
  unknown: { label: "状态待确认", short: "未知" },
};

function formatTime(value?: string) {
  if (!value) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(value));
}

async function openTarget(target: string, label: string) {
  try {
    if (isTauri()) {
      await invoke("open_target", { target });
      return;
    }
    if (/^https?:\/\//i.test(target)) window.open(target, "_blank", "noopener,noreferrer");
    else window.alert(`${label}\n\n桌面模式会打开：\n${target}`);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "无法打开该结果");
  }
}

async function openArtifact(artifact: Artifact) {
  await openTarget(artifact.target, artifact.label);
}

function artifactContainerTarget(artifact: Artifact) {
  if (artifact.kind === "directory" || artifact.kind === "url" || artifact.kind === "session") return artifact.target;
  const target = artifact.target.replace(/[\\/]+$/, "");
  const separator = Math.max(target.lastIndexOf("\\"), target.lastIndexOf("/"));
  if (separator < 0) return artifact.target;
  if (separator === 0) return target.slice(0, 1);
  if (separator === 2 && /^[a-z]:[\\/]/i.test(target)) return target.slice(0, 3);
  return target.slice(0, separator);
}

function artifactContainerLabel(artifact: Artifact) {
  return artifact.kind === "url" || artifact.kind === "session" ? "打开成果链接" : "打开成果物所在文件夹";
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ generatedAt: new Date().toISOString(), tasks: [] });
  const [selectedId, setSelectedId] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [adapters, setAdapters] = useState<Record<string, AdapterStatus>>({});
  const [collapsed, setCollapsed] = useState(true);
  const [privateMode, setPrivateMode] = useState(false);
  const [orbImage, setOrbImage] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(ORB_IMAGE_KEY) ?? undefined; }
    catch { return undefined; }
  });
  const [orbMessage, setOrbMessage] = useState<string>();
  const [orbMenu, setOrbMenu] = useState<{ x: number; y: number }>();
  const [taskMenu, setTaskMenu] = useState<{ x: number; y: number; task: Task }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(readPanelHeight);
  const panelHeightRef = useRef(panelHeight);
  const panelRef = useRef<HTMLElement>(null);
  const orbInputRef = useRef<HTMLInputElement>(null);
  const nativeOrbMenuRef = useRef<{ close: () => Promise<void> } | undefined>(undefined);
  const dragStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragInProgress = useRef(false);
  const suppressOrbClickUntil = useRef(0);
  const panelResizeStart = useRef<{ screenY: number; height: number; maxHeight: number; pointerId: number } | undefined>(undefined);
  const pendingPanelHeight = useRef<number | undefined>(undefined);
  const panelResizeFrame = useRef<number | undefined>(undefined);

  const acceptSnapshot = useCallback((next: Snapshot) => {
    setSnapshot(next);
    setSelectedId((current) => current && next.tasks.some((task) => task.id === current) ? current : next.tasks[0]?.id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let adapterPoll: ReturnType<typeof setInterval> | undefined;

    const accept = (next: Snapshot) => {
      if (cancelled) return;
      acceptSnapshot(next);
    };

    const syncSnapshot = async () => {
      try {
        const response = await fetch(`${API}/snapshot`, { cache: "no-store" });
        if ("ok" in response && !response.ok) throw new Error(`Snapshot request failed: ${response.status}`);
        accept(await response.json() as Snapshot);
      } catch {
        // WebSocket health is reported separately. A later poll or reconnect retries the snapshot.
      }
    };

    const syncAdapters = async () => {
      try {
        const response = await fetch(`${API}/adapters`, { cache: "no-store" });
        if ("ok" in response && !response.ok) throw new Error(`Adapter request failed: ${response.status}`);
        const value = await response.json() as Record<string, AdapterStatus>;
        if (!cancelled && value && typeof value === "object" && !Array.isArray(value)) setAdapters(value);
      } catch {
        // Retain the last adapter status so the header can mark it stale after 20 seconds.
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || retry) return;
      retry = setTimeout(() => {
        retry = undefined;
        connect();
      }, RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (cancelled) return;
      let nextSocket: WebSocket;
      try {
        nextSocket = new WebSocket(WS);
      } catch {
        setConnected(false);
        scheduleReconnect();
        return;
      }

      socket = nextSocket;
      nextSocket.onopen = () => {
        if (cancelled || socket !== nextSocket) return;
        setConnected(true);
        void syncSnapshot();
        void syncAdapters();
        adapterPoll ??= setInterval(() => void syncAdapters(), SNAPSHOT_POLL_MS);
      };
      nextSocket.onmessage = (message) => {
        if (cancelled || socket !== nextSocket) return;
        try {
          const event = JSON.parse(message.data as string) as { type: string; payload: Snapshot };
          if (event.type === "snapshot") accept(event.payload);
        } catch {
          // Ignore malformed local events and retain the last valid snapshot.
        }
      };
      nextSocket.onclose = () => {
        if (socket !== nextSocket) return;
        socket = undefined;
        setConnected(false);
        scheduleReconnect();
      };
      nextSocket.onerror = () => nextSocket.close();
    };

    void syncSnapshot();
    connect();
    poll = setInterval(() => void syncSnapshot(), SNAPSHOT_POLL_MS);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      if (adapterPoll) clearInterval(adapterPoll);
      socket?.close();
    };
  }, [acceptSnapshot]);

  useEffect(() => {
    if (!orbMessage) return;
    const timer = window.setTimeout(() => setOrbMessage(undefined), 3_200);
    return () => window.clearTimeout(timer);
  }, [orbMessage]);

  useEffect(() => {
    const closeMenus = () => {
      setOrbMenu(undefined);
      setTaskMenu(undefined);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".orb-context-menu")) closeMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selected = useMemo(() => snapshot.tasks.find((task) => task.id === selectedId), [snapshot, selectedId]);
  const health = adapterHealth(connected, adapters);

  const openAdapterSettings = useCallback(() => {
    setOrbMenu(undefined);
    setTaskMenu(undefined);
    setSettingsOpen(true);
    setCollapsed(false);
    if (isTauri()) void invoke("set_window_mode", { compact: false, height: Math.min(panelHeight, 650) });
  }, [panelHeight]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen("runlit://open-adapter-settings", openAdapterSettings)).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); };
  }, [openAdapterSettings]);

  const setCompact = (compact: boolean, height?: number) => {
    setCollapsed(compact);
    if (isTauri()) void invoke("set_window_mode", { compact, height: compact ? null : height ?? panelHeight });
  };

  useLayoutEffect(() => {
    if (collapsed || settingsOpen || !isTauri()) return;
    const frame = requestAnimationFrame(() => {
      const desiredHeight = Math.min(panelHeight, detailContentMaxHeight(panelRef.current));
      void invoke("resize_expanded_window", { height: desiredHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, panelHeight, privateMode, selectedId, settingsOpen]);

  useEffect(() => () => {
    if (panelResizeFrame.current !== undefined) cancelAnimationFrame(panelResizeFrame.current);
  }, []);

  const requestPanelHeight = (height: number) => {
    panelHeightRef.current = height;
    setPanelHeight(height);
    pendingPanelHeight.current = height;
    if (panelResizeFrame.current !== undefined) return;
    panelResizeFrame.current = requestAnimationFrame(() => {
      const next = pendingPanelHeight.current;
      pendingPanelHeight.current = undefined;
      panelResizeFrame.current = undefined;
      if (next !== undefined && isTauri()) void invoke("resize_expanded_window", { height: next });
    });
  };

  const onPanelResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelResizeStart.current = {
      screenY: event.screenY,
      height: window.innerHeight,
      maxHeight: detailContentMaxHeight(panelRef.current),
      pointerId: event.pointerId,
    };
  };

  const onPanelResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panelResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const next = Math.max(PANEL_MIN_HEIGHT, Math.min(start.maxHeight, start.height + event.screenY - start.screenY));
    requestPanelHeight(Math.round(next));
  };

  const finishPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panelResizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    panelResizeStart.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    try { window.localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeightRef.current)); } catch { /* localStorage may be unavailable */ }
  };

  const onPanelResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const maximum = detailContentMaxHeight(panelRef.current);
    const next = Math.max(PANEL_MIN_HEIGHT, Math.min(maximum, panelHeight + (event.key === "ArrowDown" ? 32 : -32)));
    requestPanelHeight(next);
    try { window.localStorage.setItem(PANEL_HEIGHT_KEY, String(next)); } catch { /* localStorage may be unavailable */ }
  };

  const onDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isTauri() || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-runlit-drag]") || (target.closest("button") && !target.closest(".brand-orb"))) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragInProgress.current = false;
  };

  const onDragPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start || dragInProgress.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    dragInProgress.current = true;
    suppressOrbClickUntil.current = Date.now() + 600;
    void invoke<boolean>("drag_and_snap", { compact: collapsed }).then((becameCompact) => {
      if (becameCompact) setCollapsed(true);
    }).finally(() => {
      dragStart.current = undefined;
      dragInProgress.current = false;
    });
  };

  const onDragPointerUp = () => {
    if (!dragInProgress.current) dragStart.current = undefined;
  };

  const onOrbClick = () => {
    if (Date.now() < suppressOrbClickUntil.current) return;
    setCompact(!collapsed);
  };

  const onOrbImageSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!ALLOWED_ORB_IMAGE_TYPES.has(file.type)) {
      setOrbMessage("仅支持 PNG、JPG 或 WebP 图片");
      input.value = "";
      return;
    }
    if (file.size > MAX_ORB_IMAGE_BYTES) {
      setOrbMessage("图片不能超过 1MB");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      try {
        window.localStorage.setItem(ORB_IMAGE_KEY, reader.result);
        setOrbImage(reader.result);
        setOrbMessage("浮球图片已更新");
      } catch {
        setOrbMessage("图片无法保存到本机");
      }
      input.value = "";
    };
    reader.onerror = () => setOrbMessage("图片读取失败");
    reader.readAsDataURL(file);
  };

  const chooseOrbImage = async () => {
    if (!isTauri()) {
      orbInputRef.current?.click();
      return;
    }

    try {
      const dataUrl = await invoke<string | null>("pick_orb_image");
      if (!dataUrl) return;
      window.localStorage.setItem(ORB_IMAGE_KEY, dataUrl);
      setOrbImage(dataUrl);
      setOrbMessage("浮球图片已更新");
    } catch (error) {
      setOrbMessage(typeof error === "string" ? error : "图片无法保存到本机");
    }
  };

  const resetOrbImage = () => {
    try { window.localStorage.removeItem(ORB_IMAGE_KEY); } catch { /* localStorage may be unavailable */ }
    setOrbImage(undefined);
    setOrbMessage("已恢复默认浮球");
  };

  const refreshRunlit = () => window.location.reload();

  const quitRunlit = async () => {
    if (isTauri()) await invoke("quit_runlit");
    else window.close();
  };

  const showOrbContextMenu = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setTaskMenu(undefined);

    if (isTauri()) {
      try {
        const { Menu } = await import("@tauri-apps/api/menu");
        const menu = await Menu.new({
          items: [
            { text: "RunLit 浮球", enabled: false },
            { item: "Separator" },
            { text: "更换浮球图案…", action: () => void chooseOrbImage() },
            { text: "恢复默认图案", enabled: Boolean(orbImage), action: resetOrbImage },
            { item: "Separator" },
            { text: "PNG / JPG / WebP，最大 1MB", enabled: false },
            { item: "Separator" },
            { text: "AI 工具接入…", action: openAdapterSettings },
            { text: "刷新", action: refreshRunlit },
            { text: "退出 RunLit", action: () => void quitRunlit() },
          ],
        });
        nativeOrbMenuRef.current = menu;
        await menu.popup();
        return;
      } catch {
        // Fall through to the in-app menu if the native menu is unavailable.
      }
    }

    const menuWidth = 208;
    const menuHeight = 260;
    setOrbMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  };

  const showTaskContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, task: Task) => {
    event.preventDefault();
    event.stopPropagation();
    setOrbMenu(undefined);
    const menuWidth = 224;
    const menuHeight = 126;
    setTaskMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      task,
    });
  };

  const hideTaskFromDock = async () => {
    const task = taskMenu?.task;
    setTaskMenu(undefined);
    if (!task) return;
    if (!window.confirm(`从任务灯带删除“${task.title}”？\n\n历史版本和成果物会保留；同一任务再次运行时会自动恢复。`)) return;

    try {
      const response = await fetch(`${API}/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      const result = await response.json() as { hidden?: boolean; snapshot?: Snapshot; error?: string };
      if (("ok" in response && !response.ok) || !result.hidden || !result.snapshot) {
        throw new Error(result.error ?? "删除任务失败");
      }
      acceptSnapshot(result.snapshot);
      setOrbMessage(undefined);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "删除任务失败");
    }
  };

  return (
    <main className={`runlit-shell ${collapsed ? "is-collapsed" : ""}`} onContextMenu={(event) => event.preventDefault()} onPointerDown={onDragPointerDown} onPointerMove={onDragPointerMove} onPointerUp={onDragPointerUp}>
      <input ref={orbInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传浮球图片" onChange={onOrbImageSelected} />
      {!collapsed && (settingsOpen
        ? <AdapterSettingsPanel panelRef={panelRef} onClose={() => setSettingsOpen(false)} />
        : <DetailPanel panelRef={panelRef} task={selected} privateMode={privateMode} health={health} orbMessage={orbMessage} onDismissMessage={() => setOrbMessage(undefined)} onTogglePrivate={() => setPrivateMode((value) => !value)} onOpenSettings={openAdapterSettings} onSnapshot={acceptSnapshot} panelHeight={panelHeight} onResizePointerDown={onPanelResizePointerDown} onResizePointerMove={onPanelResizePointerMove} onResizePointerUp={finishPanelResize} onResizeKeyDown={onPanelResizeKeyDown} />)}
      <aside className="task-dock" aria-label="AI 任务灯条" data-runlit-drag>
        <button className="brand-orb" data-runlit-drag onClick={onOrbClick} onContextMenu={showOrbContextMenu} aria-label="R" aria-expanded={!collapsed} aria-haspopup="menu" title={collapsed ? "左键打开；右键设置浮球" : "左键收起；右键设置浮球"}>
          <span className={`brand-flame ${orbImage ? "has-image" : ""}`}>{orbImage ? <img src={orbImage} alt="自定义浮球" draggable={false} /> : <img className="runlit-mark" src={runlitMarkUrl} alt="" draggable={false} />}</span>
          <ChevronLeft size={14} className="collapse-icon" />
        </button>
        <div className="dock-rule" />
        <div className="task-lights">
          {snapshot.tasks.map((task) => <TaskLight key={task.id} task={task} active={!collapsed && !settingsOpen && task.id === selectedId} privateMode={privateMode} onSelect={() => { setSettingsOpen(false); setSelectedId(task.id); setCompact(false); }} onContextMenu={(event) => showTaskContextMenu(event, task)} />)}
          {snapshot.tasks.length === 0 && <span className="empty-light">···</span>}
        </div>
        <div className={`connection-dot ${connected ? "online" : "offline"}`} title={connected ? "本地 daemon 已连接" : "正在连接本地 daemon"}>
          {connected ? <Radio size={14} /> : <WifiOff size={14} />}
        </div>
      </aside>
      {orbMenu && (
        <div className="orb-context-menu" role="menu" aria-label="RunLit 浮球设置" style={{ left: orbMenu.x, top: orbMenu.y }}>
          <div className="orb-menu-title">RunLit 浮球</div>
          <button role="menuitem" onClick={() => { setOrbMenu(undefined); void chooseOrbImage(); }}><ImagePlus size={15} />更换浮球图案…</button>
          <button role="menuitem" disabled={!orbImage} onClick={() => { setOrbMenu(undefined); resetOrbImage(); }}><RotateCcw size={14} />恢复默认图案</button>
          <div className="orb-menu-note">PNG / JPG / WebP · 最大 1MB</div>
          <button role="menuitem" onClick={openAdapterSettings}><Settings size={14} />AI 工具接入…</button>
          <button role="menuitem" onClick={refreshRunlit}><RotateCcw size={14} />刷新</button>
          <button role="menuitem" onClick={() => void quitRunlit()}>退出 RunLit</button>
        </div>
      )}
      {taskMenu && (
        <div className="orb-context-menu task-context-menu" role="menu" aria-label={`${taskMenu.task.title} 任务菜单`} style={{ left: taskMenu.x, top: taskMenu.y }}>
          <div className="orb-menu-title">{privateMode ? getProviderMeta(taskMenu.task.provider).name : taskMenu.task.title}</div>
          <button className="danger-action" role="menuitem" onClick={() => void hideTaskFromDock()}><Trash2 size={14} />删除任务</button>
          <div className="orb-menu-note">仅从灯带移除，不删除版本和成果物；再次运行时自动恢复。</div>
        </div>
      )}
    </main>
  );
}

function AdapterSettingsPanel({ panelRef, onClose }: { panelRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [adapters, setAdapters] = useState<Record<string, AdapterStatus>>({});
  const [loadingId, setLoadingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [workBuddyPath, setWorkBuddyPath] = useState("");
  const [showAddTool, setShowAddTool] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [newTool, setNewTool] = useState({ displayName: "", provider: "", watchPath: "" });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/adapters`, { cache: "no-store" });
      if (!response.ok) throw new Error(`读取适配器状态失败：${response.status}`);
      const next = await response.json() as Record<string, AdapterStatus>;
      setAdapters(next);
      setWorkBuddyPath((current) => current || next.workbuddy?.dataPath || "");
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取 AI 工具接入状态");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), SNAPSHOT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const refreshAdapter = async (id: string) => {
    setLoadingId(id);
    try {
      const response = await fetch(`${API}/adapters/${id}/refresh`, { method: "POST" });
      const result = await response.json() as { adapters?: Record<string, AdapterStatus>; error?: string };
      if (!response.ok || !result.adapters) throw new Error(result.error ?? "重新检测失败");
      setAdapters(result.adapters);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重新检测失败");
    } finally {
      setLoadingId(undefined);
    }
  };

  const configureWorkBuddy = async () => {
    setLoadingId("workbuddy");
    try {
      const response = await fetch(`${API}/adapters/workbuddy/configure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataPath: workBuddyPath }),
      });
      const result = await response.json() as { configured?: boolean; status?: AdapterStatus; error?: string };
      if (!response.ok || !result.configured || !result.status) throw new Error(result.error ?? "保存 WorkBuddy 路径失败");
      setAdapters((current) => ({ ...current, workbuddy: result.status! }));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存 WorkBuddy 路径失败");
    } finally {
      setLoadingId(undefined);
    }
  };

  const chooseWatchPath = async () => {
    if (!isTauri()) return;
    try {
      const selected = await invoke<string | null>("pick_adapter_folder");
      if (selected) setNewTool((current) => ({ ...current, watchPath: selected }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法选择成果目录");
    }
  };

  const closeEditor = () => {
    setShowAddTool(false);
    setEditingId(undefined);
    setNewTool({ displayName: "", provider: "", watchPath: "" });
  };

  const editAdapter = (adapter: AdapterStatus) => {
    setEditingId(adapter.id);
    setNewTool({ displayName: adapter.displayName, provider: adapter.provider, watchPath: adapter.dataPath ?? "" });
    setShowAddTool(true);
    setError(undefined);
  };

  const saveAdapter = async () => {
    const loadingKey = editingId ?? "new";
    setLoadingId(loadingKey);
    try {
      const response = await fetch(editingId ? `${API}/adapters/${editingId}` : `${API}/adapters`, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "folder_watch",
          displayName: newTool.displayName,
          ...(editingId ? { provider: newTool.provider } : {}),
          watchPath: newTool.watchPath,
        }),
      });
      const result = await response.json() as { created?: boolean; updated?: boolean; status?: AdapterStatus; error?: string };
      if (!response.ok || (!result.created && !result.updated) || !result.status) throw new Error(result.error ?? (editingId ? "更新 AI 工具失败" : "新增 AI 工具失败"));
      setAdapters((current) => ({ ...current, [result.status!.id]: result.status! }));
      closeEditor();
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : editingId ? "更新 AI 工具失败" : "新增 AI 工具失败");
    } finally {
      setLoadingId(undefined);
    }
  };

  const removeAdapter = async (adapter: AdapterStatus) => {
    if (!window.confirm(`移除“${adapter.displayName}”的接入？\n\n将停止监控，但保留已经记录的任务、版本和成果物。`)) return;
    setLoadingId(adapter.id);
    try {
      const response = await fetch(`${API}/adapters/${adapter.id}`, { method: "DELETE" });
      const result = await response.json() as { removed?: boolean; adapters?: Record<string, AdapterStatus>; error?: string };
      if (!response.ok || !result.removed || !result.adapters) throw new Error(result.error ?? "移除 AI 工具失败");
      setAdapters(result.adapters);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "移除 AI 工具失败");
    } finally {
      setLoadingId(undefined);
    }
  };

  return (
    <section className="detail-panel settings-panel" ref={panelRef}>
      <header className="topbar" data-runlit-drag>
        <button className="settings-back" onClick={onClose}><ChevronLeft size={16} />返回任务</button>
        <div className="wordmark"><span className="wordmark-dot" /> AI 工具接入</div>
      </header>
      <div className="settings-content">
        <div className="adapter-page-actions">
          <button className="add-adapter-button" onClick={() => { if (showAddTool && !editingId) closeEditor(); else { setEditingId(undefined); setNewTool({ displayName: "", provider: "", watchPath: "" }); setShowAddTool(true); } }} aria-expanded={showAddTool}><Plus size={14} />添加 AI 工具</button>
        </div>
        <div className="settings-intro">
          <PlugZap size={22} />
          <div><h1>自动发现，必要时手动校准</h1><p>内置连接可读取任务状态和成果证据；手动添加的工具只监控指定成果目录。RunLit 不保存聊天正文。</p></div>
        </div>
        {error && <div className="settings-error" role="alert">{error}</div>}
        {showAddTool && (
          <section className="add-adapter-form" aria-label="添加 AI 工具">
            <div className="add-adapter-heading"><strong>{editingId ? "修改 AI 工具接入" : "添加本地 AI 工具"}</strong><span>{editingId ? "修复名称或成果目录" : "无需写代码的快速接入"}</span></div>
            <label htmlFor="new-tool-name">工具名称</label>
            <input id="new-tool-name" value={newTool.displayName} onChange={(event) => setNewTool((current) => ({ ...current, displayName: event.target.value }))} placeholder="例如 Kimi、通义灵码" />
            <label htmlFor="new-tool-path">本地成果目录</label>
            <div className="folder-field"><input id="new-tool-path" value={newTool.watchPath} onChange={(event) => setNewTool((current) => ({ ...current, watchPath: event.target.value }))} placeholder="选择该工具会写入成果的具体文件夹" /><button type="button" onClick={() => void chooseWatchPath()}><FolderOpen size={13} />选择</button></div>
            <p>首次连接或更换目录只建立文件基线，不导入旧文件。之后新增或修改的文件会在停止写入约 6 秒后合并为一个版本；请使用专门的成果目录，避免把人工编辑或编译输出误认为 AI 成果。</p>
            <div className="add-adapter-actions"><button type="button" className="secondary" onClick={closeEditor}>取消</button><button type="button" onClick={() => void saveAdapter()} disabled={!newTool.displayName.trim() || !newTool.watchPath.trim() || loadingId === (editingId ?? "new")}>{loadingId === (editingId ?? "new") ? "正在保存" : editingId ? "保存修改" : "保存并开始监控"}</button></div>
          </section>
        )}
        <div className="adapter-list">
          {Object.values(adapters).map((adapter) => (
            <article className="adapter-card" key={adapter.id}>
              <div className="adapter-mark"><ProviderMark provider={adapter.provider} /></div>
              <div className="adapter-main">
                <div className="adapter-title"><strong>{adapter.displayName}</strong><span className={`adapter-state state-${adapter.state}`}>{adapterStateLabel(adapter)}</span><span className={`capability-chip ${adapter.capability === "artifacts_only" ? "limited" : "full"}`}>{adapter.capability === "artifacts_only" ? "仅成果目录" : "完整任务状态"}</span></div>
                <p>{adapter.detail ?? adapterModeLabel(adapter.connectionMode)}</p>
                <code>{adapter.dataPath ?? adapter.executablePath ?? "等待自动发现安装位置"}</code>
                <div className={`adapter-scan ${adapterIsFresh(adapter) ? "fresh" : "stale"}`}>{formatScanAge(adapter.lastScanAt)}</div>
                {adapter.id === "workbuddy" && adapter.state !== "ready" && (
                  <div className="manual-path">
                    <label htmlFor="workbuddy-data-path">WorkBuddy 数据目录</label>
                    <div><input id="workbuddy-data-path" value={workBuddyPath} onChange={(event) => setWorkBuddyPath(event.target.value)} placeholder="例如 C:\\Users\\你的用户名\\.workbuddy-ai" /><button onClick={() => void configureWorkBuddy()} disabled={!workBuddyPath.trim() || loadingId === adapter.id}>保存并连接</button></div>
                  </div>
                )}
                {adapter.lastError && <div className="adapter-error">{adapter.lastError}</div>}
              </div>
              <div className="adapter-actions">
                <button className="adapter-refresh" onClick={() => void refreshAdapter(adapter.id)} disabled={loadingId === adapter.id}><RotateCcw size={13} />{loadingId === adapter.id ? "检测中" : "重新检测"}</button>
                {adapter.removable && <button className="adapter-edit" aria-label={`编辑 ${adapter.displayName}`} onClick={() => editAdapter(adapter)} disabled={loadingId === adapter.id}><Pencil size={13} /></button>}
                {adapter.removable && <button className="adapter-remove" aria-label={`移除 ${adapter.displayName}`} onClick={() => void removeAdapter(adapter)} disabled={loadingId === adapter.id}><Trash2 size={13} /></button>}
              </div>
            </article>
          ))}
        </div>
        <aside className="adapter-guide">
          <strong>尚未内置的 AI 工具</strong>
          <p>会输出本地文件的工具可点击上方“添加 AI 工具”直接接入。需要精确识别开始、进行中和完成状态时，使用专用 Adapter；RunLit 不会仅凭进程存在伪造任务。</p>
        </aside>
      </div>
    </section>
  );
}

function adapterStateLabel(adapter: AdapterStatus) {
  if (adapter.state === "ready" && adapter.capability === "artifacts_only") return "监控中";
  return ({ disabled: "已关闭", starting: "正在连接", ready: "已连接", unavailable: "未发现", error: "连接异常" } as const)[adapter.state];
}

function adapterModeLabel(mode: AdapterStatus["connectionMode"]) {
  return ({ app_server: "通过官方本地服务读取", local_store: "通过本地会话索引读取", hook: "通过生命周期 Hook 接入", generic: "使用通用识别规则" } as const)[mode];
}

function TaskLight({ task, active, privateMode, onSelect, onContextMenu }: { task: Task; active: boolean; privateMode: boolean; onSelect: () => void; onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void }) {
  const currentVersion = task.versions.at(-1)?.ordinal ?? 0;
  return (
    <button className={`task-light status-${task.status} ${active ? "active" : ""}`} onClick={onSelect} onContextMenu={onContextMenu} title={privateMode ? getProviderMeta(task.provider).name : `${task.title} · ${statusMeta[task.status].label}`}>
      <span className="light-ring"><ProviderMark provider={task.provider} /></span>
      <span className="version-badge">v{currentVersion}</span>
      <span className="sr-only">{privateMode ? "已隐藏任务" : task.title}</span>
    </button>
  );
}

function VersionSummaryEditor({ version, privateMode, onSnapshot }: { version: Task["versions"][number]; privateMode: boolean; onSnapshot: (snapshot: Snapshot) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(version.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const units = versionTitleUnits(draft.trim());
  const valid = Boolean(draft.trim()) && units <= VERSION_TITLE_MAX_UNITS;

  useEffect(() => {
    if (!editing) setDraft(version.summary);
  }, [editing, version.summary]);

  const cancel = () => {
    setEditing(false);
    setDraft(version.summary);
    setError(undefined);
  };

  const save = async () => {
    if (saving) return;
    try {
      const summary = normalizeVersionTitle(draft);
      setSaving(true);
      const response = await fetch(`${API}/versions/${encodeURIComponent(version.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary }),
      });
      const result = await response.json() as { updated?: boolean; snapshot?: Snapshot; error?: string };
      if (("ok" in response && !response.ok) || !result.updated || !result.snapshot) {
        throw new Error(result.error ?? "版本标题更新失败");
      }
      onSnapshot(result.snapshot);
      setEditing(false);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本标题更新失败");
    } finally {
      setSaving(false);
    }
  };

  if (privateMode) return <div className="version-summary-row"><p>版本内容已隐藏</p></div>;

  if (!editing) {
    return (
      <div className="version-summary-row">
        <p>{version.summary}</p>
        <button className="version-rename-button" type="button" aria-label={`重命名 v${version.ordinal} 的版本信息`} title="重命名版本信息" onClick={() => { setDraft(version.summary); setEditing(true); setError(undefined); }}><Pencil size={13} strokeWidth={1.8} /></button>
      </div>
    );
  }

  return (
    <div className="version-summary-editor">
      <div className="version-title-input-row">
        <input
          autoFocus
          aria-label={`编辑 v${version.ordinal} 的版本信息`}
          aria-invalid={!valid}
          maxLength={VERSION_TITLE_MAX_UNITS}
          value={draft}
          onChange={(event) => { setDraft(event.currentTarget.value); setError(undefined); }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancel();
            if (event.key === "Enter" && !event.nativeEvent.isComposing && valid) void save();
          }}
        />
        <button className="version-edit-action save" type="button" aria-label={`保存 v${version.ordinal} 的版本信息`} title="保存（Enter）" disabled={!valid || saving} onClick={() => void save()}><Check size={13} /></button>
        <button className="version-edit-action" type="button" aria-label={`取消编辑 v${version.ordinal}`} title="取消（Esc）" disabled={saving} onClick={cancel}><X size={13} /></button>
      </div>
      <div className={`version-title-help ${units > VERSION_TITLE_MAX_UNITS ? "over-limit" : ""} ${error ? "has-error" : ""}`}><span>{error ?? "中文约 40 字 / 英文 80 字"}</span><span>{units}/{VERSION_TITLE_MAX_UNITS}</span></div>
    </div>
  );
}

type DetailPanelProps = {
  panelRef: RefObject<HTMLElement | null>;
  task?: Task;
  privateMode: boolean;
  health: AdapterHealth;
  orbMessage?: string;
  onDismissMessage: () => void;
  onTogglePrivate: () => void;
  onOpenSettings: () => void;
  onSnapshot: (snapshot: Snapshot) => void;
  panelHeight: number;
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

function DetailPanel({ panelRef, task, privateMode, health, orbMessage, onDismissMessage, onTogglePrivate, onOpenSettings, onSnapshot, panelHeight, onResizePointerDown, onResizePointerMove, onResizePointerUp, onResizeKeyDown }: DetailPanelProps) {
  const [showAllVersions, setShowAllVersions] = useState(false);
  useEffect(() => setShowAllVersions(false), [task?.id]);
  const versions = useMemo(() => [...(task?.versions ?? [])].reverse(), [task?.versions]);
  const visibleVersions = showAllVersions ? versions : versions.slice(0, 3);
  const hiddenVersionCount = Math.max(0, versions.length - visibleVersions.length);

  return (
    <section className="detail-panel" ref={panelRef}>
      <header className="topbar" data-runlit-drag>
        <div className="wordmark"><span className="wordmark-dot" /> RUNLIT</div>
        <div className="top-actions">
          <span className={`live-label ${health.tone}`} title={health.title}>{health.label}</span>
          <button className="icon-button" onClick={onTogglePrivate} title={privateMode ? "显示任务标题" : "隐藏任务标题"}>{privateMode ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        </div>
        {orbMessage && <span className="orb-feedback" role="status">{orbMessage}<button type="button" onClick={onDismissMessage} aria-label="关闭提示"><X size={12} /></button></span>}
      </header>
      {task ? (
        <div className="detail-content">
          <div className="task-heading">
            <div className={`heading-mark status-${task.status}`}><ProviderMark provider={task.provider} /></div>
            <div className="heading-copy">
              <p className="eyebrow">{getProviderMeta(task.provider).name} · {statusMeta[task.status].label}</p>
              <h1>{privateMode ? "任务标题已隐藏" : task.title}</h1>
              <p className="task-meta">最近活动 {formatTime(task.lastActivityAt)} · {task.versions.length} 个版本节点</p>
            </div>
            {(task.sourceLink || task.projectPath) && <button className="source-action" onClick={() => void openTarget(task.sourceLink ?? task.projectPath!, "打开任务来源")}><ExternalLink size={12} />{task.sourceLink ? "打开来源" : "打开项目"}</button>}
          </div>
          <div className="section-label"><span>迭代脉络</span><span className="evidence">来源可追溯</span></div>
          <div className="version-tree">
            {visibleVersions.map((version) => {
              const primaryArtifact = version.artifacts[0];
              const versionTarget = primaryArtifact ? artifactContainerTarget(primaryArtifact) : task.projectPath ?? task.sourceLink;
              const versionTargetLabel = primaryArtifact ? artifactContainerLabel(primaryArtifact) : "未关联独立结果，打开项目目录";
              const versionOpenText = primaryArtifact
                ? primaryArtifact.kind === "url" || primaryArtifact.kind === "session" ? "打开链接" : "打开文件夹"
                : "打开项目";
              return (
              <article className="version-node" key={version.id}>
                <div className="node-rail"><span className={version.id === task.versions.at(-1)?.id ? "current" : ""}>{version.ordinal}</span></div>
                <div className="node-card">
                  <div className="node-topline"><strong>v{version.ordinal}</strong><span>{formatTime(version.createdAt)}</span></div>
                  <VersionSummaryEditor version={version} privateMode={privateMode} onSnapshot={onSnapshot} />
                  <div className="node-actions"><span className="source-chip">{sourceLabel(version.source)}</span>{versionTarget && <button className="version-open-button" title={versionTargetLabel} onClick={() => void openTarget(versionTarget, versionTargetLabel)}><FolderOpen size={11} />{versionOpenText}</button>}</div>
                  {version.artifacts.length > 0 && <div className="artifacts">{version.artifacts.map((artifact) => <ArtifactButton artifact={artifact} key={artifact.id} />)}</div>}
                </div>
              </article>
            )})}
          </div>
          {versions.length > 3 && <button className="history-toggle" onClick={() => setShowAllVersions((current) => !current)}>{showAllVersions ? "收起历史版本" : `查看更早 ${hiddenVersionCount} 个版本`}</button>}
          {task.versions.length === 0 && <div className="empty-state">尚未识别到版本证据</div>}
          <footer className="task-footer">
            <div><span>状态依据</span><strong>{statusEvidence(task)}</strong></div>
            {task.projectPath && <button className="footer-link" onClick={() => void openTarget(task.projectPath!, "打开项目目录")}><span>项目</span><strong>{privateMode ? "路径已隐藏" : compactPath(task.projectPath)}</strong><ExternalLink size={12} /></button>}
          </footer>
        </div>
      ) : <div className="empty-state large"><strong>{health.tone === "offline" ? "RunLit 后台尚未连接" : "还没有符合条件的成果物任务"}</strong><span>{health.tone === "offline" ? "后台恢复后会自动同步，无需手动刷新。" : "先连接正在使用的 AI 工具，产生本地成果后任务会自动亮起。"}</span><button onClick={onOpenSettings}><Settings size={13} />连接 AI 工具</button></div>}
      <div
        className="panel-resize-handle"
        role="separator"
        aria-label="调整任务详情高度"
        aria-orientation="horizontal"
        aria-valuemin={PANEL_MIN_HEIGHT}
        aria-valuemax={Math.max(PANEL_MIN_HEIGHT, window.screen.availHeight - 24)}
        aria-valuenow={Math.round(panelHeight)}
        tabIndex={0}
        title="向下拖动展开；向上拖动收起"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onKeyDown={onResizeKeyDown}
      ><span /></div>
    </section>
  );
}

function ArtifactButton({ artifact }: { artifact: Artifact }) {
  const Icon = artifact.kind === "directory" ? FolderOpen : artifact.kind === "url" || artifact.kind === "session" ? Link2 : FileText;
  return <button className="artifact-button" onClick={(event) => { event.stopPropagation(); void openArtifact(artifact); }}><Icon size={14} /><span>{artifact.label}</span>{artifact.confidence === "candidate" && <em>候选</em>}<ExternalLink size={12} /></button>;
}

function sourceLabel(source: Task["versions"][number]["source"]) {
  return ({ prompt: "初始指令", follow_up: "追加要求", plan: "计划变更", result: "结果快照", manual: "手动记录" } as const)[source];
}

function statusEvidence(task: Task) {
  if (task.status === "running") return "会话仍有活动";
  if (task.status === "completed") return "工具明确正常结束";
  if (task.status === "stopped_by_user") return "记录到用户终止";
  if (task.status === "interrupted") return "进程异常退出";
  return "缺少可靠结束信号";
}

function compactPath(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
}
