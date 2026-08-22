import { useState } from "react";
import { Eye, EyeOff, Copy, Save, Download, QrCode, CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/tauri";
import type { Wallet } from "@/types";
import { useApp } from "@/stores/useApp";
import { TermTooltip } from "@/components/terms/TermTooltip";
import { validateMasterPasswordWithMessage } from "@/lib/password";
import { useI18n } from "@/lib/i18n";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

type Format = "private_key" | "address" | "csv" | "keystore_v3";

const PRESS_HOLD_MS = 1500;

export function WalletDetailModal({
  wallet,
  open,
  onOpenChange,
  sourceTaskId,
}: {
  wallet: Wallet | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
  sourceTaskId?: string | null;
}) {
  const { t } = useI18n();
  const privacyMode = useApp((s) => s.privacyMode);
  const sessionPassword = useApp((s) => s.sessionPassword);
  const vaultUnlocked = useApp((s) => s.vaultUnlocked);
  const listVaultWallets = useApp.getState().refreshTasks;
  void listVaultWallets;

  const [revealed, setRevealed] = useState(false);
  const [, setHoldStart] = useState<number | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [copiedSk, setCopiedSk] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [format, setFormat] = useState<Format>("private_key");
  const [ksPw, setKsPw] = useState("");
  const [ksPw2, setKsPw2] = useState("");
  const [exportText, setExportText] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const reset = () => {
    setRevealed(false);
    setHoldStart(null);
    setHoldProgress(0);
    setCopiedAddr(false);
    setCopiedSk(false);
    setSaved(false);
    setSaveLoading(false);
    setExportText(null);
    setKsPw("");
    setKsPw2("");
    setQrSvg(null);
    setQrOpen(false);
    setDownloadLoading(false);
    setSaveErr(null);
  };

  const onClose = (b: boolean) => {
    if (!b) reset();
    onOpenChange(b);
  };

  const startHold = () => {
    if (privacyMode) return;
    setHoldProgress(0);
    setHoldStart(Date.now());
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / PRESS_HOLD_MS);
      setHoldProgress(p);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        setRevealed(true);
      }
    };
    requestAnimationFrame(tick);
  };
  const stopHold = () => {
    if (!revealed) {
      setHoldStart(null);
      setHoldProgress(0);
    }
  };
  const copy = async (text: string, kind: "addr" | "sk") => {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "addr") {
        setCopiedAddr(true);
        setTimeout(() => setCopiedAddr(false), 1500);
      } else {
        setCopiedSk(true);
        setTimeout(() => setCopiedSk(false), 1500);
      }
    } catch {
      /* ignore */
    }
  };

  const saveWallet = async () => {
    if (!wallet || !vaultUnlocked) return;
    if (saveLoading) return;
    setSaveErr(null);
    setSaveLoading(true);
    try {
      await api.saveWalletToVault({
        wallet,
        password: sessionPassword,
        label: null,
        source_task_id: sourceTaskId ?? null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setSaveErr(String(e));
    } finally {
      setSaveLoading(false);
    }
  };

  const loadQr = async () => {
    if (!wallet) return;
    if (qrLoading) return;
    setQrLoading(true);
    setQrSvg(null);
    try {
      const svg = await api.generateQrSvg(wallet.address, 280);
      setQrSvg(svg);
    } catch (e: any) {
      setSaveErr(String(e));
    } finally {
      setQrLoading(false);
    }
  };

  const doExport = async () => {
    if (!wallet) return;
    setExportLoading(true);
    setSaveErr(null);
    try {
      if (format === "keystore_v3") {
        const formatErr = validateMasterPasswordWithMessage(ksPw, t("password.tooShort"));
        if (formatErr) {
          setSaveErr(t("wallet.exportPasswordPrefix") + formatErr);
          return;
        }
        if (ksPw !== ksPw2) {
          setSaveErr(t("wallet.exportPasswordMismatch"));
          return;
        }
      }
      const text = await api.exportWalletText({
        wallet,
        format,
        keystore_password: format === "keystore_v3" ? ksPw : undefined,
      });
      setExportText(text);
    } catch (e: any) {
      setSaveErr(String(e));
    } finally {
      setExportLoading(false);
    }
  };

  const downloadFile = async () => {
    if (!exportText || !wallet) return;
    if (downloadLoading) return;
    setDownloadLoading(true);
    setSaveErr(null);
    try {
      const ext =
        format === "keystore_v3"
          ? "json"
          : format === "csv"
          ? "csv"
          : "txt";
      const suffix = wallet.address.slice(2, 8);
      const defaultName =
        format === "keystore_v3"
          ? `UTC--${new Date().toISOString().replace(/:/g, "-")}--${suffix}.json`
          : `wallet_${suffix}.${ext}`;
      const path = await save({ defaultPath: defaultName });
      if (path) {
        await writeTextFile(path, exportText);
      }
    } catch (e: any) {
      setSaveErr(String(e));
    } finally {
      setDownloadLoading(false);
    }
  };

  const showSk = revealed && !privacyMode;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[min(calc(100vw-2rem),56rem)] max-w-none overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {t("wallet.title")} <Badge variant="outline" className="text-xs font-mono font-normal">
              {wallet?.address.slice(0, 10)}…{wallet?.address.slice(-6)}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-left">
            {t("wallet.desc")}
            <TermTooltip term="secp256k1" />
            <TermTooltip term="keccak256" />
          </DialogDescription>
        </DialogHeader>

        {wallet && (
          <div className="min-w-0 space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("wallet.address")}
                </Label>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
                <code className="min-w-0 rounded-md bg-muted/40 border border-border/60 px-3 py-2 text-sm font-mono break-all select-all">
                  {wallet.address}
                </code>
                <div className="flex flex-wrap gap-2 xl:flex-nowrap xl:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(wallet.address, "addr")}
                    className="shrink-0 gap-1.5"
                  >
                    {copiedAddr ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copiedAddr ? t("wallet.copied") : t("wallet.copy")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setQrOpen(true);
                      void loadQr();
                    }}
                    disabled={qrLoading}
                    className="shrink-0 gap-1.5"
                  >
                    {qrLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="h-4 w-4" />
                    )}
                    {qrLoading ? t("wallet.generating") : t("wallet.qr")}
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <div className="flex items-center">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("wallet.privateKey")}
                  <TermTooltip term="private_key" />
                </Label>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative min-w-0 rounded-md bg-muted/40 border border-border/60 px-3 py-2 min-h-[40px]">
                  {!showSk && (
                    <code className="block max-w-full overflow-hidden font-mono text-sm text-muted-foreground tracking-wider select-none">
                      {privacyMode ? "•".repeat(28) : "•".repeat(64)}
                    </code>
                  )}
                  {showSk && (
                    <code className="block font-mono text-sm break-all select-all text-amber-400/90">
                      {wallet.private_key}
                    </code>
                  )}
                  {holdProgress > 0 && holdProgress < 1 && !revealed && !privacyMode && (
                    <div
                      className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width]"
                      style={{ width: `${Math.round(holdProgress * 100)}%` }}
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-2 xl:flex-nowrap xl:justify-end">
                  {!revealed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onMouseDown={(e) => {
                        if (privacyMode) return;
                        e.preventDefault();
                        startHold();
                      }}
                      onMouseUp={stopHold}
                      onMouseLeave={stopHold}
                      onTouchStart={(e) => {
                        if (privacyMode) return;
                        e.preventDefault();
                        startHold();
                      }}
                      onTouchEnd={stopHold}
                      disabled={privacyMode}
                      title={
                        privacyMode
                          ? t("wallet.privacyViewTitle")
                          : t("wallet.holdTitle")
                      }
                      className={
                        "shrink-0 gap-1.5 " +
                        (privacyMode ? "opacity-70 cursor-not-allowed" : "")
                      }
                    >
                      <Eye className="h-4 w-4" />
                      {privacyMode ? t("wallet.privacyDisabled") : t("wallet.holdToReveal")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRevealed(false)}
                      className="shrink-0 gap-1.5"
                    >
                      <EyeOff className="h-4 w-4" /> {t("wallet.hide")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!showSk}
                    onClick={() => copy(wallet.private_key, "sk")}
                    title={
                      privacyMode
                        ? t("wallet.privacyCopyTitle")
                        : t("wallet.copyPrivateKey")
                    }
                    className="shrink-0 gap-1.5"
                  >
                    {copiedSk ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 pt-1">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t("wallet.holdHelp")}
                </p>
                {privacyMode ? (
                  <p className="text-[11px] text-destructive leading-relaxed inline-flex items-center gap-1">
                    <EyeOff className="h-3 w-3" />
                    {t("wallet.privacyHelp")}
                  </p>
                ) : null}
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2 items-center">
              <Button
                variant={saved ? "secondary" : "default"}
                disabled={!vaultUnlocked || saved || saveLoading}
                onClick={saveWallet}
                className="gap-1.5"
              >
                {saveLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveLoading
                  ? t("wallet.saving")
                  : saved
                    ? t("wallet.saved")
                    : t("wallet.save")}
              </Button>
              {!vaultUnlocked && (
                <span className="text-xs text-muted-foreground">
                  {t("wallet.needUnlock")}
                </span>
              )}
              {saveErr && (
                <span className="min-w-0 text-xs text-destructive sm:ml-auto">{saveErr}</span>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("wallet.export")}
                  <TermTooltip term="keystore_v3" />
                </Label>
                <Select
                  value={format}
                  onValueChange={(v) => {
                    setFormat(v as Format);
                    setExportText(null);
                  }}
                >
                  <SelectTrigger className="h-8 w-full text-xs sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private_key">{t("wallet.formatPrivateKey")}</SelectItem>
                    <SelectItem value="address">{t("wallet.formatAddress")}</SelectItem>
                    <SelectItem value="csv">{t("wallet.formatCsv")}</SelectItem>
                    <SelectItem value="keystore_v3">
                      {t("wallet.formatKeystore")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {format === "keystore_v3" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("wallet.exportPassword")}</Label>
                    <Input
                      type="password"
                      value={ksPw}
                      onChange={(e) => setKsPw(e.target.value)}
                      placeholder={t("wallet.passwordPlaceholder")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("wallet.confirmPassword")}</Label>
                    <Input
                      type="password"
                      value={ksPw2}
                      onChange={(e) => setKsPw2(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doExport}
                  disabled={exportLoading || downloadLoading}
                  className="gap-1.5"
                >
                  {exportLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {exportLoading ? t("wallet.generating") : t("wallet.generateExport")}
                </Button>
                {exportText && (
                  <Button
                    size="sm"
                    onClick={downloadFile}
                    disabled={downloadLoading || exportLoading}
                    className="gap-1.5"
                  >
                    {downloadLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {downloadLoading ? t("wallet.saving") : t("wallet.saveFile")}
                  </Button>
                )}
              </div>
              {exportText && (
                <pre className="rounded-md bg-muted/30 border border-border/60 p-3 text-[11px] max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono">
                  {exportText}
                </pre>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t("wallet.close")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">{t("wallet.qrTitle")}</DialogTitle>
            <DialogDescription className="text-center text-xs font-mono">
              {wallet?.address}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrLoading && (
              <div className="h-[280px] w-[280px] bg-muted rounded-md animate-pulse flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {qrSvg && (
              <div
                className="bg-white rounded-md p-2"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}
            <p className="text-[11px] text-muted-foreground text-center max-w-xs">
              {t("wallet.qrHelp")}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
