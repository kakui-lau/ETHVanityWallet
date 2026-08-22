import { useEffect } from "react";
import { useApp } from "@/stores/useApp";

/**
 * 全局闲置自动锁定（10 分钟无任何交互 → 清空 sessionPassword 并回到解锁弹窗）
 * - 监听 document 级别的 keydown / mousedown / wheel / touchstart
 * - 被触发后重置 autoLockAt = now + 10min
 * - 每秒检查一次，到点自动 lockVault
 */
const AUTO_LOCK_MS = 10 * 60 * 1000;

export function useIdleAutoLock() {
  const unlock = useApp((s) => s.vaultUnlocked);
  const lockVault = useApp((s) => s.lockVault);
  const resetIdleTimer = useApp((s) => s.resetIdleTimer);
  const autoLockAt = useApp((s) => s.autoLockAt);

  useEffect(() => {
    const onAny = () => resetIdleTimer();
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("keydown", onAny, opts);
    window.addEventListener("mousedown", onAny, opts);
    window.addEventListener("wheel", onAny, opts);
    window.addEventListener("touchstart", onAny, opts);
    return () => {
      window.removeEventListener("keydown", onAny, opts as any);
      window.removeEventListener("mousedown", onAny, opts as any);
      window.removeEventListener("wheel", onAny, opts as any);
      window.removeEventListener("touchstart", onAny, opts as any);
    };
  }, [resetIdleTimer]);

  useEffect(() => {
    if (!unlock) return;
    const t = window.setInterval(() => {
      if (autoLockAt && Date.now() >= autoLockAt) {
        lockVault();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [unlock, autoLockAt, lockVault]);

  // 首次挂载时即使不交互也初始化倒计时，避免 unlock 后一直不进 useEffect 依赖更新
  useEffect(() => {
    if (unlock) {
      const st = useApp.getState();
      if (!st.autoLockAt) {
        resetIdleTimer();
      }
    }
    void AUTO_LOCK_MS;
  }, [unlock, resetIdleTimer]);
}
