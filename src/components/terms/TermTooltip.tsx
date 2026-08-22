import { HelpCircle } from "lucide-react";
import { TERM_TIPS, type TermInfo } from "@/lib/terms";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function TermTooltip({ term }: { term: keyof typeof TERM_TIPS }) {
  const info: TermInfo | undefined = TERM_TIPS[term];
  if (!info) return null;
  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/70 inline-flex shrink-0 cursor-help align-[-0.2em] ml-1 hover:text-muted-foreground transition-colors" />
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-relaxed">
          <p className="font-semibold text-foreground mb-1">{info.title}</p>
          <p className="text-muted-foreground">{info.desc}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
