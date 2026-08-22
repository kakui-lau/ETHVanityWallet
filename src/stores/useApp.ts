import { create } from "zustand";
import type {
  HitEvent,
  MatchRule,
  PerformanceMode,
  TabKey,
  TaskStats,
  TaskStatus,
  VanityTask,
  Wallet,
} from "@/types";
import { api } from "@/lib/tauri";
import { validateMasterPassword } from "@/lib/password";
import { detectLanguage } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";

export interface TaskHit extends HitEvent {
  id: string;
  timestamp: number;
}

export interface StatsPoint {
  t: number;
  rate: number;
  attempts: number;
  found: number;
}

const SUPPORTED_LANGUAGES: readonly Language[] = ["zh-CN", "zh-TW", "en", "ja", "ko"];

interface AppState {
  language: Language;
  setLanguage: (language: Language) => void;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  privacyMode: boolean;
  togglePrivacy: () => void;

  cpuThreads: number;
  cpuRecommended: number;
  loadCpuInfo: () => Promise<void>;

  vaultInitialized: boolean;
  vaultUnlocked: boolean;
  sessionPassword: string;
  autoLockAt: number | null;
  lastActivityAt: number;
  lastUnlockError: string | null;
  setSessionPassword: (p: string) => void;
  setVaultInitialized: (b: boolean) => void;
  unlockVault: (password: string) => Promise<{ ok: boolean; message?: string }>;
  lockVault: () => void;
  resetIdleTimer: () => void;

  tasks: VanityTask[];
  activeTaskId: string | null;
  setActiveTaskId: (id: string | null) => Promise<void>;
  refreshTasks: () => Promise<void>;
  createTask: (args: {
    name: string;
    rule: MatchRule;
    target_count: number;
    performance_mode: PerformanceMode;
    thread_override?: number;
  }) => Promise<string>;
  startTask: (id: string) => Promise<void>;
  pauseTask: (id: string) => Promise<void>;
  resumeTask: (id: string) => Promise<void>;
  cancelTask: (id: string) => Promise<void>;
  removeTask: (id: string) => Promise<void>;

  taskStats: Record<string, TaskStats>;
  statsHistory: Record<string, StatsPoint[]>;
  onStatsEvent: (e: any) => void;
  pollAllStats: () => Promise<void>;

  hits: Record<string, TaskHit[]>;
  onHit: (e: any) => void;
  refreshTaskResults: (taskId: string) => Promise<Wallet[]>;

  onTaskEnd: (taskId: string) => Promise<void>;

  resetEverything: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  language: (() => {
    const saved = localStorage.getItem("eth-vanity-language");
    return SUPPORTED_LANGUAGES.includes(saved as Language)
      ? (saved as Language)
      : detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
  })(),
  setLanguage: (language) => {
    localStorage.setItem("eth-vanity-language", language);
    set({ language });
  },
  tab: "dashboard",
  setTab: (t) => set({ tab: t }),
  privacyMode: false,
  togglePrivacy: () => set((s) => ({ privacyMode: !s.privacyMode })),

  cpuThreads: 0,
  cpuRecommended: 0,
  loadCpuInfo: async () => {
    const info = await api.getCpuInfo();
    set({
      cpuThreads: info.available_threads,
      cpuRecommended: info.recommended_threads,
    });
  },

  vaultInitialized: false,
  vaultUnlocked: false,
  sessionPassword: "",
  autoLockAt: null,
  lastActivityAt: Date.now(),
  lastUnlockError: null,
  setVaultInitialized: (b) => set({ vaultInitialized: b }),
  unlockVault: async (password) => {
    const formatErr = validateMasterPassword(password);
    if (formatErr) {
      set({ lastUnlockError: formatErr });
      return { ok: false, message: formatErr };
    }
    const res = await api.verifyMasterPassword(password);
    if (res.ok) {
      const now = Date.now();
      set({
        vaultUnlocked: true,
        sessionPassword: password,
        autoLockAt: now + 10 * 60 * 1000,
        lastActivityAt: now,
        lastUnlockError: null,
      });
      return { ok: true };
    }
    set({ vaultUnlocked: false, sessionPassword: "", lastUnlockError: res.message ?? null });
    return { ok: false, message: res.message };
  },
  /** @internal 仅允许 unlockVault / lockVault / resetEverything 写入 sessionPassword，
   *  其他任何地方**调用 setSessionPassword 全部 no-op（防绕过密码验证写入密码导致解密）*/
  setSessionPassword: (_p) => {
    const st = get();
    if (!st.vaultUnlocked) return;
  },
  lockVault: () =>
    set({ vaultUnlocked: false, sessionPassword: "", autoLockAt: null }),
  resetIdleTimer: () => {
    const st = get();
    if (!st.vaultUnlocked) return;
    const now = Date.now();
    set({ lastActivityAt: now, autoLockAt: now + 10 * 60 * 1000 });
  },

