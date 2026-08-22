export type TaskStatus =
  | "created"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type PerformanceMode = "power_saver" | "balanced" | "turbo";

export type MatchRule =
  | { mode: "prefix"; value: string }
  | { mode: "suffix"; value: string }
  | { mode: "contains"; value: string }
  | { mode: "combo"; rules: MatchRule[] }
  | { mode: "regex"; pattern: string }
  | { mode: "word_list"; words: string[] };

export interface Wallet {
  address: string;
  private_key: string;
}

export interface VanityTask {
  id: string;
  name: string;
  status: TaskStatus;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  performance_note: string;
  expected_difficulty: number;
  threads: number;
  rule_description: string;
  target_count: number;
  performance_mode: PerformanceMode;
}

export interface TaskStats {
  task_id: string;
  status: TaskStatus;
  attempts: number;
  found: number;
  rate_per_sec: number;
  elapsed_sec: number;
  eta_sec: number;
  threads: number;
  worker_rates: number[];
  rule_description: string;
}

export interface HitEvent {
  task_id: string;
  wallet: Wallet;
  attempts_at_hit: number;
  is_target_reached: boolean;
}

export interface StoredWalletMeta {
  id: string;
  address: string;
  label: string | null;
  created_at: number;
  source_task_id: string | null;
}

export interface RuleValidation {
  valid: boolean;
  performance_note: string;
  expected_difficulty: number;
  description: string;
}

export type TabKey = "dashboard" | "new_task" | "vault";
