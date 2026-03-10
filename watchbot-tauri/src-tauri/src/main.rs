#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

struct AppState {
    monitoring: Mutex<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkRecord {
    pub id: i64,
    pub status: String,
    pub activity: String,
    pub productivity: i32,
    pub timestamp: String,
    pub focus_score: i32,
}

#[tauri::command]
fn get_status(state: State<AppState>) -> serde_json::Value {
    let monitoring = *state.monitoring.lock().unwrap();
    serde_json::json!({
        "monitoring": monitoring,
        "currentStatus": None,
        "totalRecords": 0
    })
}

#[tauri::command]
fn toggle_monitoring(state: State<AppState>) -> bool {
    let mut m = state.monitoring.lock().unwrap();
    *m = !*m;
    *m
}

#[tauri::command]
fn trigger_screenshot() -> Result<WorkRecord, String> {
    let now = chrono::Utc::now();
    Ok(WorkRecord {
        id: 1,
        status: "普通工作".to_string(),
        activity: "Coding".to_string(),
        productivity: 80,
        timestamp: now.to_rfc3339(),
        focus_score: 75,
    })
}

fn main() {
    tauri::Builder::default()
        .manage(AppState { monitoring: Mutex::new(false) })
        .setup(|_app| {
            println!("WatchBot starting...");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            toggle_monitoring,
            trigger_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}