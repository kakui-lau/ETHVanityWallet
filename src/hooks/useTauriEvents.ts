import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/stores/useApp";

export function useTauriEvents() {
  const onStats = useApp((s) => s.onStatsEvent);
  const onHit = useApp((s) => s.onHit);
  const onTaskEnd = useApp((s) => s.onTaskEnd);
  const refreshTasks = useApp((s) => s.refreshTasks);
  const pollAllStats = useApp((s) => s.pollAllStats);
  const setVaultInitialized = useApp((s) => s.setVaultInitialized);
  const loadCpuInfo = useApp((s) => s.loadCpuInfo);
  const listVault = useApp((s) => s.setSessionPassword);
  void listVault;

  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    loadCpuInfo();
    api.isVaultInitialized().then(setVaultInitialized);
    refreshTasks();
    pollAllStats();

    const unlistens: Promise<() => void>[] = [
      listen("vanity://stats", onStats),
      listen("vanity://hit", (e) => {
        onHit(e);
        pollAllStats();
      }),
      listen("vanity://task_end", (e) => {
        const payload = e.payload as any;
        onTaskEnd(payload.task_id);
      }),
    ];

    const interval = window.setInterval(() => {
      pollAllStats();
    }, 1500);

    return () => {
      Promise.all(unlistens).then((fns) => fns.forEach((f) => f()));
      clearInterval(interval);
    };
  }, [
    onStats,
    onHit,
    onTaskEnd,
    refreshTasks,
    pollAllStats,
    setVaultInitialized,
    loadCpuInfo,
  ]);
}

import { api } from "@/lib/tauri";
