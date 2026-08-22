import { useEffect, useState } from "react";
import { create } from "zustand";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "warning" | "error";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  desc?: string;
  ttlMs: number;
}

interface ToastState {
  items: ToastItem[];
  show: (t: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
}

let __id = 1;
export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  show: (t) => {
    const id = __id++;
    const next = { ...t, id };
    set((s) => ({ items: [...s.items, next] }));
    window.setTimeout(() => {
      const list = get().items;
      if (list.some((x) => x.id === id)) {
        set((s) => ({ items: s.items.filter((x) => x.id !== id) }));
      }
    }, t.ttlMs);
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export function toast(t: Omit<ToastItem, "id"> | string, kind?: ToastKind) {
  let payload: Omit<ToastItem, "id">;
  if (typeof t === "string") {
    payload = { kind: kind ?? "info", title: t, ttlMs: 2400 };
  } else {
    payload = {
      kind: t.kind,
      title: t.title,
      desc: t.desc,
      ttlMs: t.ttlMs ?? 2400,
    };
  }
  return useToastStore.getState().show(payload);
}

const ICON: Record<ToastKind, React.ReactNode> = {
  info: <Info className="h-4 w-4 text-sky-400" />,
  success: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  error: <AlertTriangle className="h-4 w-4 text-destructive" />,
};

const BORDER: Record<ToastKind, string> = {
  info: "border-sky-500/30",
  success: "border-emerald-500/30",
  warning: "border-amber-500/30",
  error: "border-destructive/40",
};

export function ToastContainer() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2 items-end w-[min(360px,calc(100vw-2rem))]">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto rounded-lg border bg-background/90 backdrop-blur px-3 py-2.5 shadow-lg",
            "animate-in slide-in-from-top-4 fade-in-0 duration-200",
            BORDER[t.kind],
          )}
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5 shrink-0">{ICON[t.kind]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug">{t.title}</div>
              {t.desc ? (
                <div className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                  {t.desc}
                </div>
              ) : null}
            </div>
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors -mr-0.5 -mt-0.5"
              onClick={() => dismiss(t.id)}
              aria-label="关闭提示"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
