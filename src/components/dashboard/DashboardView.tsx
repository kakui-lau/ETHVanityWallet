import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/tauri";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ResponsiveContainer,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  Search,
  Target,
  Clock,
  Cpu,
  Gauge,
  Play,
  Pause,
  Square,
  Trash2,
  ArrowRight,
  ChevronRight,
  Eye,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useApp } from "@/stores/useApp";
import type { VanityTask, Wallet, TaskStats } from "@/types";
import { formatHashrate, formatNumber, formatSeconds } from "@/lib/utils";
import { TermTooltip } from "@/components/terms/TermTooltip";
import { WalletDetailModal } from "@/components/wallets/WalletDetailModal";
import { useI18n } from "@/lib/i18n";

const TIME_PRESETS = [
  { key: "1m", labelKey: "dash.time1m", count: 24 },
  { key: "5m", labelKey: "dash.time5m", count: 120 },
  { key: "15m", labelKey: "dash.time15m", count: 360 },
  { key: "1h", labelKey: "dash.time1h", count: 1440 },
] as const;

const STATUS_COLOR: Record<string, string> = {
  created: "bg-slate-500",
  running: "bg-emerald-500",
  paused: "bg-amber-500",
  completed: "bg-blue-500",
  cancelled: "bg-slate-600",
  failed: "bg-red-500",
};

