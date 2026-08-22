import { useEffect, useMemo, useState } from "react";
import type { MatchRule, RuleValidation } from "@/types";
import { api } from "@/lib/tauri";

const BASE_RATE = 10_000_000;

export function useRuleEstimator(rule: MatchRule | null, cpuThreads: number) {
  const [val, setVal] = useState<RuleValidation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rule) {
      setVal(null);
      setErr(null);
      return;
    }
    api
      .validateMatchRule(rule)
      .then((v) => {
        if (!cancelled) {
          setVal(v);
          setErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(String(e));
          setVal(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rule]);

  const rate = useMemo(() => BASE_RATE * (cpuThreads || 1), [cpuThreads]);
  const estSeconds = useMemo(() => {
    if (!val) return NaN;
    return val.expected_difficulty / rate;
  }, [val, rate]);

  return { validation: val, error: err, estRate: rate, estSeconds };
}

export const DIFFICULTY_PRESETS = [
  { key: "easy", label: "轻松 (4位前缀)", hex: 4, approx: "< 1 分钟" },
  { key: "medium", label: "中等 (6位前缀)", hex: 6, approx: "~ 1-5 分钟" },
  { key: "hard", label: "困难 (7位前缀)", hex: 7, approx: "~ 20-60 分钟" },
  { key: "hell", label: "地狱 (8位前缀)", hex: 8, approx: "~ 6 小时" },
] as const;
