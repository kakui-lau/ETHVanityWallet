import {
  LayoutDashboard,
  PlusCircle,
  Shield,
  Eye,
  EyeOff,
  Globe,
  Lock,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useApp } from "@/stores/useApp";
import type { TabKey } from "@/types";
import { VanityLogo } from "@/components/icons/VanityLogo";
import { useState } from "react";
import { ChangePasswordModal } from "@/components/vault/ChangePasswordModal";
import { ToastContainer, toast } from "@/components/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGE_OPTIONS, useI18n } from "@/lib/i18n";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { language, t } = useI18n();
  const setLanguage = useApp((s) => s.setLanguage);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const privacyMode = useApp((s) => s.privacyMode);
  const togglePrivacy = useApp((s) => s.togglePrivacy);
  const vaultUnlocked = useApp((s) => s.vaultUnlocked);
  const lockVault = useApp((s) => s.lockVault);
  const autoLockAt = useApp((s) => s.autoLockAt);

  const [showChange, setShowChange] = useState(false);
  const tabs: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      key: "dashboard",
      label: t("nav.dashboard"),
      icon: <LayoutDashboard className="h-4 w-4" />,
      desc: t("nav.dashboardDesc"),
    },
    {
      key: "new_task",
      label: t("nav.newTask"),
      icon: <PlusCircle className="h-4 w-4" />,
      desc: t("nav.newTaskDesc"),
    },
    {
      key: "vault",
      label: t("nav.vault"),
      icon: <Shield className="h-4 w-4" />,
      desc: t("nav.vaultDesc"),
    },
  ];

  const minsLeft = (() => {
    if (!vaultUnlocked || !autoLockAt) return null;
    const s = Math.max(0, Math.ceil((autoLockAt - Date.now()) / 1000 / 60));
    return s;
  })();

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground overflow-hidden">
      <header className="grid grid-cols-[minmax(15rem,1fr)_auto_minmax(15rem,1fr)] items-center gap-3 px-3 py-2 border-b border-border/60 bg-background/80 backdrop-blur shrink-0 z-10">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center shrink-0"
            style={{
              background:
                "radial-gradient(90% 120% at 20% 10%, rgba(16,240,200,0.22), rgba(16,240,200,0) 60%), radial-gradient(90% 120% at 90% 90%, rgba(232,121,249,0.25), rgba(232,121,249,0) 60%), linear-gradient(135deg,#0b1422 0%,#0e2130 55%,#1a0f2e 100%)",
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.08) inset,0 8px 28px -10px rgba(34,211,238,0.55),0 10px 30px -14px rgba(168,85,247,0.65)",
            }}
          >
            <VanityLogo size={26} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight">
              <span className="truncate">ETH Vanity Wallet Generator</span>
              <span className="text-[10px] text-muted-foreground font-mono align-super">
                v0.1.0
              </span>
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">
              {t("app.subtitle")}
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-muted/50 rounded-md p-1 border border-border/60">
          {tabs.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "ghost"}
              size="sm"
              className={`h-8 px-3 text-[12px] gap-1.5 ${
                tab === t.key ? "" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab(t.key)}
              title={t.desc}
            >
              {t.icon}
              {t.label}
            </Button>
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className={
              "h-8 px-2 gap-1.5 text-[11.5px] " +
              (privacyMode
                ? "bg-destructive/10 border-destructive/40 text-destructive hover:bg-destructive/15"
                : "")
            }
            onClick={() => {
              togglePrivacy();
              const next = !privacyMode;
              if (next) {
                toast({
                  kind: "warning",
                  title: t("privacy.privateToastTitle"),
                  desc: t("privacy.privateToastDesc"),
                  ttlMs: 2800,
                });
              } else {
                toast({
                  kind: "success",
                  title: t("privacy.normalToastTitle"),
                  desc: t("privacy.normalToastDesc"),
                  ttlMs: 2400,
                });
              }
            }}
            title={
              privacyMode
                ? t("privacy.privateTitle")
                : t("privacy.normalTitle")
            }
          >
            {privacyMode ? (
              <EyeOff className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {privacyMode ? t("privacy.private") : t("privacy.normal")}
          </Button>

          <div
            className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-muted/25 px-2 text-[10.5px] text-muted-foreground"
            title={
              vaultUnlocked && minsLeft !== null
                ? `${t("vault.statusName")} ${t("vault.unlocked")} · ${t("vault.autoLock", {
                    minutes: minsLeft,
                  })}`
                : `${t("vault.statusName")} ${
                    vaultUnlocked ? t("vault.unlocked") : t("vault.locked")
                  }`
            }
          >
            <Shield className="h-3.5 w-3.5" />
            <span className={vaultUnlocked ? "text-emerald-400" : "text-amber-400"}>
              {vaultUnlocked ? t("vault.unlocked") : t("vault.locked")}
            </span>
            {vaultUnlocked && minsLeft !== null ? (
              <span className="font-mono text-[10px] text-muted-foreground/80">
                {minsLeft}m
              </span>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title={t("vault.changePassword")}
            aria-label={t("vault.changePassword")}
            disabled={!vaultUnlocked}
            onClick={() => setShowChange(true)}
          >
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title={t("vault.lockTitle")}
            aria-label={t("vault.lockNow")}
            disabled={!vaultUnlocked}
            onClick={() => lockVault()}
          >
            <Lock className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger
              title={t("language.title")}
              aria-label={t("language.title")}
              className="h-8 w-8 justify-center border-border/60 px-0 text-muted-foreground hover:bg-accent hover:text-foreground [&>span]:hidden [&>svg:last-child]:hidden"
            >
              <Globe className="h-4 w-4 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="min-w-[9rem]">
              {LANGUAGE_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span className="flex items-center justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="text-[10px] text-muted-foreground">{item.shortLabel}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <main
        className={
          "flex-1 min-h-0 overflow-hidden transition-opacity duration-150 " +
          (vaultUnlocked ? "p-3 opacity-100" : "p-0 opacity-0 pointer-events-none")
        }
      >
        {vaultUnlocked ? children : null}
      </main>
      <ChangePasswordModal open={showChange} onClose={() => setShowChange(false)} />
      <ToastContainer />
    </div>
  );
}
