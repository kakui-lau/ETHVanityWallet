use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

pub use super::matcher::MatchRule;
use super::matcher::CompiledRule;
use super::Wallet;
use crate::wallet::{private_key_to_address, generate_random_private_key};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Created,
    Running,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerformanceMode {
    PowerSaver,
    Balanced,
    Turbo,
}

impl PerformanceMode {
    pub fn threads_for(&self, total: usize) -> usize {
        match self {
            PerformanceMode::PowerSaver => ((total as f64) * 0.5).ceil() as usize,
            PerformanceMode::Balanced => total.saturating_sub(1).max(1),
            PerformanceMode::Turbo => total.max(1),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    pub rule: MatchRule,
    pub target_count: u32,
    pub performance_mode: PerformanceMode,
    pub thread_override: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VanityTask {
    pub id: Uuid,
    pub name: String,
    pub config: TaskConfig,
    pub status: TaskStatus,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub error: Option<String>,
    pub performance_note: String,
    pub expected_difficulty: f64,
    pub threads: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PersistedHit {
    pub address: String,
    pub attempts_at_hit: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PersistedTask {
    pub meta: VanityTask,
    pub attempts: u64,
    pub found: u64,
    pub hits: Vec<PersistedHit>,
    pub persisted_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskStatsSnapshot {
    pub task_id: Uuid,
    pub status: TaskStatus,
    pub attempts: u64,
    pub found: u64,
    pub rate_per_sec: f64,
    pub elapsed_sec: f64,
    pub eta_sec: f64,
    pub threads: usize,
    pub worker_rates: Vec<f64>,
    pub rule_description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HitEvent {
    pub task_id: Uuid,
    pub wallet: Wallet,
    pub attempts_at_hit: u64,
    pub is_target_reached: bool,
}

pub(crate) struct RuntimeState {
    attempts: AtomicU64,
    found: AtomicU64,
    cancel_flag: Mutex<bool>,
    pause_flag: Mutex<bool>,
    results: Mutex<Vec<Wallet>>,
    worker_rates: Mutex<Vec<u64>>,
}

impl RuntimeState {
    fn new(threads: usize) -> Self {
        Self {
            attempts: AtomicU64::new(0),
            found: AtomicU64::new(0),
            cancel_flag: Mutex::new(false),
            pause_flag: Mutex::new(false),
            results: Mutex::new(Vec::new()),
            worker_rates: Mutex::new(vec![0u64; threads.max(1)]),
        }
    }

    fn clone_worker_rates_mutex(self: Arc<Self>) -> Arc<Self> {
        self
    }
}

pub struct EngineTask {
    pub meta: VanityTask,
    pub compiled_rule: CompiledRule,
pub(crate) state: Arc<RuntimeState>,
}

impl Clone for EngineTask {
    fn clone(&self) -> Self {
        Self {
            meta: self.meta.clone(),
            compiled_rule: self.compiled_rule.clone(),
            state: Arc::clone(&self.state),
        }
    }
}

pub struct VanityEngine {
    tasks: Mutex<HashMap<Uuid, EngineTask>>,
    total_threads: usize,
    data_dir: PathBuf,
}

impl VanityEngine {
    pub fn new(app_data_dir: &Path) -> Self {
        let total_threads = rayon::current_num_threads();
        let data_dir = app_data_dir.to_path_buf();
        let tasks_dir = data_dir.join("tasks");
        std::fs::create_dir_all(&tasks_dir).ok();
        Self {
            tasks: Mutex::new(HashMap::new()),
            total_threads,
            data_dir,
        }
    }

    pub fn total_threads(&self) -> usize {
        self.total_threads
    }

    fn tasks_dir(&self) -> PathBuf {
        self.data_dir.join("tasks")
    }

    fn task_file(&self, id: Uuid) -> PathBuf {
        self.tasks_dir().join(format!("{}.json", id))
    }

    pub fn restore(&self) -> Result<usize, String> {
        let dir = self.tasks_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut restored = 0usize;
        let mut restored_map: HashMap<Uuid, EngineTask> = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let raw = match std::fs::read(&p) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let pt: PersistedTask = match serde_json::from_slice(&raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let PersistedTask {
                    mut meta,
                    attempts,
                    found,
                    hits: _hits,
                    ..
                } = pt;
                // Safety: downgrade running -> paused so user must explicitly resume (threads won't be alive after restart)
                if matches!(meta.status, TaskStatus::Running) {
                    meta.status = TaskStatus::Paused;
                    meta.error = Some("程序重启后已自动暂停，请手动恢复".to_string());
                }
                if let Err(e) = meta.config.rule.validate() {
                    eprintln!(
                        "[engine] restore skip invalid task {} ({}): {}",
                        meta.id, meta.name, e
                    );
                    continue;
                }
                let compiled = match CompiledRule::compile(&meta.config.rule) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!(
                            "[engine] restore compile fail task {}: {}",
                            meta.id, e
                        );
                        continue;
                    }
                };
                let state = Arc::new(RuntimeState::new(meta.threads.max(1)));
                state.attempts.store(attempts, Ordering::Relaxed);
                state
                    .found
                    .store(found, Ordering::Relaxed);
                state.results.lock().clear();
                let engine_task = EngineTask {
                    meta,
                    compiled_rule: compiled,
                    state,
                };
                restored_map.insert(engine_task.meta.id, engine_task);
                restored += 1;
            }
        }
        *self.tasks.lock() = restored_map;
        Ok(restored)
    }

    pub fn persist_task(&self, id: Uuid, extra_hits: &[(Wallet, u64, u64)]) {
        let tasks = self.tasks.lock();
        let Some(t) = tasks.get(&id).cloned() else {
            return;
        };
        drop(tasks);
        let attempts = t.state.attempts.load(Ordering::Relaxed);
        let found = t.state.found.load(Ordering::Relaxed);
        // Build hits list: extend whatever already persisted if any (we always overwrite (re-serializing each time is simple)
        // We write to a file -> add extra_hits as persisted entries only. But we dont keep reading old state.
        let mut hits: Vec<PersistedHit> = Vec::new();
        // read existing
        let path = self.task_file(id);
        if let Ok(data) = std::fs::read(&path) {
            if let Ok(prev) = serde_json::from_slice::<PersistedTask>(&data) {
                hits = prev.hits;
            }
        }
        for (wallet, attempts_at_hit, ts_ms) in extra_hits {
            hits.push(PersistedHit {
                address: wallet.address.clone(),
                attempts_at_hit: *attempts_at_hit,
                timestamp_ms: *ts_ms,
            });
        }
        let pt = PersistedTask {
            meta: t.meta.clone(),
            attempts,
            found,
            hits,
            persisted_at_ms: {
                use std::time::{SystemTime, UNIX_EPOCH};
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64
            },
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&pt) {
            let dir = self.tasks_dir();
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&path, bytes);
        }
    }

    pub fn delete_task_file(&self, id: Uuid) {
        let _ = std::fs::remove_file(self.task_file(id));
    }

    /// 清空所有任务：先 cancel（停止 worker）→ 从内存中移除 → 删除 tasks/*.json
    pub fn clear_all_tasks(&self) -> Result<(), String> {
        // 先快照所有任务 id（避免持有锁时 cancel 产生死锁）
        let ids: Vec<Uuid> = self
            .tasks
            .lock()
            .values()
            .map(|t| t.meta.id)
            .collect();
        for id in ids.iter() {
            // cancel 内部会结束 worker 线程（若 running），不依赖持有锁
            let _ = self.cancel_task(*id);
        }
        let mut tasks = self.tasks.lock();
        for id in ids.iter() {
            if let Some(et) = tasks.remove(id) {
                // reset 运行时状态，防止后续继续拿到旧 attempts/命中
                let st = et.state.clone();
                st.attempts.store(0, Ordering::Relaxed);
                st.found.store(0, Ordering::Relaxed);
                *st.results.lock() = Vec::new();
            }
            self.delete_task_file(*id);
        }
        Ok(())
    }

    pub fn create_task(
        &self,
        name: String,
        config: TaskConfig,
    ) -> Result<VanityTask, String> {
        config.rule.validate()?;
        let compiled = CompiledRule::compile(&config.rule)?;
        let threads = config
            .thread_override
            .unwrap_or_else(|| config.performance_mode.threads_for(self.total_threads))
            .max(1)
            .min(self.total_threads * 2);

        let id = Uuid::new_v4();
        let created_at = epoch_sec();
        let meta = VanityTask {
            id,
            name,
            config: config.clone(),
            status: TaskStatus::Created,
            created_at,
            started_at: None,
            finished_at: None,
            error: None,
            performance_note: config.rule.performance_note().to_string(),
            expected_difficulty: config.rule.expected_difficulty(),
            threads,
        };
        let engine_task = EngineTask {
            meta: meta.clone(),
            compiled_rule: compiled,
            state: Arc::new(RuntimeState::new(threads)),
        };
        self.tasks.lock().insert(id, engine_task);
        self.persist_task(id, &[]);
        Ok(meta)
    }

    pub fn list_tasks(&self) -> Vec<VanityTask> {
        self.tasks
            .lock()
            .values()
            .map(|t| t.meta.clone())
            .collect()
    }

    pub fn get_results(&self, task_id: Uuid) -> Result<Vec<Wallet>, String> {
        let tasks = self.tasks.lock();
        let t = tasks
            .get(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        let results = t.state.results.lock().clone();
        Ok(results)
    }

    pub fn stats(&self, task_id: Uuid) -> Result<TaskStatsSnapshot, String> {
        let tasks = self.tasks.lock();
        let t = tasks
            .get(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?
            .clone();
        drop(tasks);
        let attempts = t.state.attempts.load(Ordering::Relaxed);
        let found = t.state.found.load(Ordering::Relaxed);
        let elapsed_sec = t
            .meta
            .started_at
            .map(|s| epoch_sec().saturating_sub(s) as f64)
            .unwrap_or(0.0);
        let rate_per_sec = if elapsed_sec > 0.0 {
            attempts as f64 / elapsed_sec
        } else {
            0.0
        };
        let remaining_needed = if found >= t.meta.config.target_count as u64 {
            0.0
        } else {
            (t.meta.config.target_count as u64 - found) as f64 * t.meta.expected_difficulty
        };
        let eta_sec = if rate_per_sec > 0.0 && remaining_needed > 0.0 {
            remaining_needed / rate_per_sec
        } else {
            0.0
        };
        let worker_rates_raw = t.state.worker_rates.lock().clone();
        let worker_rates = if elapsed_sec > 0.0 {
            worker_rates_raw
                .iter()
                .map(|&v| v as f64 / elapsed_sec)
                .collect()
        } else {
            vec![0.0; worker_rates_raw.len()]
        };
        Ok(TaskStatsSnapshot {
            task_id: t.meta.id,
            status: t.meta.status,
            attempts,
            found,
            rate_per_sec,
            elapsed_sec,
            eta_sec,
            threads: t.meta.threads,
            worker_rates,
            rule_description: rule_description(&t.meta.config.rule),
        })
    }

    pub fn start_task(
        &self,
        task_id: Uuid,
        app: AppHandle,
    ) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let mut engine_task = tasks
            .get_mut(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?
            .clone();
        if matches!(engine_task.meta.status, TaskStatus::Running) {
            return Err("任务已在运行".into());
        }
        if matches!(
            engine_task.meta.status,
            TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
        ) {
            return Err("任务已结束，请新建任务".into());
        }
        engine_task.meta.status = TaskStatus::Running;
        if engine_task.meta.started_at.is_none() {
            engine_task.meta.started_at = Some(epoch_sec());
        }
        // When resuming a previously-restored task, RuntimeState.attempts/found still contain prior counters from restore
        // so we keep them; do not overwrite for fresh start.
        if matches!(engine_task.state.attempts.load(Ordering::Relaxed), 0)
            && matches!(engine_task.state.found.load(Ordering::Relaxed), 0)
        {
            engine_task.state = Arc::new(RuntimeState::new(engine_task.meta.threads));
        }
        *engine_task.state.cancel_flag.lock() = false;
        *engine_task.state.pause_flag.lock() = false;
        tasks.insert(task_id, engine_task.clone());
        drop(tasks);
        self.persist_task(task_id, &[]);

        let state = engine_task.state.clone();
        let rule = engine_task.compiled_rule.clone();
        let target = engine_task.meta.config.target_count as u64;
        let threads = engine_task.meta.threads;
        let meta = engine_task.meta.clone();

        std::thread::Builder::new()
            .name(format!("vanity-{}", task_id))
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(4)
                    .enable_all()
                    .build()
                    .expect("build tokio runtime");
                rt.block_on(async move {
                    let _ = run_generation_loop(app, meta, state, rule, target, threads).await;
                });
            })
            .expect("spawn task thread");

        Ok(())
    }

    pub fn pause_task(&self, task_id: Uuid) -> Result<(), String> {
        let tasks = self.tasks.lock();
        let t = tasks
            .get(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !matches!(t.meta.status, TaskStatus::Running) {
            return Err("仅运行中的任务可暂停".into());
        }
        *t.state.pause_flag.lock() = true;
        drop(tasks);
        let mut tasks = self.tasks.lock();
        if let Some(t) = tasks.get_mut(&task_id) {
            t.meta.status = TaskStatus::Paused;
        }
        drop(tasks);
        self.persist_task(task_id, &[]);
        Ok(())
    }

    pub fn resume_task(&self, task_id: Uuid, app: AppHandle) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let t = tasks
            .get_mut(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if !matches!(t.meta.status, TaskStatus::Paused) {
            return Err("仅暂停状态的任务可恢复".into());
        }
        *t.state.pause_flag.lock() = false;
        t.meta.status = TaskStatus::Running;
        t.meta.error = None;
        let meta = t.meta.clone();
        let state = Arc::clone(&t.state);
        let rule = t.compiled_rule.clone();
        let target = t.meta.config.target_count as u64;
        let threads = t.meta.threads;
        drop(tasks);
        self.persist_task(task_id, &[]);
        std::thread::Builder::new()
            .name(format!("vanity-r-{}", task_id))
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(4)
                    .enable_all()
                    .build()
                    .expect("build tokio runtime");
                rt.block_on(async move {
                    let _ = run_generation_loop(app, meta, state, rule, target, threads).await;
                });
            })
            .expect("spawn task thread");
        Ok(())
    }

    pub fn cancel_task(&self, task_id: Uuid) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let t = tasks
            .get_mut(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if matches!(
            t.meta.status,
            TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
        ) {
            return Ok(());
        }
        *t.state.cancel_flag.lock() = true;
        t.meta.status = TaskStatus::Cancelled;
        t.meta.finished_at = Some(epoch_sec());
        drop(tasks);
        self.persist_task(task_id, &[]);
        Ok(())
    }

    pub fn remove_task(&self, task_id: Uuid) -> Result<(), String> {
        let mut tasks = self.tasks.lock();
        let t = tasks
            .get(&task_id)
            .ok_or_else(|| "任务不存在".to_string())?;
        if matches!(t.meta.status, TaskStatus::Running) {
            return Err("请先停止运行中的任务".into());
        }
        tasks.remove(&task_id);
        drop(tasks);
        self.delete_task_file(task_id);
        Ok(())
    }
}

impl Default for VanityEngine {
    fn default() -> Self {
        let tmp = std::env::temp_dir().join("eth-vanity-wallet");
        std::fs::create_dir_all(&tmp).ok();
        Self::new(&tmp)
    }
}

fn epoch_sec() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn rule_description(rule: &MatchRule) -> String {
    match rule {
        MatchRule::Prefix { value } => format!("前缀: 0x{}", value.trim_start_matches("0x")),
        MatchRule::Suffix { value } => format!("后缀: ...{}", value.trim_start_matches("0x")),
        MatchRule::Contains { value } => format!("包含: {}", value.trim_start_matches("0x")),
        MatchRule::Combo { rules } => {
            let parts: Vec<_> = rules.iter().map(rule_description).collect();
            format!("组合 [{}]", parts.join(" ∧ "))
        }
        MatchRule::Regex { pattern } => format!("正则: {}", pattern),
        MatchRule::WordList { words } => format!("词库({}个)", words.len()),
    }
}

async fn run_generation_loop(
    app: AppHandle,
    meta: VanityTask,
    state: Arc<RuntimeState>,
    compiled: CompiledRule,
    target: u64,
    threads: usize,
) -> Result<(), ()> {
    let task_id = meta.id;
    let rule_arc = Arc::new(compiled);
    let started = Instant::now();
    let mut last_stats_emit = Instant::now();
    let mut last_persist = Instant::now();
    let app_inner = app.clone();
    let app_outer = app.clone();

    let result = tokio::task::spawn_blocking(move || {
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .map_err(|e| e.to_string())?;

        let now_ms = || -> u64 {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
        };

        pool.install(|| {
            loop {
                if *state.cancel_flag.lock() {
                    return Ok::<(), String>(());
                }
                if *state.pause_flag.lock() {
                    return Ok(());
                }
                if state.found.load(Ordering::Relaxed) >= target {
                    return Ok(());
                }

                const BATCH: usize = 1024;
                let found_target_reached = std::sync::atomic::AtomicBool::new(false);
                let hits: Mutex<Vec<(Wallet, u64)>> = Mutex::new(Vec::new());

                let worker_rates_vec = Arc::clone(&state).clone_worker_rates_mutex();
                let thread_count = threads;

                (0..thread_count).into_par_iter().for_each(|worker_idx| {
                    let mut rng = rand::thread_rng();
                    let mut local_attempts = 0u64;

                    for _ in 0..BATCH {
                        if *state.cancel_flag.lock() || *state.pause_flag.lock() {
                            break;
                        }
                        if found_target_reached.load(Ordering::Relaxed) {
                            break;
                        }

                        let mut sk = [0u8; 32];
                        rand::RngCore::fill_bytes(&mut rng, &mut sk);
                        if !is_valid_sk(&sk) {
                            continue;
                        }

                        let addr_bytes = match sk_to_address_bytes(&sk) {
                            Some(b) => b,
                            None => continue,
                        };
                        local_attempts += 1;

                        if super::matcher::check_rule(&addr_bytes, &rule_arc) {
                            let wallet = Wallet {
                                address: format!("0x{}", hex::encode(addr_bytes)),
                                private_key: hex::encode(sk),
                            };
                            let total_att = state.attempts.load(Ordering::Relaxed);
                            let mut h = hits.lock();
                            h.push((wallet, total_att));
                            drop(h);
                            let f = state.found.fetch_add(1, Ordering::Relaxed) + 1;
                            if f >= target {
                                found_target_reached.store(true, Ordering::Relaxed);
                                break;
                            }
                        }
                    }

                    state.attempts.fetch_add(local_attempts, Ordering::Relaxed);
                    let mut rates = worker_rates_vec.worker_rates.lock();
                    if worker_idx < rates.len() {
                        rates[worker_idx] = rates[worker_idx].saturating_add(local_attempts);
                    }
                });

                let mut final_hits = hits.lock();
                let batch_hits: Vec<(Wallet, u64, u64)> = final_hits
                    .drain(..)
                    .map(|(wallet, att)| {
                        let ts_ms = now_ms();
                        (wallet, att, ts_ms)
                    })
                    .collect();
                for (wallet, att, _ts_ms) in &batch_hits {
                    let is_reached = state.found.load(Ordering::Relaxed) >= target;
                    state.results.lock().push(wallet.clone());
                    let evt = HitEvent {
                        task_id,
                        wallet: wallet.clone(),
                        attempts_at_hit: *att,
                        is_target_reached: is_reached,
                    };
                    let _ = app_inner.emit("vanity://hit", &evt);
                }
                drop(final_hits);

                // Throttled persist: every ~5s or whenever we got batch hits (never persist private keys)
                let should_persist = !batch_hits.is_empty()
                    || last_persist.elapsed() >= Duration::from_secs(5);
                if should_persist {
                    last_persist = Instant::now();
                    if let Some(state_mgr) = app_inner.try_state::<crate::ipc::EngineState>()
                    {
                        let safe_hits: Vec<(Wallet, u64, u64)> = batch_hits
                            .iter()
                            .map(|(w, a, ts)| {
                                (
                                    Wallet {
                                        address: w.address.clone(),
                                        private_key: String::new(),
                                    },
                                    *a,
                                    *ts,
                                )
                            })
                            .collect();
                        state_mgr.0.persist_task(task_id, &safe_hits);
                    }
                }

                if last_stats_emit.elapsed() >= Duration::from_millis(750) {
                    last_stats_emit = Instant::now();
                    let attempts = state.attempts.load(Ordering::Relaxed);
                    let found = state.found.load(Ordering::Relaxed);
                    let elapsed = started.elapsed().as_secs_f64();
                    let rate = if elapsed > 0.0 { attempts as f64 / elapsed } else { 0.0 };
                    let _ = app_inner.emit(
                        "vanity://stats",
                        &serde_json::json!({
                            "task_id": task_id.to_string(),
                            "attempts": attempts,
                            "found": found,
                            "rate_per_sec": rate,
                            "elapsed_sec": elapsed,
                        }),
                    );
                }

                if *state.cancel_flag.lock() {
                    break;
                }
                if state.found.load(Ordering::Relaxed) >= target {
                    break;
                }
            }
            Ok(())
        })
    })
    .await;

    // Finalize: mark meta as completed/stopped and persist once more
    if let Some(state_mgr) = app_outer.try_state::<crate::ipc::EngineState>() {
        let mut tasks = state_mgr.0.tasks.lock();
        if let Some(t) = tasks.get_mut(&task_id) {
            let target = t.meta.config.target_count as u64;
            if target > 0 && t.state.found.load(Ordering::Relaxed) >= target {
                t.meta.status = TaskStatus::Completed;
            }
            // If loop exited but status still Running (pause/crash/exit), pause it
            if matches!(t.meta.status, TaskStatus::Running) {
                t.meta.status = TaskStatus::Paused;
            }
            if t.meta.finished_at.is_none()
                && matches!(
                    t.meta.status,
                    TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed
                )
            {
                t.meta.finished_at = Some(epoch_sec());
            }
        }
        drop(tasks);
        state_mgr.0.persist_task(task_id, &[]);
    }

    let _ = app_outer.emit("vanity://task_end", &serde_json::json!({
        "task_id": task_id.to_string(),
    }));

    let _ = result.map_err(|_| ())?;
    Ok(())
}

fn is_valid_sk(key: &[u8; 32]) -> bool {
    const N_MINUS_1: [u8; 32] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
        0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B,
        0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x40,
    ];
    let mut is_zero = true;
    for &b in key {
        if b != 0 {
            is_zero = false;
            break;
        }
    }
    if is_zero {
        return false;
    }
    for i in 0..32 {
        if key[i] < N_MINUS_1[i] {
            return true;
        }
        if key[i] > N_MINUS_1[i] {
            return false;
        }
    }
    true
}

fn sk_to_address_bytes(sk: &[u8; 32]) -> Option<[u8; 20]> {
    let secp = secp256k1::Secp256k1::new();
    let secret = secp256k1::SecretKey::from_slice(sk).ok()?;
    let pubkey = secret.public_key(&secp);
    let uncompressed = pubkey.serialize_uncompressed();
    let mut keccak = tiny_keccak::Keccak::v256();
    let mut hash = [0u8; 32];
    tiny_keccak::Hasher::update(&mut keccak, &uncompressed[1..65]);
    tiny_keccak::Hasher::finalize(keccak, &mut hash);
    let mut out = [0u8; 20];
    out.copy_from_slice(&hash[12..32]);
    Some(out)
}

#[allow(dead_code)]
fn _sk_to_address_full(sk: &[u8; 32]) -> Option<Wallet> {
    private_key_to_address(sk)
}

#[allow(dead_code)]
fn _gen_rand() -> [u8; 32] {
    generate_random_private_key()
}
