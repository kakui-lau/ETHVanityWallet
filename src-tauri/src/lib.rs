pub mod vanity;
pub mod wallet;
pub mod ipc;

use std::sync::Arc;
use tauri::{Listener, Manager};

use ipc::{EngineState, StoreState};
use vanity::engine::VanityEngine;
use wallet::store::WalletStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("eth-vanity-wallet"));
            let engine = Arc::new(VanityEngine::new(&data_dir));
            // Restore persisted tasks from disk; failures are non-fatal (tasks list stays empty)
            match engine.restore() {
                Ok(0) => {}
                Ok(n) => eprintln!("[engine] restored {} persisted task(s) from disk", n),
                Err(e) => eprintln!("[engine] restore failed: {}", e),
            }
            let store = Arc::new(WalletStore::new(&data_dir));

            app.manage(EngineState(engine));
            app.manage(StoreState(store));

            std::thread::spawn(move || {
                let _ = app_handle.listen("vanity://log", |event| {
                    println!("[frontend log] {:?}", event.payload());
                });
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::health_check,
            ipc::greet,
            ipc::generate_single_wallet,
            ipc::get_system_cpu_info,
            ipc::create_task,
            ipc::list_tasks,
            ipc::start_task,
            ipc::pause_task,
            ipc::resume_task,
            ipc::cancel_task,
            ipc::remove_task,
            ipc::get_task_stats,
            ipc::get_task_results,
            ipc::is_vault_initialized,
            ipc::init_master_password,
            ipc::verify_master_password,
            ipc::change_master_password,
            ipc::vault_status,
            ipc::list_vault_wallets,
            ipc::save_wallet_to_vault,
            ipc::decrypt_wallet_from_vault,
            ipc::remove_wallet_from_vault,
            ipc::validate_match_rule,
            ipc::export_wallet_text,
            ipc::generate_qr_svg,
            ipc::reset_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
