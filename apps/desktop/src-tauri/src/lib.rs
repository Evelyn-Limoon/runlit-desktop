use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

const BALL_SIZE: f64 = 52.0;
const PANEL_WIDTH: f64 = 520.0;
const PANEL_MIN_HEIGHT: f64 = 420.0;
const EDGE_MARGIN: i32 = 12;
const MAX_ORB_IMAGE_BYTES: u64 = 1024 * 1024;

fn should_snap_to_edge(compact: bool, near_edge: bool) -> bool {
    !compact && near_edge
}

fn clamp_panel_height(requested: f64, available: f64) -> f64 {
    requested.clamp(PANEL_MIN_HEIGHT, available.max(PANEL_MIN_HEIGHT))
}

#[tauri::command]
fn pick_orb_image() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("选择 RunLit 浮球图案")
        .add_filter("图片", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
    else {
        return Ok(None);
    };

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_ORB_IMAGE_BYTES {
        return Err("图片不能超过 1MB".into());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "无法识别图片格式".to_string())?;
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err("仅支持 PNG、JPG 或 WebP 图片".into()),
    };
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(Some(format!(
        "data:{mime};base64,{}",
        STANDARD.encode(bytes)
    )))
}

#[tauri::command]
fn pick_adapter_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择 AI 工具的本地成果目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_target(target: String) -> Result<(), String> {
    let is_web = target.starts_with("https://") || target.starts_with("http://");
    if !is_web && !Path::new(&target).exists() {
        return Err("结果文件已不存在或路径不可访问".into());
    }

    #[cfg(target_os = "windows")]
    let mut command = if is_web {
        let mut cmd = Command::new("rundll32.exe");
        cmd.arg("url.dll,FileProtocolHandler").arg(&target);
        cmd
    } else {
        let mut cmd = Command::new("explorer.exe");
        cmd.arg(&target);
        cmd
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&target);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&target);
        cmd
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_runlit(app: AppHandle) {
    exit_runlit(&app);
}

fn exit_runlit(app: &AppHandle) {
    stop_daemon();
    app.exit(0);
}

fn stop_daemon() {
    let address = SocketAddr::from(([127, 0, 0, 1], 47831));
    if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
        let _ = stream.write_all(
            b"POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:47831\r\nOrigin: http://tauri.localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
    }
}

fn runlit_daemon_is_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 47831));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:47831\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.contains("\"service\":\"runlit-daemon\"")
}

fn start_bundled_daemon(app: &AppHandle) -> Result<(), String> {
    if runlit_daemon_is_ready() {
        return Ok(());
    }

    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let node = resource_dir.join("resources/runtime/node.exe");
    let daemon = resource_dir.join("resources/daemon/runlit-daemon.cjs");
    if !node.is_file() || !daemon.is_file() {
        return Err(format!(
            "RunLit daemon runtime is missing from the application resources: {}",
            resource_dir.display()
        ));
    }

    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let log_dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let daemon_log_path = log_dir.join("daemon.log");
    let daemon_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&daemon_log_path)
        .map_err(|error| error.to_string())?;
    let daemon_error_log = daemon_log.try_clone().map_err(|error| error.to_string())?;

    let daemon_directory = daemon
        .parent()
        .ok_or_else(|| "RunLit daemon resource has no parent directory".to_string())?;
    let daemon_file = daemon
        .file_name()
        .ok_or_else(|| "RunLit daemon resource has no file name".to_string())?;
    let mut command = Command::new(node);
    command
        .arg(daemon_file)
        .current_dir(daemon_directory)
        .env("RUNLIT_DATA_DIR", data_dir)
        .env("RUNLIT_MODE", "normal")
        .stdin(Stdio::null())
        .stdout(Stdio::from(daemon_log))
        .stderr(Stdio::from(daemon_error_log));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;

    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if runlit_daemon_is_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    Err(format!(
        "RunLit daemon did not become ready after the bundled runtime started; see {}",
        daemon_log_path.display()
    ))
}

