import { useState } from "react";
import { KeyRound, Lock, Loader2 } from "lucide-react";
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
import { api } from "@/lib/tauri";
import { useApp } from "@/stores/useApp";
import { validateMasterPasswordWithMessage } from "@/lib/password";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose?: () => void;
}

export function ChangePasswordModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const [oldPw, setOldPw] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const unlockVault = useApp((s) => s.unlockVault);

  const closeAndClear = () => {
    setOldPw("");
    setP1("");
    setP2("");
    setErr(null);
    setLoading(false);
    onClose?.();
  };

  const submit = async () => {
    if (loading) return;
    setErr(null);
    if (!oldPw) {
      setErr(t("change.requireCurrent"));
      return;
    }
    if (oldPw === p1 && p1) {
      setErr(t("change.samePassword"));
      return;
    }
    const formatErr = validateMasterPasswordWithMessage(p1, t("password.tooShort"));
    if (formatErr) {
      setErr(formatErr);
      return;
    }
    if (p1 !== p2) {
      setErr(t("change.mismatch"));
      return;
    }
    setLoading(true);
    try {
      await api.changeMasterPassword({
        old_password: oldPw,
        new_password: p1,
      });
      // 改密成功：必须**重新 Rust 验证新密码**成功后才能写入 sessionPassword；
      // 任何 unlockVault 失败都绝对不允许 fallback 写新密码
      const res = await unlockVault(p1);
      if (!res.ok) {
        setErr(t("change.unlockFailed"));
        return;
      }
      closeAndClear();
    } catch (e: any) {
      setErr(String(e ?? t("change.failed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeAndClear()}>
      <DialogContent hideClose className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-primary" /> {t("change.title")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("change.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("change.current")}</Label>
            <Input
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("change.new")}</Label>
            <Input
              type="password"
              value={p1}
              onChange={(e) => setP1(e.target.value)}
              placeholder={t("init.placeholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("change.repeat")}</Label>
            <Input
              type="password"
              value={p2}
              onChange={(e) => setP2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void submit();
              }}
            />
          </div>
          {err && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 border border-destructive/20">
              {err}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={closeAndClear} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={loading} className="gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {loading ? t("change.loading") : t("change.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
