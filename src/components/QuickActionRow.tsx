import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Phone, MessageSquare, ClipboardCheck, ChevronRight } from "lucide-react";
import { ConfidenceBar, IntentChip, StageBadge } from "./atoms";
import { SlaPulse } from "./SlaPulse";
import { toast } from "sonner";
import type { Lead } from "@/lib/types";
import { liveConfidence, type SlaState } from "@/lib/engine";
import { useMountedNow } from "@/hooks/use-now";
import { maskPhoneDisplay } from "@/lib/lead-identity/normalize";

/**
 * One row, one decision. Inline call/WA/done without opening a drawer.
 * Clicking the body opens the full Lead Control Panel.
 */
export function QuickActionRow({
  lead, reason, accent, dueLabel, onDone, onOpen, slaState, ctaLabel, onPrimary,
}: {
  lead: Lead;
  reason?: string;
  accent?: "destructive" | "accent" | "warning" | "default";
  dueLabel?: string;
  onDone?: () => void;
  /** Override default selectLead(lead.id) — e.g. open post-tour tab. */
  onOpen?: () => void;
  slaState?: SlaState;
  /** Primary runbook CTA label (e.g. Fill post-tour). */
  ctaLabel?: string;
  onPrimary?: () => void;
}) {
  const { selectLead, logCall, sendMessage, tcms, tours } = useApp();
  const [now, mounted] = useMountedNow();
  const tcm = tcms.find((t) => t.id === lead.assignedTcmId);
  // Confidence bar can show live score; temperature chip must stay on stored intent
  // so logging a call (fast responseSpeed) does not flip Warm → Hot.
  const live = mounted ? liveConfidence(lead, tours, now) : lead.confidence;
  const open = onOpen ?? (() => selectLead(lead.id));
  const primary = onPrimary ?? open;

  const ring = {
    destructive: "border-l-destructive",
    accent: "border-l-accent",
    warning: "border-l-warning",
    default: "border-l-transparent",
  }[accent ?? "default"];

  return (
    <div className={`group grid grid-cols-12 items-center gap-2 px-3 py-2.5 border-l-2 ${ring} hover:bg-accent/5 transition-colors`}>
      <button onClick={open} className="col-span-4 text-left min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{lead.name}</span>
          <IntentChip intent={lead.intent} />
          {slaState && slaState !== "ok" && <SlaPulse state={slaState} />}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {reason ?? `${maskPhoneDisplay(lead.phone)} · ${lead.preferredArea}`}
        </div>
      </button>

      <div className="col-span-2 hidden md:block"><StageBadge stage={lead.stage} tags={lead.tags} /></div>
      <div className="col-span-2"><ConfidenceBar value={live} /></div>
      <div className="col-span-1 hidden lg:block text-[11px] text-muted-foreground truncate">
        {tcm?.initials}
      </div>
      <div className="col-span-1 hidden md:block text-[11px] font-mono text-muted-foreground truncate">
        {dueLabel ?? ""}
      </div>

      <div className="col-span-12 md:col-span-2 flex items-center justify-end gap-1 flex-wrap">
        {ctaLabel && (
          <Button
            size="sm"
            className="h-7 text-[11px] px-2"
            onClick={(e) => { e.stopPropagation(); primary(); }}
          >
            {ctaLabel}
          </Button>
        )}
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); logCall(lead.id); toast.success(`Call logged · ${lead.name}`); }}
          title="Log call"
        >
          <Phone className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); sendMessage(lead.id, "WhatsApp template sent"); toast.success(`WA sent · ${lead.name}`); }}
          title="WhatsApp"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
        {onDone && (
          <Button
            size="icon" variant="ghost" className="h-7 w-7 text-success"
            onClick={(e) => { e.stopPropagation(); onDone(); toast.success("Marked done"); }}
            title="Mark done"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          onClick={open}
          title="Open"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