export function DashboardView() {
  const { language, t } = useI18n();
  const tasks = useApp((s) => s.tasks);
  const activeId = useApp((s) => s.activeTaskId);
  const setActiveId = useApp((s) => s.setActiveTaskId);
  const stats = useApp((s) => s.taskStats);
  const history = useApp((s) => s.statsHistory);
  const hits = useApp((s) => s.hits);
  const privacyMode = useApp((s) => s.privacyMode);
  const start = useApp((s) => s.startTask);
  const pause = useApp((s) => s.pauseTask);
  const resume = useApp((s) => s.resumeTask);
  const cancel = useApp((s) => s.cancelTask);
  const remove = useApp((s) => s.removeTask);
  const refreshResults = useApp((s) => s.refreshTaskResults);
  const refreshTasks = useApp((s) => s.refreshTasks);
  const pollStats = useApp((s) => s.pollAllStats);

  const [timePreset, setTimePreset] =
    useState<(typeof TIME_PRESETS)[number]["key"]>("5m");
  const [detailWallet, setDetailWallet] = useState<Wallet | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSource, setDetailSource] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectingTaskId, setSelectingTaskId] = useState<string | null>(null);
  const [taskAction, setTaskAction] = useState<{
    id: string;
    action: "start" | "pause" | "resume" | "cancel" | "remove";
  } | null>(null);

  const current: VanityTask | undefined = useMemo(() => {
    if (activeId) return tasks.find((t) => t.id === activeId);
    return tasks.find((t) => t.status === "running") ?? tasks[0];
  }, [activeId, tasks]);

  const currentStats = current ? stats[current.id] : undefined;
  const currentHits = current ? hits[current.id] ?? [] : [];
  const currentHistory = current ? history[current.id] ?? [] : [];

  // 选中任务切换时，主动拉一次 stats + 命中结果，防止右侧数据残留为上一个任务
  useEffect(() => {
    if (!current) return;
    void (async () => {
      try {
        const s = (await api.getTaskStats(current.id)) as TaskStats;
        useApp.setState((st) => ({
          taskStats: { ...st.taskStats, [current.id]: s },
        }));
      } catch {
        /* noop */
      }
      const old = useApp.getState().hits[current.id];
      if (!old || old.length === 0) {
        await refreshResults(current.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const windowCount = TIME_PRESETS.find((p) => p.key === timePreset)!.count;
  const chartData = currentHistory.slice(-windowCount).map((p) => ({
    t: new Date(p.t).toLocaleTimeString(language, { hour12: false }),
    rate: +(p.rate / 1_000_000).toFixed(2),
    attempts: p.attempts,
    found: p.found,
  }));

  const aggRate = currentStats?.rate_per_sec ?? 0;
  const aggAttempts = currentStats?.attempts ?? 0;
  const aggFound = currentStats?.found ?? 0;
  const aggElapsed = currentStats?.elapsed_sec ?? 0;
  const workerRates = currentStats?.worker_rates ?? [];
  const maxWorker = Math.max(1, ...workerRates);

  const progressPct = useMemo(() => {
    if (!current) return 0;
    const expected = Math.max(1, current.expected_difficulty);
    return Math.min(100, Math.log10(Math.max(1, aggAttempts)) / Math.log10(expected) * 100);
  }, [current, aggAttempts]);

  const openDetail = (w: Wallet, sourceId: string | null) => {
    setDetailWallet(w);
    setDetailSource(sourceId);
    setDetailOpen(true);
  };

  const isTaskBusy = (id?: string) =>
    !!id && (taskAction?.id === id || selectingTaskId === id);

  const runTaskAction = async (
    id: string,
    action: "start" | "pause" | "resume" | "cancel" | "remove",
    fn: (id: string) => Promise<void>,
  ) => {
    if (taskAction) return;
    setTaskAction({ id, action });
    try {
      await fn(id);
    } finally {
      setTaskAction(null);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-full min-h-0">
      {/* 任务侧栏 */}
      <Card className="col-span-3 min-h-0 border-border/60 shadow-sm flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> {t("dash.tasks")}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  if (refreshing) return;
                  setRefreshing(true);
                  void Promise.all([refreshTasks(), pollStats()]).finally(() =>
                    setRefreshing(false),
                  );
                }}
                disabled={refreshing}
              >
                {refreshing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                {refreshing ? t("common.refreshing") : t("common.refresh")}
              </Button>
            </div>
          </div>
          <CardDescription className="text-[11px]">
            {t("dash.taskCount", {
              total: tasks.length,
              running: tasks.filter((t) => t.status === "running").length,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-2 pt-0">
          <ScrollArea className="h-full pr-2">
            {tasks.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-10 px-3">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                {t("dash.noTasksSide")}
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => useApp.getState().setTab("new_task")}
                  >
                    <ArrowRight className="h-4 w-4" /> {t("dash.createNow")}
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              {tasks.map((task) => {
                const s = stats[task.id];
                const isActive = current?.id === task.id;
                return (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => {
                      if (selectingTaskId || taskAction) return;
                      void (async () => {
                        setSelectingTaskId(task.id);
                        try {
                          await setActiveId(task.id);
                          await refreshResults(task.id);
                        } finally {
                          setSelectingTaskId(null);
                        }
                      })();
                    }}
                    disabled={isTaskBusy(task.id)}
                    className={`w-full text-left rounded-md border p-2.5 transition-colors ${
                      isActive
                        ? "border-primary/60 bg-primary/5"
                        : "border-border/60 hover:bg-accent/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                          STATUS_COLOR[task.status]
                        }`}
                      />
                      <span className="text-xs font-medium truncate flex-1">
                        {task.name}
                      </span>
                      {selectingTaskId === task.id && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{t(`dash.status.${task.status}`)}</span>
                      <span>·</span>
                      <span className="truncate max-w-[110px]">
                        {task.rule_description}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] font-mono text-muted-foreground">
                      <span>
                        {t("dash.hits")} <span className="text-foreground">{s?.found ?? 0}</span>
                        /{task.target_count}
                      </span>
                      <span className="truncate">
                        {s?.rate_per_sec
                          ? formatHashrate(s.rate_per_sec)
                          : "—"}
                      </span>
                      <span className="text-right truncate">
                        {s?.elapsed_sec ? formatSeconds(s.elapsed_sec) : "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 主仪表盘 */}
      <div className="col-span-6 min-h-0 flex flex-col gap-4">
        {!current ? (
          <Card className="border-border/60 shadow-sm flex-1 min-h-0 flex items-center justify-center">
            <div className="text-center max-w-sm px-6">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium mb-1">{t("dash.noTasksTitle")}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {t("dash.noTasksDesc")}
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => useApp.getState().setTab("new_task")}
              >
                <ArrowRight className="h-4 w-4" /> {t("dash.createTask")}
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      {t("dash.performance")}
                      {current && (
                        <Badge variant="secondary" className="text-[11px] ml-1">
                          {current.name.length > 32
                            ? current.name.slice(0, 32) + "…"
                            : current.name}
                        </Badge>
                      )}
                  </CardTitle>
                  <CardDescription className="text-[11px] pt-1">
                        {t("dash.currentTask")}
                        {current ? (
                          <>
                            <span
                              className={`inline-block w-1.5 h-1.5 rounded-full mx-1 align-middle ${
                                STATUS_COLOR[current.status]
                              }`}
                            />
                            {t(`dash.status.${current.status}`)}
                            {current.error && (
                              <span className="ml-2 text-amber-500/90">
                                · {current.error}
                              </span>
                            )}
                          </>
                        ) : (
                          t("dash.noTask")
                        )}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  {TIME_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      variant={timePreset === p.key ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setTimePreset(p.key)}
                    >
                      {t(p.labelKey)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0 pb-4 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <KpiCard
                  icon={<Activity className="h-4 w-4 text-emerald-500" />}
                  label={t("dash.rate")}
                  value={formatHashrate(aggRate)}
                  sub={t("dash.workersEnabled", { count: current?.threads ?? 0 })}
                />
                <KpiCard
                  icon={<Search className="h-4 w-4 text-blue-500" />}
                  label={t("dash.attempts")}
                  value={formatNumber(aggAttempts)}
                  sub={t("dash.searchScale", {
                    scale: aggAttempts > 0 ? Math.log10(aggAttempts).toFixed(2) : "—",
                  })}
                />
                <KpiCard
                  icon={<Target className="h-4 w-4 text-amber-500" />}
                  label={t("dash.found")}
                  value={String(aggFound)}
                  sub={t("dash.target", { count: current?.target_count ?? 0 })}
                />
                <KpiCard
                  icon={<Clock className="h-4 w-4 text-purple-500" />}
                  label={t("dash.elapsed")}
                  value={formatSeconds(aggElapsed)}
                  sub={
                    currentStats && currentStats.eta_sec
                      ? t("dash.eta", { time: formatSeconds(currentStats.eta_sec) })
                      : t("dash.etaCalculating")
                  }
                />
              </div>

              <div className="rounded-md border border-border/60 bg-muted/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <InfoIcon />
                    {t("dash.progress")}
                    <TermTooltip term="expected_difficulty" />
                  </div>
                  <div className="font-mono">
                    {current
                      ? formatNumber(current.expected_difficulty)
                      : "—"}
                  </div>
                </div>
                <Progress value={progressPct} />
                <p className="text-[10px] text-muted-foreground">
                  {t("dash.progressHelp")}
                </p>
              </div>

              <Card className="border-border/50 shadow-none bg-muted/20">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-[12px] flex items-center gap-1.5">
                    {t("dash.rateChart")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="py-1 px-1 h-44">
                  {chartData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                      {t("dash.noRateData")}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartData}
                        margin={{ top: 6, right: 8, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="rate-g" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.55} />
                            <stop
                              offset="95%"
                              stopColor="#22c55e"
                              stopOpacity={0.02}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border) / 0.5)"
                        />
                        <XAxis
                          dataKey="t"
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          stroke="hsl(var(--border))"
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          stroke="hsl(var(--border))"
                          width={36}
                        />
                        <RechartsTooltip
                          labelStyle={{ fontSize: 11 }}
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            fontSize: 11,
                            borderRadius: 6,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="rate"
                          stroke="#22c55e"
                          fill="url(#rate-g)"
                          strokeWidth={1.5}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <div className="rounded-md border border-border/60 bg-muted/10 p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("dash.workerLoad")}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {t("dash.workerCount", { count: workerRates.length })}
                  </span>
                </div>
                {workerRates.length === 0 && (
                  <div className="text-[10px] text-muted-foreground py-2">
                    {t("dash.workerNoData")}
                  </div>
                )}
                <div className="grid grid-cols-8 gap-1">
                  {workerRates.map((r, i) => {
                  const pct = Math.round((r / maxWorker) * 100);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="h-14 relative rounded-sm bg-muted/60 overflow-hidden border border-border/50">
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-emerald-600 to-emerald-400"
                          style={{ height: `${pct}%` }}
                        />
                        <div className="absolute inset-0 flex items-end justify-center pb-0.5 text-[9px] font-mono text-foreground/80">
                          {pct}%
                        </div>
                      </div>
                      <div className="text-center text-[9px] text-muted-foreground font-mono">
                        W{i}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {current?.status === "created" && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      runTaskAction(current.id, "start", start)
                    }
                    disabled={isTaskBusy(current.id)}
                  >
                    {taskAction?.id === current.id && taskAction.action === "start" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {taskAction?.id === current.id && taskAction.action === "start"
                      ? t("dash.starting")
                      : t("dash.start")}
                  </Button>
                )}
                {current?.status === "running" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      runTaskAction(current.id, "pause", pause)
                    }
                    disabled={isTaskBusy(current.id)}
                  >
                    {taskAction?.id === current.id && taskAction.action === "pause" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                    {taskAction?.id === current.id && taskAction.action === "pause"
                      ? t("dash.pausing")
                      : t("dash.pause")}
                  </Button>
                )}
                {current?.status === "paused" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      runTaskAction(current.id, "resume", resume)
                    }
                    disabled={isTaskBusy(current.id)}
                  >
                    {taskAction?.id === current.id && taskAction.action === "resume" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {taskAction?.id === current.id && taskAction.action === "resume"
                      ? t("dash.resuming")
                      : t("dash.resume")}
                  </Button>
                )}
                {(current?.status === "running" ||
                  current?.status === "paused") && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5"
                    onClick={() =>
                      runTaskAction(current.id, "cancel", cancel)
                    }
                    disabled={isTaskBusy(current.id)}
                  >
                    {taskAction?.id === current.id && taskAction.action === "cancel" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    {taskAction?.id === current.id && taskAction.action === "cancel"
                      ? t("dash.cancelling")
                      : t("dash.cancel")}
                  </Button>
                )}
                {(current?.status === "completed" ||
                  current?.status === "cancelled" ||
                  current?.status === "failed" ||
                  current?.status === "created") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() =>
                      runTaskAction(current.id, "remove", remove)
                    }
                    disabled={isTaskBusy(current.id)}
                  >
                    {taskAction?.id === current.id && taskAction.action === "remove" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {taskAction?.id === current.id && taskAction.action === "remove"
                      ? t("common.deleting")
                      : t("common.delete")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 ml-auto"
                  onClick={() => useApp.getState().setTab("new_task")}
                >
                  <ChevronRight className="h-4 w-4" /> {t("dash.newTask")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 命中结果 */}
      <Card className="col-span-3 min-h-0 border-border/60 shadow-sm flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> {t("dash.hits")}
            </CardTitle>
            <Badge variant="outline" className="text-[11px]">
              {t("dash.hitCount", { count: current ? currentHits.length : 0 })}
            </Badge>
          </div>
            <CardDescription className="text-[11px]">
              {current ? t("dash.hitsDescUnsaved") : t("dash.hitsDescWaiting")}
            </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="flex-1 min-h-0 p-0">
          <ScrollArea className="h-full">
            {currentHits.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-16 px-3">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                {t("dash.noHits")}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {currentHits.map((h, idx) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() =>
                      openDetail(h.wallet, current?.id ?? null)
                    }
                    className="w-full text-left px-3 py-2.5 hover:bg-accent/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        #{idx + 1}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {t("dash.attemptsAtHit", {
                          count: formatNumber(h.attempts_at_hit),
                        })}
                      </Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-[12px] truncate">
                      <HighlightAddress
                        addr={h.wallet.address}
                        masked={privacyMode}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {new Date(h.timestamp).toLocaleTimeString(language, {
                          hour12: false,
                        })}
                      </span>
                      <span className="flex items-center gap-1 text-primary">
                        {t("dash.viewDetail")} <Eye className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <WalletDetailModal
        wallet={detailWallet}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        sourceTaskId={detailSource}
      />
    </div>
  );
}

function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 text-muted-foreground"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold font-mono tracking-tight leading-none">
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[10px] text-muted-foreground font-mono">
          {sub}
        </div>
      )}
    </div>
  );
}

function HighlightAddress({
  addr,
  masked,
}: {
  addr: string;
  masked?: boolean;
}) {
  if (!addr.startsWith("0x")) return <>{addr}</>;
  if (masked) {
    const first = addr.slice(0, 8);
    const last = addr.slice(-6);
    return (
      <span>
        <span className="text-amber-400/80">{first}</span>
        <span className="text-muted-foreground/80 tracking-widest">••••</span>
        <span className="text-emerald-400/80">{last}</span>
      </span>
    );
  }
  const hex = addr.slice(2);
  const prefixRun = runLength(hex);
  const suffixRun = runLength([...hex].reverse().join(""));
  const pre = "0x" + hex.slice(0, prefixRun);
  const mid = hex.slice(prefixRun, hex.length - suffixRun);
  const suf = hex.slice(hex.length - suffixRun);
  return (
    <span className="flex-wrap">
      {prefixRun > 0 && <span className="text-emerald-400">{pre}</span>}
      <span>{mid}</span>
      {suffixRun > 0 && <span className="text-amber-400">{suf}</span>}
    </span>
  );
}

function runLength(s: string): number {
  if (!s) return 0;
  const c = s[0];
  let i = 0;
  while (i < s.length && s[i] === c) i++;
  return i >= 2 ? i : 0;
}
