//! Metis Desktop App — Tauri 后端
//!
//! Tauri command 是 UI 到 Core Engine 的薄封装层。
//! 核心逻辑全部在 metis-core 中实现。

use tauri;

/// 示例 command：健康检查
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Metis Core Engine is alive.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
