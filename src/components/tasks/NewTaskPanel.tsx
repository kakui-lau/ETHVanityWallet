import { useMemo, useState } from "react";
import {
  Cpu,
  Rocket,
  Gauge,
  Zap,
  Info,
  Plus,
  AlertTriangle,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useRuleEstimator, DIFFICULTY_PRESETS } from "@/hooks/useRuleEstimator";
import type { MatchRule, PerformanceMode } from "@/types";
import { useApp } from "@/stores/useApp";
import { TermTooltip } from "@/components/terms/TermTooltip";
import { useI18n } from "@/lib/i18n";

type Mode =
  | { kind: "prefix"; value: string }
  | { kind: "suffix"; value: string }
  | { kind: "contains"; value: string }
  | { kind: "combo"; prefix: string; suffix: string }
  | { kind: "regex"; value: string }
  | { kind: "wordlist"; text: string };

function toRule(m: Mode): MatchRule | null {
  switch (m.kind) {
    case "prefix":
      if (!m.value.trim()) return null;
      return { mode: "prefix", value: m.value.trim() };
    case "suffix":
      if (!m.value.trim()) return null;
      return { mode: "suffix", value: m.value.trim() };
    case "contains":
      if (!m.value.trim()) return null;
      return { mode: "contains", value: m.value.trim() };
    case "combo": {
      const rules: MatchRule[] = [];
      if (m.prefix.trim()) rules.push({ mode: "prefix", value: m.prefix.trim() });
      if (m.suffix.trim()) rules.push({ mode: "suffix", value: m.suffix.trim() });
      if (rules.length === 0) return null;
      return { mode: "combo", rules };
    }
    case "regex":
      if (!m.value.trim()) return null;
      return { mode: "regex", pattern: m.value.trim() };
    case "wordlist": {
      const words = m.text
        .split(/\s+|,|;|\r?\n/)
        .map((w) => w.trim())
        .filter(Boolean);
      if (words.length === 0) return null;
      return { mode: "word_list", words };
    }
  }
}

