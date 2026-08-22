import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Shield,
  Lock,
  Unlock,
  Eye,
  Trash2,
  Download,
  Wallet,
  Database,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { api } from "@/lib/tauri";
import { useApp } from "@/stores/useApp";
import { TermTooltip } from "@/components/terms/TermTooltip";
import { WalletDetailModal } from "@/components/wallets/WalletDetailModal";
import type { StoredWalletMeta, Wallet as IWallet } from "@/types";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useI18n } from "@/lib/i18n";

interface StoredMetaRaw {
  id: string;
  address: string;
  label: string | null;
  created_at: number;
  source_task_id: string | null;
}

export function VaultView() {
  const { language, t } = useI18n();
  const initialized = useApp((s) => s.vaultInitialized);
  const unlocked = useApp((s) => s.vaultUnlocked);
  const sessionPassword = useApp((s) => s.sessionPassword);
  const lockVault = useApp((s) => s.lockVault);

  const [wallets, setWallets] = useState<StoredWalletMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailWallet, setDetailWallet] = useState<IWallet | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSource, setDetailSource] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPw, setExportPw] = useState("");
  const [exportProgress, setExportProgress] = useState("");

  const load = async () => {
    if (!unlocked) return;
    setLoading(true);
    setErr(null);
    try {
      const list = (await api.listVaultWallets()) as StoredMetaRaw[];
      setWallets(
        list.map((x) => ({
          id: x.id,
          address: x.address,
          label: x.label,
          created_at: x.created_at,
          source_task_id: x.source_task_id,
        })),
      );
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [unlocked]);

  const showWallet = async (m: StoredWalletMeta) => {
    if (!unlocked || !sessionPassword) return;
    if (viewingId || removingId || exporting) return;
    setViewingId(m.id);
    setErr(null);
    try {
      const w = await api.decryptWalletFromVault(m.id, sessionPassword);
      setDetailWallet(w);
      setDetailSource(m.source_task_id);
      setDetailOpen(true);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setViewingId(null);
    }
  };

  const remove = async (m: StoredWalletMeta) => {
    if (viewingId || removingId || exporting) return;
    if (!confirm(t("vaultView.confirmDelete", { address: m.address.slice(0, 10) })))
      return;
    setRemovingId(m.id);
    setErr(null);
    try {
      await api.removeWalletFromVault(m.id);
      await load();
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setRemovingId(null);
    }
  };

  const exportCsv = async () => {
    if (!unlocked || !sessionPassword) return;
    if (wallets.length === 0) return;
    if (exporting || viewingId || removingId) return;
    setExportPw("");
    setExportProgress("");
    setErr(null);
    setExportOpen(true);
  };

  const runExportCsv = async () => {
    if (!unlocked || !sessionPassword || wallets.length === 0) return;
    if (exporting) return;
    if (!exportPw) {
      setErr(t("export.requirePassword"));
      return;
    }
    setExporting(true);
    setErr(null);
    try {
      setExportProgress(t("export.verifying"));
      const verifyRes = await api.verifyMasterPassword(exportPw);
      if (!verifyRes.ok) {
        setErr(verifyRes.message ?? t("export.wrongPassword"));
        return;
      }

      const lines = ["address,private_key,label"];
      for (const [index, m] of wallets.entries()) {
        setExportProgress(
          t("export.decrypting", { current: index + 1, total: wallets.length }),
        );
        const w = await api.decryptWalletFromVault(m.id, exportPw);
        lines.push(
          `${w.address},${w.private_key},"${(m.label ?? "").replace(/"/g, '""')}"`,
        );
      }
      const csv = lines.join("\n");
      setExportProgress(t("export.choosePath"));
      const path = await save({ defaultPath: `wallets_export_${Date.now()}.csv` });
      if (path) {
        setExportProgress(t("export.writing"));
        await writeTextFile(path, csv);
        setExportOpen(false);
        setExportPw("");
        setExportProgress("");
      } else {
        setExportProgress("");
      }
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full min-h-0">
      <Card className="col-span-12 border-border/60 shadow-sm flex flex-col min-h-0">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  {t("vaultView.title")}
                  <TermTooltip term="argon2id" />
                </CardTitle>
                <CardDescription className="text-[11px]">
                  {t("vaultView.desc")}
                  <TermTooltip term="master_password" />
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={initialized ? "secondary" : "outline"}>
                {initialized ? t("vaultView.initialized") : t("vaultView.notInitialized")}
              </Badge>
              <Badge variant={unlocked ? "secondary" : "destructive"}>
                {unlocked ? (
                  <span className="flex items-center gap-1">
                    <Unlock className="h-3 w-3" /> {t("vault.unlocked")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3" /> {t("vault.locked")}
                  </span>
                )}
              </Badge>
              {unlocked && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={load}
                    disabled={loading || exporting || !!viewingId || !!removingId}
                    className="gap-1.5 text-[11px] h-8"
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    {loading ? t("common.refreshing") : t("common.refresh")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={exportCsv}
                    disabled={
                      wallets.length === 0 || exporting || loading || !!viewingId || !!removingId
                    }
                    className="gap-1.5 text-[11px] h-8"
                  >
                    {exporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {exporting ? t("vaultView.exporting") : t("vaultView.exportCsv")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={lockVault}
                    className="gap-1.5 text-[11px] h-8 text-destructive hover:text-destructive"
                  >
                    <Lock className="h-3.5 w-3.5" /> {t("vault.lockNow")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {!initialized && (
          <CardContent>
            <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">{t("vaultView.notCreatedTitle")}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("vaultView.notCreatedDesc")}
                </p>
              </div>
            </div>
          </CardContent>
        )}

        {initialized && !unlocked && (
          <CardContent>
            <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm flex items-start gap-2.5">
              <Lock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">{t("vaultView.lockedTitle")}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("vaultView.lockedDesc")}
                </p>
              </div>
            </div>
          </CardContent>
        )}

        {initialized && unlocked && (
          <>
            {err && (
              <CardContent className="pt-0">
                <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2.5 border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  {err}
                </div>
              </CardContent>
            )}
            <CardContent className="flex-1 min-h-0 p-2 pt-0">
              <ScrollArea className="h-full pr-2">
                {loading ? (
                  <div className="py-16 text-center text-xs text-muted-foreground">
                    {t("common.loading")}
                  </div>
                ) : wallets.length === 0 ? (
                  <div className="py-16 text-center text-xs text-muted-foreground px-3">
                    <Wallet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    {t("vaultView.empty")}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-2">
                    {wallets.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-md border border-border/60 bg-card p-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="text-[11px] text-muted-foreground truncate">
                            {m.label ?? t("vaultView.unnamed")}
                          </div>
                          <Badge variant="outline" className="text-[10px]">
                            {new Date(m.created_at * 1000).toLocaleDateString(
                              language,
                            )}
                          </Badge>
                        </div>
                        <code className="text-[12px] font-mono break-all leading-tight">
                          {m.address.slice(0, 16)}…{m.address.slice(-8)}
                        </code>
                        <div className="mt-2.5 flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px] gap-1"
                            onClick={() => showWallet(m)}
                            disabled={!!viewingId || !!removingId || exporting}
                          >
                            {viewingId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                            {viewingId === m.id ? t("common.decrypting") : t("common.view")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px] gap-1 text-destructive hover:text-destructive"
                            onClick={() => remove(m)}
                            disabled={!!viewingId || !!removingId || exporting}
                          >
                            {removingId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            {removingId === m.id ? t("common.deleting") : t("common.delete")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </>
        )}
      </Card>

      <WalletDetailModal
        wallet={detailWallet}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        sourceTaskId={detailSource}
      />

      <Dialog
        open={exportOpen}
        onOpenChange={(next) => {
          if (exporting) return;
          setExportOpen(next);
          if (!next) {
            setExportPw("");
            setExportProgress("");
            setErr(null);
          }
        }}
      >
        <DialogContent className="w-[min(calc(100vw-2rem),34rem)] max-w-none">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-destructive" />
              {t("export.title")}
            </DialogTitle>
            <DialogDescription className="text-left">
              {t("export.desc", { count: wallets.length })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium">{t("export.warnTitle")}</p>
                  <p className="text-destructive/85">
                    {t("export.warnDesc")}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("export.password")}</Label>
              <Input
                type="password"
                value={exportPw}
                onChange={(e) => setExportPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !exporting) void runExportCsv();
                }}
                disabled={exporting}
                placeholder={t("export.placeholder")}
              />
            </div>

            {exportProgress && (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
                {exporting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {exportProgress}
              </div>
            )}

            {err && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-sm text-destructive">
                {err}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runExportCsv()}
              disabled={exporting || !exportPw}
              className="gap-1.5"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? t("vaultView.exporting") : t("export.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
