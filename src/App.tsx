import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { NewTaskPanel } from "@/components/tasks/NewTaskPanel";
import { VaultView } from "@/components/vault/VaultView";
import { InitVaultModal } from "@/components/vault/InitVaultModal";
import { UnlockModal } from "@/components/vault/UnlockModal";
import { useApp } from "@/stores/useApp";
import { useTauriEvents } from "@/hooks/useTauriEvents";
import { useIdleAutoLock } from "@/hooks/useIdleAutoLock";
import { api } from "@/lib/tauri";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";

export default function App() {
  useTauriEvents();
  useIdleAutoLock();

  const tab = useApp((s) => s.tab);
  const vaultInitialized = useApp((s) => s.vaultInitialized);
  const vaultUnlocked = useApp((s) => s.vaultUnlocked);
  const setVaultInitialized = useApp((s) => s.setVaultInitialized);
  const loadCpuInfo = useApp((s) => s.loadCpuInfo);
  const language = useApp((s) => s.language);

  const [showInit, setShowInit] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const option = LANGUAGE_OPTIONS.find((item) => item.value === language);
    document.documentElement.lang = option?.htmlLang ?? "zh-CN";
  }, [language]);

  // 启动时必须从 Rust 侧重新读取真实状态，防止刷新页面把前端内存态当事实
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const init = await api.isVaultInitialized();
        if (cancelled) return;
        setVaultInitialized(init);
        try {
          await loadCpuInfo();
        } catch {
          /* */
        }
      } catch {
        /* 极端情况下 IPC 不可用，也不能直接让它进入主界面，按未初始化处理 */
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化弹窗展示逻辑：只有 Rust 侧确认未初始化才弹，并且不能通过关闭绕过
  useEffect(() => {
    if (!bootstrapped) return;
    if (vaultInitialized) {
      setShowInit(false);
      return;
    }
    const t = window.setTimeout(() => {
      setShowInit(true);
    }, 500);
    return () => clearTimeout(t);
  }, [bootstrapped, vaultInitialized]);

  return (
    <>
      <AppShell>
        {vaultUnlocked && tab === "dashboard" && <DashboardView />}
        {vaultUnlocked && tab === "new_task" && <NewTaskPanel />}
        {vaultUnlocked && tab === "vault" && <VaultView />}
      </AppShell>

      <InitVaultModal
        open={showInit && !vaultInitialized}
        onClose={() => {
          if (vaultInitialized) {
            setShowInit(false);
          }
        }}
      />

      <UnlockModal
        open={!!(bootstrapped && vaultInitialized && !vaultUnlocked)}
      />
    </>
  );
}
