import { invoke } from "@tauri-apps/api/core";
import type {
  MatchRule,
  PerformanceMode,
  RuleValidation,
  Wallet,
} from "@/types";

export async function tauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export interface CpuInfo {
  available_threads: number;
  recommended_threads: number;
}

export const api = {
  health: () => tauri<string>("health_check"),
  greet: (name: string) => tauri<string>("greet", { name }),
  generateSingleWallet: () => tauri<Wallet>("generate_single_wallet"),
  getCpuInfo: () => tauri<CpuInfo>("get_system_cpu_info"),

  createTask: (args: {
    name: string;
    rule: MatchRule;
    target_count: number;
    performance_mode: PerformanceMode;
    thread_override?: number | null;
  }) =>
    tauri<string>("create_task", {
      req: {
        ...args,
        thread_override: args.thread_override ?? undefined,
      },
    }),
  listTasks: () => tauri<any[]>("list_tasks"),
  startTask: (id: string) => tauri<void>("start_task", { id }),
  pauseTask: (id: string) => tauri<void>("pause_task", { id }),
  resumeTask: (id: string) => tauri<void>("resume_task", { id }),
  cancelTask: (id: string) => tauri<void>("cancel_task", { id }),
  removeTask: (id: string) => tauri<void>("remove_task", { id }),
  getTaskStats: (id: string) => tauri<any>("get_task_stats", { id }),
  getTaskResults: (id: string) => tauri<Wallet[]>("get_task_results", { id }),

  isVaultInitialized: () => tauri<boolean>("is_vault_initialized"),
  initMasterPassword: (password: string) =>
    tauri<void>("init_master_password", { password }),
  verifyMasterPassword: async (password: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      await tauri<void>("verify_master_password", { password });
      return { ok: true };
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "主密码错误");
      return { ok: false, message: msg };
    }
  },
  changeMasterPassword: (args: { old_password: string; new_password: string }) =>
    tauri<void>("change_master_password", args),
  vaultStatus: () =>
    tauri<{
      initialized: boolean;
      locked: boolean;
      remaining_attempts: number;
      cooldown_seconds: number;
    }>("vault_status"),
  listVaultWallets: () => tauri<any[]>("list_vault_wallets"),
  saveWalletToVault: (args: {
    wallet: Wallet;
    password: string;
    label?: string | null;
    source_task_id?: string | null;
  }) =>
    tauri<string>("save_wallet_to_vault", {
      wallet: args.wallet,
      password: args.password,
      label: args.label ?? undefined,
      source_task_id: args.source_task_id ?? undefined,
    }),
  decryptWalletFromVault: (id: string, password: string) =>
    tauri<Wallet>("decrypt_wallet_from_vault", { id, password }),
  removeWalletFromVault: (id: string) =>
    tauri<void>("remove_wallet_from_vault", { id }),

  validateMatchRule: (rule: MatchRule) =>
    tauri<RuleValidation>("validate_match_rule", { rule }),

  exportWalletText: (args: {
    wallet: Wallet;
    format: string;
    keystore_password?: string;
  }) =>
    tauri<string>("export_wallet_text", {
      wallet: args.wallet,
      format: args.format,
      keystorePassword: args.keystore_password ?? undefined,
    }),

  generateQrSvg: (payload: string, size?: number) =>
    tauri<string>("generate_qr_svg", {
      payload,
      sizePx: size ?? undefined,
    }),

  resetAll: () => tauri<void>("reset_all"),
};
