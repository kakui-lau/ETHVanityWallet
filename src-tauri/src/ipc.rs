use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::vanity::engine::{
    rule_description, MatchRule, PerformanceMode, TaskConfig, VanityEngine,
};
use crate::vanity::Wallet;
use crate::wallet::store::{StoredWallet, WalletStore};
use crate::wallet as wallet_mod;
use crate::wallet::export;

pub struct EngineState(pub Arc<VanityEngine>);
pub struct StoreState(pub Arc<WalletStore>);

#[derive(Debug, Serialize, Deserialize)]
pub struct NewTaskRequest {
    pub name: String,
    pub rule: MatchRule,
    pub target_count: u32,
    pub performance_mode: PerformanceMode,
    pub thread_override: Option<usize>,
}

#[tauri::command]
pub fn health_check() -> Result<String, String> {
    Ok("ok".into())
}

#[tauri::command]
pub fn greet(name: String) -> String {
    format!("👋 你好, {}！Rust 后端工作正常。", name)
}

#[tauri::command]
pub fn generate_single_wallet() -> Result<Wallet, String> {
    Ok(wallet_mod::generate_single())
}

#[tauri::command]
pub fn get_system_cpu_info() -> Result<CpuInfo, String> {
    let n = wallet_mod::cpu_thread_count();
    Ok(CpuInfo {
        available_threads: n,
        recommended_threads: n.saturating_sub(1).max(1),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuInfo {
    pub available_threads: usize,
    pub recommended_threads: usize,
}

#[tauri::command]
pub fn create_task(
    engine: State<'_, EngineState>,
    req: NewTaskRequest,
) -> Result<String, String> {
    let cfg = TaskConfig {
        rule: req.rule,
        target_count: req.target_count.max(1),
        performance_mode: req.performance_mode,
        thread_override: req.thread_override,
    };
    engine
        .0
        .create_task(req.name, cfg)
        .map(|t| t.id.to_string())
}

#[tauri::command]
pub fn list_tasks(engine: State<'_, EngineState>) -> Vec<serde_json::Value> {
    engine
        .0
        .list_tasks()
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "id": t.id.to_string(),
                "name": t.name,
                "status": serde_json::to_value(t.status).unwrap(),
                "created_at": t.created_at,
                "started_at": t.started_at,
                "finished_at": t.finished_at,
                "error": t.error,
                "performance_note": t.performance_note,
                "expected_difficulty": t.expected_difficulty,
                "threads": t.threads,
                "rule_description": rule_description(&t.config.rule),
                "target_count": t.config.target_count,
                "performance_mode": serde_json::to_value(t.config.performance_mode).unwrap(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn start_task(
    engine: State<'_, EngineState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.start_task(uuid, app)
}

#[tauri::command]
pub fn pause_task(engine: State<'_, EngineState>, id: String) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.pause_task(uuid)
}

#[tauri::command]
pub fn resume_task(
    engine: State<'_, EngineState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.resume_task(uuid, app)
}

#[tauri::command]
pub fn cancel_task(engine: State<'_, EngineState>, id: String) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.cancel_task(uuid)
}

#[tauri::command]
pub fn remove_task(engine: State<'_, EngineState>, id: String) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.remove_task(uuid)
}

#[tauri::command]
pub fn get_task_stats(
    engine: State<'_, EngineState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    let s = engine.0.stats(uuid)?;
    Ok(serde_json::json!({
        "task_id": s.task_id.to_string(),
        "status": serde_json::to_value(s.status).unwrap(),
        "attempts": s.attempts,
        "found": s.found,
        "rate_per_sec": s.rate_per_sec,
        "elapsed_sec": s.elapsed_sec,
        "eta_sec": s.eta_sec,
        "threads": s.threads,
        "worker_rates": s.worker_rates,
        "rule_description": s.rule_description,
    }))
}

#[tauri::command]
pub fn get_task_results(
    engine: State<'_, EngineState>,
    id: String,
) -> Result<Vec<Wallet>, String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "任务 ID 格式错误")?;
    engine.0.get_results(uuid)
}

#[tauri::command]
pub fn is_vault_initialized(store: State<'_, StoreState>) -> bool {
    store.0.is_initialized()
}

#[tauri::command]
pub fn init_master_password(
    store: State<'_, StoreState>,
    password: String,
) -> Result<(), String> {
    let res = store.0.init_master_password(&password);
    zeroize_password(password);
    res
}

#[tauri::command]
pub fn verify_master_password(
    store: State<'_, StoreState>,
    password: String,
) -> Result<(), String> {
    // 直接把 verify_password 的 Ok(()) / Err(msg) 原样返回：
    // - 成功 → Ok(()) 前端 resolve
    // - 失败 / 冷却期 → Err(msg)，前端会 throw，能拿到具体是冷却还是密码错
    let res = store.0.verify_password(&password);
    zeroize_password(password);
    res
}

#[tauri::command]
pub fn change_master_password(
    store: State<'_, StoreState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let res = store
        .0
        .change_master_password(&old_password, &new_password);
    zeroize_password(old_password);
    zeroize_password(new_password);
    res
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultStatusResponse {
    pub initialized: bool,
    pub locked: bool,
    pub remaining_attempts: u32,
    pub cooldown_seconds: u64,
}

#[tauri::command]
pub fn vault_status(store: State<'_, StoreState>) -> VaultStatusResponse {
    // "locked" 在我们的模型里由前端 vaultUnlocked 控制，但 Rust 侧仍能表达“库已初始化且没有 session”
    // 简化：如果库 initialized=true，locked=true；否则 locked=false。
    // （真实解锁 session 由前端内存态持 password；Rust 侧任何解密操作仍需前端再传 password 校验一次）
    let initialized = store.0.is_initialized();
    let (remaining, cooldown) = store.0.attempt_status();
    VaultStatusResponse {
        initialized,
        locked: initialized,
        remaining_attempts: remaining,
        cooldown_seconds: cooldown,
    }
}

/// 帮助函数：尽可能覆盖 String 内部字节，降低内存 dump 拿到密码的概率（不能 100% 防，但好）
fn zeroize_password(mut s: String) {
    use std::ops::DerefMut;
    let bytes = unsafe { s.as_mut_vec() };
    for b in bytes.deref_mut().iter_mut() {
        *b = 0;
    }
}


#[tauri::command]
pub fn list_vault_wallets(store: State<'_, StoreState>) -> Vec<serde_json::Value> {
    store
        .0
        .list_wallets_meta()
        .into_iter()
        .map(|w: StoredWallet| {
            serde_json::json!({
                "id": w.id.to_string(),
                "address": w.address,
                "label": w.label,
                "created_at": w.created_at,
                "source_task_id": w.source_task_id.map(|s| s.to_string()),
            })
        })
        .collect()
}

#[tauri::command]
pub fn save_wallet_to_vault(
    store: State<'_, StoreState>,
    wallet: Wallet,
    password: String,
    label: Option<String>,
    source_task_id: Option<String>,
) -> Result<String, String> {
    let src = source_task_id.and_then(|s| Uuid::parse_str(&s).ok());
    let id = store.0.save_wallet(&wallet, &password, label, src)?;
    Ok(id.to_string())
}

#[tauri::command]
pub fn decrypt_wallet_from_vault(
    store: State<'_, StoreState>,
    id: String,
    password: String,
) -> Result<Wallet, String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "钱包 ID 格式错误")?;
    store.0.decrypt_wallet(uuid, &password)
}

#[tauri::command]
pub fn remove_wallet_from_vault(
    store: State<'_, StoreState>,
    id: String,
) -> Result<(), String> {
    let uuid = Uuid::parse_str(&id).map_err(|_| "钱包 ID 格式错误")?;
    store.0.remove_wallet(uuid)
}

#[tauri::command]
pub fn validate_match_rule(rule: MatchRule) -> Result<RuleValidation, String> {
    rule.validate()?;
    Ok(RuleValidation {
        valid: true,
        performance_note: rule.performance_note().into(),
        expected_difficulty: rule.expected_difficulty(),
        description: rule_description(&rule),
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuleValidation {
    pub valid: bool,
    pub performance_note: String,
    pub expected_difficulty: f64,
    pub description: String,
}

#[tauri::command]
pub fn export_wallet_text(
    wallet: Wallet,
    format: String,
    keystore_password: Option<String>,
) -> Result<String, String> {
    export::export_text_content(&wallet, &format, keystore_password.as_deref())
}

#[tauri::command]
pub fn generate_qr_svg(payload: String, size_px: Option<usize>) -> Result<String, String> {
    let size = size_px.unwrap_or(256);
    export::generate_qr_svg(&payload, size)
}

#[tauri::command]
pub fn reset_all(
    engine: State<'_, EngineState>,
    store: State<'_, StoreState>,
) -> Result<(), String> {
    engine.0.clear_all_tasks()?;
    store.0.reset()?;
    Ok(())
}
