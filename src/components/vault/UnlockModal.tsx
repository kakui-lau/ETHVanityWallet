import { useEffect, useState } from "react";
import { Lock, Unlock, AlertTriangle, Clock, RotateCcw, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/useApp";
import { api } from "@/lib/tauri";
import { validateMasterPasswordWithMessage } from "@/lib/password";
import { useI18n } from "@/lib/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * 钱包库解锁弹窗：
 * - open=true（由 useApp.vaultInitialized && !vaultUnlocked 决定）时必须保持显示
 * - 不能通过关闭按钮 / 遮罩点击 / Esc 关闭
 * - 错误 ≥ 5 次 → 触发 Rust 侧 30s 冷却，期间输入框禁用并显示倒计时
 * - 显示 Rust 侧返回的 remaining_attempts / cooldown_seconds
 */
interface VaultStatus {
  initialized: boolean;
  locked: boolean;
  remaining_attempts: number;
  cooldown_seconds: number;
}

interface Props {
  open: boolean;
}

export function UnlockModal({ open }: Props) {
  const { t } = useI18n();
  const vaultInitialized = useApp((s) => s.vaultInitialized);
  const vaultUnlocked = useApp((s) => s.vaultUnlocked);
  const unlockStore = useApp((s) => s.unlockVault);
  const resetEverything = useApp((s) => s.resetEverything);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetPw, setResetPw] = useState("");

  const doReset = async () => {
    if (resetLoading) return;
    if (resetPw.trim() !== "RESET") return;
    setResetLoading(true);
    try {
      await resetEverything();
      setResetStep(0);
      setResetPw("");
      setPw("");
      setErr(null);
      setRemaining(null);
      setCooldown(0);
    } finally {
      setResetLoading(false);
    }
  };

  // 打开弹窗时先拉一次 Rust 侧的状态（尝试次数 / 冷却）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = (await api.vaultStatus?.()) as VaultStatus | undefined;
        if (cancelled) return;
        if (s) {
          setRemaining(Math.max(0, s.remaining_attempts));
          setCooldown(Math.max(0, s.cooldown_seconds));
        }
      } catch {
        /* */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 冷却倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          // 冷却结束，刷新一次 Rust 侧剩余次数
          void (async () => {
            try {
              const s = (await api.vaultStatus?.()) as VaultStatus | undefined;
              if (s) setRemaining(Math.max(0, s.remaining_attempts));
            } catch {
              /* */
            }
          })();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async () => {
    if (loading) return;
    setErr(null);
    if (cooldown > 0) return;
    if (!pw) {
      setErr(t("unlock.passwordRequired"));
      return;
    }
    const formatErr = validateMasterPasswordWithMessage(pw, t("password.tooShort"));
    if (formatErr) {
      setErr(formatErr);
      return;
    }
    setLoading(true);
    try {
      const res = await unlockStore(pw);
      if (res.ok) {
        setPw("");
        setRemaining(null);
        setCooldown(0);
      } else {
        const msg = res.message ?? t("unlock.passwordWrong");
        // 从冷却消息中立即解析出秒数，避免等下一次轮询
        const cdMatch = msg.match(/等待\s*(\d+)\s*秒/);
        if (cdMatch) {
          setCooldown(Math.max(0, Number(cdMatch[1])));
        }
        // 无论是不是冷却，立即拉一次 Rust 侧的 attempt 状态（得到剩余次数+真实冷却）
        try {
          const s = (await api.vaultStatus?.()) as VaultStatus | undefined;
          if (s) {
            setRemaining(Math.max(0, s.remaining_attempts));
            setCooldown(Math.max(0, s.cooldown_seconds));
          }
        } catch {
          /* */
        }
        setPw("");
        // 用户能看到的统一文案（不暴露"格式错误 vs 密码错误"的攻击面）
        setErr(msg.startsWith("错误次数过多") ? msg : t("unlock.passwordWrong"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 不允许用任何方式关闭（Esc / 遮罩 / Close 按钮）
        if (!next && vaultInitialized && !vaultUnlocked) return;
      }}
    >
      <DialogContent
        hideClose
        className="w-[min(calc(100vw-2rem),32rem)] max-w-none pointer-events-auto overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {resetStep === 0 ? (
              <Lock className="h-5 w-5 text-primary" />
            ) : (
              <Trash2 className="h-5 w-5 text-destructive" />
            )}
            {resetStep === 0 ? t("unlock.title") : t("unlock.resetTitle")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {resetStep === 0
              ? t("unlock.desc")
              : t("unlock.resetDesc")}
          </DialogDescription>
        </DialogHeader>
        {resetStep === 0 && (
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label>{t("unlock.password")}</Label>
              <Input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) void submit();
                }}
                autoFocus
                disabled={loading || cooldown > 0}
                placeholder={
                  cooldown > 0
                    ? t("unlock.cooldownPlaceholder")
                    : t("unlock.placeholder")
                }
              />
            </div>

            {(remaining !== null && remaining < 5) || cooldown > 0 ? (
              <div
                className={
                  "text-sm flex items-start gap-2 rounded-md p-2 border " +
                  (cooldown > 0
                    ? "text-amber-200 bg-amber-500/10 border-amber-500/30"
                    : "text-orange-200 bg-orange-500/10 border-orange-500/30")
                }
              >
                {cooldown > 0 ? (
                  <>
                    <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {t("unlock.cooldownMsg", { seconds: cooldown })}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {t("unlock.remainingMsg", {
                        remaining: remaining ?? "-",
                        times: Math.max(1, remaining ?? 1),
                      })}
                    </span>
                  </>
                )}
              </div>
            ) : null}

            {err && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 border border-destructive/20">
                {err}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="flex-col items-stretch gap-3 space-x-0 sm:flex-col sm:justify-start sm:space-x-0">
          {resetStep === 0 ? (
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setResetStep(1);
                        setErr(null);
                        setPw("");
                        setResetPw("");
                      }}
                      disabled={loading || resetLoading || cooldown > 0}
                      className="gap-1.5 text-destructive/80 hover:text-destructive hover:bg-destructive/5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> {t("unlock.resetLink")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-xs text-xs">
                    <p className="font-semibold text-destructive mb-1">
                      {t("unlock.resetIrreversible")}
                    </p>
                    <p className="text-muted-foreground">
                      {t("unlock.resetTip")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex shrink-0 gap-2 justify-end">
                <Button
                  onClick={submit}
                  disabled={loading || cooldown > 0}
                  className="gap-2">
                  <Unlock className="h-4 w-4" />
                  {loading ? t("unlock.checking") : t("unlock.submit")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="w-full min-w-0 rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-start gap-2 text-xs">
                <Trash2 className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold text-destructive">
                    {t("reset.warningTitle")}
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-0.5 pl-0.5">
                    <li>{t("reset.itemWallets")}</li>
                    <li>{t("reset.itemPassword")}</li>
                    <li>{t("reset.itemTasks")}</li>
                  </ul>

                  {resetStep === 1 && (
                    <div className="pt-2 text-foreground/90">
                      <p>{t("reset.step1")}</p>
                      <div className="mt-2 flex flex-wrap gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setResetStep(0)}
                          disabled={resetLoading}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setResetStep(2)}
                          disabled={resetLoading}
                          className="gap-1.5"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" /> {t("reset.continue")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {resetStep === 2 && (
                    <div className="pt-2 space-y-2">
                      <p className="text-foreground/90">
                        {t("reset.step2")}{" "}
                        <code className="font-mono bg-muted px-1 rounded-sm border border-border/60 mx-1">
                          RESET
                        </code>
                      </p>
                      <Input
                        type="text"
                        value={resetPw}
                        onChange={(e) => setResetPw(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && resetPw.trim() === "RESET" && !resetLoading)
                            void doReset();
                        }}
                        placeholder={t("reset.placeholder")}
                        disabled={resetLoading}
                        className="mt-1"
                      />
                      <div className="flex flex-wrap gap-2 justify-end pt-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setResetStep(1);
                            setResetPw("");
                          }}
                          disabled={resetLoading}
                        >
                          {t("common.back")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void doReset()}
                          disabled={resetPw.trim() !== "RESET" || resetLoading}
                          className="gap-1.5"
                        >
                          {resetLoading ? t("reset.running") : t("reset.final")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