export function NewTaskPanel() {
  const { t } = useI18n();
  const threads = useApp((s) => s.cpuThreads) || 8;
  const recommended = useApp((s) => s.cpuRecommended) || Math.max(1, threads - 1);
  const setTab = useApp((s) => s.setTab);

  const [kind, setKind] = useState<Mode["kind"]>("prefix");
  const [simpleValue, setSimpleValue] = useState("");
  const [comboPrefix, setComboPrefix] = useState("");
  const [comboSuffix, setComboSuffix] = useState("");
  const [regexValue, setRegexValue] = useState("");
  const [wlValue, setWlValue] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState(1);
  const [perf, setPerf] = useState<PerformanceMode>("balanced");
  const [threadOverride, setThreadOverride] = useState<number>(recommended);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const createTask = useApp((s) => s.createTask);
  const startTask = useApp((s) => s.startTask);
  const setActiveTaskId = useApp((s) => s.setActiveTaskId);

  const mode = useMemo<Mode>(() => {
    switch (kind) {
      case "prefix":
        return { kind, value: simpleValue };
      case "suffix":
        return { kind, value: simpleValue };
      case "contains":
        return { kind, value: simpleValue };
      case "combo":
        return { kind, prefix: comboPrefix, suffix: comboSuffix };
      case "regex":
        return { kind, value: regexValue };
      case "wordlist":
        return { kind, text: wlValue };
    }
  }, [kind, simpleValue, comboPrefix, comboSuffix, regexValue, wlValue]);

  const rule = useMemo(() => toRule(mode), [mode]);
  const { validation, estSeconds } = useRuleEstimator(rule, threadOverride);

  const applyPreset = (_hex: number, v: string) => {
    setKind("prefix");
    setSimpleValue(v);
  };

  const modeLabel = (k: Mode["kind"]) =>
    k === "combo" ? t("task.comboName") : t(`task.${k}`);

  const describeRule = (m: Mode): string => {
    switch (m.kind) {
      case "prefix":
        return m.value.trim()
          ? t("task.descPrefix", { value: m.value.trim().replace(/^0x/i, "") })
          : "-";
      case "suffix":
        return m.value.trim()
          ? t("task.descSuffix", { value: m.value.trim().replace(/^0x/i, "") })
          : "-";
      case "contains":
        return m.value.trim()
          ? t("task.descContains", { value: m.value.trim().replace(/^0x/i, "") })
          : "-";
      case "combo": {
        const parts = [
          m.prefix.trim()
            ? t("task.descPrefix", { value: m.prefix.trim().replace(/^0x/i, "") })
            : "",
          m.suffix.trim()
            ? t("task.descSuffix", { value: m.suffix.trim().replace(/^0x/i, "") })
            : "",
        ].filter(Boolean);
        return parts.length ? t("task.descCombo", { parts: parts.join(" ∧ ") }) : "-";
      }
      case "regex":
        return m.value.trim() ? t("task.descRegex", { value: m.value.trim() }) : "-";
      case "wordlist": {
        const count = m.text
          .split(/\s+|,|;|\r?\n/)
          .map((w) => w.trim())
          .filter(Boolean).length;
        return count ? t("task.descWordlist", { count }) : "-";
      }
    }
  };

  const performanceNote = (m: Mode): string => {
    if (!rule) return t("task.waitingRule");
    switch (m.kind) {
      case "prefix":
      case "suffix":
        return t("task.notePrefixSuffix");
      case "contains":
        return t("task.noteContains");
      case "combo":
        return t("task.noteCombo");
      case "regex":
        return t("task.noteRegex");
      case "wordlist":
        return t("task.noteWordlist");
    }
  };

  const submit = async () => {
    if (creating) return;
    setErr(null);
    if (!rule) {
      setErr(t("task.errorNoRule"));
      return;
    }
    if (!validation?.valid) {
      setErr(t("task.errorInvalidRule"));
      return;
    }
    setCreating(true);
    try {
      const finalName =
        name.trim() ||
        t("task.defaultName", {
          mode: modeLabel(mode.kind),
          value:
            "value" in mode && mode.value
              ? t("task.valueSuffix", { value: mode.value })
              : "",
        });
      const id = await createTask({
        name: finalName,
        rule,
        target_count: target,
        performance_mode: perf,
        thread_override: threadOverride,
      });
      setActiveTaskId(id);
      setTab("dashboard");
      void setTimeout(() => startTask(id), 50);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
  };

  const pct =
    validation && validation.expected_difficulty > 0
      ? Math.min(
          100,
          (Math.log10(Math.max(1, validation.expected_difficulty)) / 12) * 100,
        )
      : 0;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            {t("task.title")}
            <TermTooltip term="vanity" />
          </CardTitle>
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Cpu className="h-3 w-3" />
            {t("task.cpuCores", { count: threads })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <Tabs defaultValue="prefix" onValueChange={(v) => setKind(v as Mode["kind"])}>
          <TabsList className="grid grid-cols-6 w-full h-9">
            <TabsTrigger value="prefix">{t("task.prefix")}</TabsTrigger>
            <TabsTrigger value="suffix">{t("task.suffix")}</TabsTrigger>
            <TabsTrigger value="contains">{t("task.contains")}</TabsTrigger>
            <TabsTrigger value="combo">{t("task.combo")}</TabsTrigger>
            <TabsTrigger value="regex">{t("task.regex")}</TabsTrigger>
            <TabsTrigger value="wordlist">{t("task.wordlist")}</TabsTrigger>
          </TabsList>

          <TabsContent value="prefix" className="space-y-3 pt-3">
            <Label>{t("task.prefixLabel")} <TermTooltip term="address_prefix" /></Label>
            <Input
              value={simpleValue}
              onChange={(e) => setSimpleValue(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, ""))}
              placeholder={t("task.prefixPlaceholder")}
              className="font-mono"
            />
            <div className="flex flex-wrap gap-1.5">
              {DIFFICULTY_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.hex, "0".repeat(p.hex))}
                  className="text-[11px] px-2 py-1 rounded border border-border/60 hover:bg-accent transition-colors flex items-center gap-1"
                  type="button"
                >
                  {t(`task.preset${p.key[0].toUpperCase()}${p.key.slice(1)}`)}{" "}
                  <span className="text-muted-foreground">
                    {t(`task.preset${p.key[0].toUpperCase()}${p.key.slice(1)}Approx`)}
                  </span>
                  <ChevronRight className="h-3 w-3 opacity-50" />
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="suffix" className="space-y-3 pt-3">
            <Label>{t("task.suffixLabel")}</Label>
            <Input
              value={simpleValue}
              onChange={(e) => setSimpleValue(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, ""))}
              placeholder={t("task.suffixPlaceholder")}
              className="font-mono"
            />
          </TabsContent>

          <TabsContent value="contains" className="space-y-3 pt-3">
            <Label>{t("task.containsLabel")}</Label>
            <Input
              value={simpleValue}
              onChange={(e) => setSimpleValue(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, ""))}
              placeholder="dead"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("task.containsHelp")}
            </p>
          </TabsContent>

          <TabsContent value="combo" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("task.prefix")}</Label>
                <Input
                  value={comboPrefix}
                  onChange={(e) =>
                    setComboPrefix(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, ""))
                  }
                  placeholder="0x0000"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("task.suffix")}</Label>
                <Input
                  value={comboSuffix}
                  onChange={(e) =>
                    setComboSuffix(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, ""))
                  }
                  placeholder="8888"
                  className="font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {t("task.comboHelp")}
            </p>
          </TabsContent>

          <TabsContent value="regex" className="space-y-3 pt-3">
            <Label>{t("task.regexLabel")} <TermTooltip term="regex" /></Label>
            <Input
              value={regexValue}
              onChange={(e) => setRegexValue(e.target.value)}
              placeholder={t("task.regexPlaceholder")}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("task.regexHelp")}
            </p>
          </TabsContent>

          <TabsContent value="wordlist" className="space-y-3 pt-3">
            <Label>{t("task.wordlistLabel")}</Label>
            <textarea
              value={wlValue}
              onChange={(e) => setWlValue(e.target.value)}
              rows={5}
              placeholder={`cafe\ndead\nbeef\nbabe\n8888\nabc123`}
              className="font-mono text-xs w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("task.wordlistHelp")}
            </p>
          </TabsContent>
        </Tabs>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("task.name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("task.namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("task.targetCount")}</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={target}
              onChange={(e) =>
                setTarget(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              {t("task.performanceMode")} <TermTooltip term="performance_mode" />
            </Label>
            <Select value={perf} onValueChange={(v) => setPerf(v as PerformanceMode)}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="power_saver">
                  <span className="flex items-center gap-2">
                    <Gauge className="h-3.5 w-3.5 text-emerald-500" />
                    {t("task.powerSaver")}
                  </span>
                </SelectItem>
                <SelectItem value="balanced">
                  <span className="flex items-center gap-2">
                    <Rocket className="h-3.5 w-3.5 text-blue-500" />
                    {t("task.balanced")}
                  </span>
                </SelectItem>
                <SelectItem value="turbo">
                  <span className="flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    {t("task.turbo")}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>
              {t("task.workerThreads")} <TermTooltip term="worker_threads" />
              <span className="ml-1 text-muted-foreground text-[11px]">
                {t("task.workerSummary", { current: threadOverride, total: threads })}
              </span>
            </Label>
          </div>
          <Slider
            value={[threadOverride]}
            min={1}
            max={Math.max(threads, recommended, 1)}
            step={1}
            onValueChange={([v]) => setThreadOverride(v)}
          />
        </div>

        <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              {t("task.difficulty")}
              <TermTooltip term="expected_difficulty" />
            </div>
            <Badge variant={validation?.valid ? "secondary" : "outline"} className="text-[11px]">
              {performanceNote(mode)}
            </Badge>
          </div>
          <Progress value={pct} />
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <p className="text-muted-foreground">{t("task.expectedAttempts")}</p>
              <p className="font-mono text-foreground">
                {validation ? formatBig(validation.expected_difficulty) : "-"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("task.estimatedTime")}</p>
              <p className="font-mono text-foreground">
                {!isNaN(estSeconds) ? formatDuration(estSeconds, t) : "-"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("task.ruleDescription")}</p>
              <p className="text-foreground truncate" title={rule ? describeRule(mode) : ""}>
                {rule ? describeRule(mode) : "-"}
              </p>
            </div>
          </div>
        </div>

        {err && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2.5 border border-destructive/20 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => {
              setTab("dashboard");
            }}
          >
            {t("task.backDashboard")}
          </Button>
          <Button
            onClick={submit}
            disabled={creating || !validation?.valid}
            className="gap-1.5"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {creating ? t("task.creating") : t("task.createAndStart")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatBig(n: number): string {
  if (!isFinite(n)) return "∞";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return (n / 1000).toFixed(2) + "K";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n < 1_000_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  return (n / 1_000_000_000_000).toFixed(2) + "T";
}

function formatDuration(
  sec: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!isFinite(sec)) return "∞";
  if (sec < 60) return Math.round(sec) + "s";
  if (sec < 3600) return t("task.durationMinutes", { count: Math.round(sec / 60) });
  if (sec < 86400) return t("task.durationHours", { count: (sec / 3600).toFixed(1) });
  return t("task.durationDays", { count: (sec / 86400).toFixed(2) });
}