fn record_startup_error(app: &AppHandle, error: &str) {
    if let Ok(log_dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&log_dir);
        let _ = fs::write(log_dir.join("startup-error.log"), error);
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn refresh_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_adapter_settings(app: &AppHandle) {
    show_main_window(app);
    let _ = app.emit("runlit://open-adapter-settings", ());
}

fn set_window_geometry(
    window: &WebviewWindow,
    compact: bool,
    requested_height: Option<f64>,
) -> Result<(), String> {
    let old_position = window.outer_position().map_err(|error| error.to_string())?;
    let old_size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取当前屏幕信息".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let monitor_left = monitor_position.x;
    let monitor_right = monitor_position.x + monitor_size.width as i32;
    let monitor_top = monitor_position.y;
    let monitor_bottom = monitor_position.y + monitor_size.height as i32;

    let width = if compact { BALL_SIZE } else { PANEL_WIDTH };
    let available_panel_height = ((monitor_size.height as f64 - f64::from(EDGE_MARGIN * 2)) / scale)
        .max(PANEL_MIN_HEIGHT);
    let height = if compact {
        BALL_SIZE
    } else {
        clamp_panel_height(requested_height.unwrap_or(PANEL_MIN_HEIGHT), available_panel_height)
    };
    let new_width = (width * scale).round() as u32;
    let new_height = (height * scale).round() as u32;

    let old_center = old_position.x + old_size.width as i32 / 2;
    let monitor_center = monitor_left + monitor_size.width as i32 / 2;
    let new_x = if old_center >= monitor_center {
        monitor_right - new_width as i32 - EDGE_MARGIN
    } else {
        monitor_left + EDGE_MARGIN
    };
    let max_y = monitor_bottom - new_height as i32 - EDGE_MARGIN;
    let new_y = old_position
        .y
        .clamp(monitor_top + EDGE_MARGIN, max_y.max(monitor_top));

    window
        .set_size(PhysicalSize::new(new_width, new_height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(new_x, new_y))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_mode(
    window: WebviewWindow,
    compact: bool,
    height: Option<f64>,
) -> Result<(), String> {
    set_window_geometry(&window, compact, height)
}

#[tauri::command]
fn resize_expanded_window(window: WebviewWindow, height: f64) -> Result<bool, String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;

    // Content-driven resize requests can race with a user's click to collapse.
    // Never let one of those stale requests turn an already compact orb back
    // into a full panel; only an explicit set_window_mode(false, ...) may do so.
    let compact_width_limit = ((BALL_SIZE + 8.0) * scale).round() as u32;
    if size.width <= compact_width_limit {
        return Ok(false);
    }

    set_window_geometry(&window, false, Some(height))?;
    Ok(true)
}

#[tauri::command]
fn drag_and_snap(window: WebviewWindow, compact: bool) -> Result<bool, String> {
    window.start_dragging().map_err(|error| error.to_string())?;

    // A compact orb is already in its final form. Preserve the position where
    // the user released it instead of forcing it back to a screen edge.
    if compact {
        return Ok(true);
    }

    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取当前屏幕信息".to_string())?;
    let monitor_left = monitor.position().x;
    let monitor_right = monitor_left + monitor.size().width as i32;
    let distance_left = (position.x - monitor_left).unsigned_abs();
    let distance_right = (monitor_right - position.x - size.width as i32).unsigned_abs();
    let near_edge = distance_left.min(distance_right) <= (36.0 * scale) as u32;

    if should_snap_to_edge(compact, near_edge) {
        set_window_geometry(&window, true, None)?;
        return Ok(true);
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{clamp_panel_height, should_snap_to_edge};

    #[test]
    fn compact_orb_preserves_its_drop_position() {
        assert!(!should_snap_to_edge(true, false));
        assert!(!should_snap_to_edge(true, true));
    }

    #[test]
    fn only_expanded_window_snaps_when_near_an_edge() {
        assert!(should_snap_to_edge(false, true));
        assert!(!should_snap_to_edge(false, false));
    }

    #[test]
    fn panel_height_is_limited_by_usable_screen_space() {
        assert_eq!(clamp_panel_height(300.0, 900.0), 420.0);
        assert_eq!(clamp_panel_height(720.0, 900.0), 720.0);
        assert_eq!(clamp_panel_height(1200.0, 900.0), 900.0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(error) = start_bundled_daemon(app.handle()) {
                record_startup_error(app.handle(), &error);
                return Err(error.into());
            }
            let tray_menu = MenuBuilder::new(app)
                .text("open", "打开 RunLit")
                .text("adapter-settings", "AI 工具接入…")
                .text("refresh", "刷新")
                .separator()
                .text("quit", "退出 RunLit")
                .build()?;
            let mut tray = TrayIconBuilder::with_id("runlit-tray")
                .tooltip("RunLit")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "adapter-settings" => open_adapter_settings(app),
                    "refresh" => refresh_main_window(app),
                    "quit" => exit_runlit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let monitor_size = monitor.size();
                    let window_size = window.outer_size()?;
                    let monitor_position = monitor.position();
                    let x = monitor_position.x
                        + monitor_size.width.saturating_sub(window_size.width + 20) as i32;
                    let y =
                        monitor_position.y + (monitor_size.height - window_size.height) as i32 / 2;
                    window.set_position(PhysicalPosition::new(x, y))?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_target,
            quit_runlit,
            pick_orb_image,
            pick_adapter_folder,
            set_window_mode,
            resize_expanded_window,
            drag_and_snap
        ])
        .run(tauri::generate_context!())
        .expect("error while running Runlit");
}
