import { useMemo, useState } from "react";
import { Shield, Lock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
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
import { TermTooltip } from "@/components/terms/TermTooltip";
import { api } from "@/lib/tauri";
import { useApp } from "@/stores/useApp";
import {
  PASSWORD_RULE_LABELS,
  checkMasterPassword,
  validateMasterPasswordWithMessage,
} from "@/lib/password";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose?: () => void;
}

export function InitVaultModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const setVaultInitialized = useApp((s) => s.setVaultInitialized);
  const lockVault = useApp((s) => s.lockVault);
  const unlockVault = useApp((s) => s.unlockVault);

  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const check = useMemo(() => checkMasterPassword(p1), [p1]);
  const match = !!p2 && p1 === p2;

  const submit = async () => {
    if (loading) return;
    setErr(null);
    const formatErr = validateMasterPasswordWithMessage(p1, t("password.tooShort"));
    if (formatErr) {
      setErr(formatErr);
      return;
    }
    if (!match) {
      setErr(t("init.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await api.initMasterPassword(p1);
      setVaultInitialized(true);
      lockVault();
      const res = await unlockVault(p1);
      if (!res.ok) {
        onClose?.();
        setErr(t("init.autoUnlockFailed"));
        return;
      }
      setP1("");
      setP2("");
      setErr(null);
      onClose?.();
    } catch (e: any) {
      const message = String(e ?? t("init.createFailed"));
      if (message.includes("已设置主密码")) {
        setVaultInitialized(true);
        lockVault();
        setP1("");
        setP2("");
        setErr(null);
        onClose?.();
        return;
      }
      setErr(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent hideClose className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Shield className="h-5 w-5 text-primary" /> {t("init.title")}
            <TermTooltip term="master_password" />
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("init.desc")}
            <TermTooltip term="argon2id" />
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("init.setPassword")}</Label>
              {p1 && (
                <span
                  className={
                    "text-[11px] " +
                    (check.strong
                      ? "text-emerald-500"
                      : "text-muted-foreground")
                  }
                >
                  {check.strong ? t("init.requirementsOk") : t("init.requirementsTodo")}
                </span>
              )}
            </div>
            <Input
              type="password"
              value={p1}
              onChange={(e) => setP1(e.target.value)}
              placeholder={t("init.placeholder")}
              aria-describedby="init-pw-rules"
            />
            <ul
              id="init-pw-rules"
              className="grid grid-cols-1 gap-y-1.5 pt-1 sm:grid-cols-2 sm:gap-x-4"
            >
              {PASSWORD_RULE_LABELS.map((r) => {
                const ok = check[r.key];
                return (
                  <li
                    key={r.key}
                    className={
                      "flex items-center gap-1.5 text-[11.5px] " +
                      (ok
                        ? "text-emerald-500"
                        : p1
                          ? "text-destructive/90"
                          : "text-muted-foreground")
                    }
                  >
                    {ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : p1 ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/50 shrink-0" />
                    )}
                    {r.key === "lengthOk" ? t("password.lengthRule") : r.label}
                  </li>
                );
              })}
              <li
                className={
                  "flex items-center gap-1.5 text-[11.5px] " +
                  (p1 && match
                    ? "text-emerald-500"
                    : p2
                      ? "text-destructive/90"
                      : "text-muted-foreground")
                }
              >
                {p1 && match ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : p2 ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/50 shrink-0" />
                )}
                {t("init.matchRule")}
              </li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label>{t("init.repeatPassword")}</Label>
            <Input
              type="password"
              value={p2}
              onChange={(e) => setP2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void submit();
              }}
              placeholder={t("init.repeatPlaceholder")}
            />
          </div>
          {err && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 border border-destructive/20">
              {err}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {loading ? t("init.creating") : t("init.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