  tasks: [],
  activeTaskId: null,
  setActiveTaskId: async (id) => {
    set({ activeTaskId: id });
    if (!id) return;
    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;
    // 立即拉一次当前任务的 stats + 命中结果，避免右侧保留上一任务数据
    try {
      const s = (await api.getTaskStats(id)) as TaskStats;
      const prev = get().taskStats;
      set({ taskStats: { ...prev, [id]: s } });
    } catch {
      /* noop */
    }
    const existingHits = get().hits[id];
    if (!existingHits || existingHits.length === 0) {
      void get().refreshTaskResults(id);
    }
  },

  refreshTasks: async () => {
    const t = await api.listTasks();
    set({
      tasks: t.map((x) => ({
        ...x,
        id: x.id,
        name: x.name,
        status: x.status as TaskStatus,
      })),
    });
  },

  createTask: async (args) => {
    const id = await api.createTask({
      ...args,
      thread_override: args.thread_override ?? undefined,
    });
    await get().refreshTasks();
    return id;
  },

  startTask: async (id) => {
    await api.startTask(id);
    await get().refreshTasks();
  },
  pauseTask: async (id) => {
    await api.pauseTask(id);
    await get().refreshTasks();
  },
  resumeTask: async (id) => {
    await api.resumeTask(id);
    await get().refreshTasks();
  },
  cancelTask: async (id) => {
    await api.cancelTask(id);
    await get().refreshTasks();
  },
  removeTask: async (id) => {
    await api.removeTask(id);
    await get().refreshTasks();
    if (get().activeTaskId === id) set({ activeTaskId: null });
  },

  taskStats: {},
  statsHistory: {},
  onStatsEvent: (e) => {
    const payload = e.payload as any;
    const taskId = payload.task_id;
    const t = Date.now();
    const p: StatsPoint = {
      t,
      rate: Number(payload.rate_per_sec) || 0,
      attempts: Number(payload.attempts) || 0,
      found: Number(payload.found) || 0,
    };
    set((s) => {
      const prev = s.statsHistory[taskId] || [];
      const next = [...prev, p].slice(-180);
      return {
        statsHistory: { ...s.statsHistory, [taskId]: next },
      };
    });
  },

  pollAllStats: async () => {
    const tasks = get().tasks;
    const activeIds = tasks
      .filter(
        (t) => t.status === "running" || t.status === "paused" || t.status === "completed",
      )
      .map((t) => t.id);
    const merged: Record<string, TaskStats> = { ...get().taskStats };
    for (const id of activeIds) {
      try {
        const s = (await api.getTaskStats(id)) as TaskStats;
        merged[id] = s;
      } catch {
        /* noop */
      }
    }
    set({ taskStats: merged });
  },

  hits: {},
  onHit: (e) => {
    const payload = e.payload as HitEvent;
    const taskId = payload.task_id;
    set((s) => {
      const prev = s.hits[taskId] || [];
      const next: TaskHit = {
        ...payload,
        id: `${taskId}-${prev.length}-${Date.now()}`,
        timestamp: Date.now(),
      };
      return {
        hits: { ...s.hits, [taskId]: [next, ...prev] },
      };
    });
  },

  refreshTaskResults: async (taskId) => {
    const results = await api.getTaskResults(taskId);
    const asHits: TaskHit[] = results.map((w, i) => ({
      task_id: taskId,
      wallet: w,
      attempts_at_hit: 0,
      is_target_reached: true,
      id: `${taskId}-restore-${i}`,
      timestamp: Date.now(),
    }));
    set((s) => ({
      hits: { ...s.hits, [taskId]: asHits },
    }));
    return results;
  },

  onTaskEnd: async (_taskId) => {
    await get().refreshTasks();
    await get().pollAllStats();
  },

  resetEverything: async () => {
    await api.resetAll();
    set({
      tab: "dashboard",
      privacyMode: get().privacyMode,
      cpuThreads: get().cpuThreads,
      cpuRecommended: get().cpuRecommended,
      vaultInitialized: false,
      vaultUnlocked: false,
      sessionPassword: "",
      autoLockAt: null,
      lastActivityAt: Date.now(),
      lastUnlockError: null,
      tasks: [],
      activeTaskId: null,
      taskStats: {},
      statsHistory: {},
      hits: {},
    });
  },
}));
