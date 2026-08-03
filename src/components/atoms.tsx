import { cn } from "@/lib/utils";
import type { Intent, LeadStage } from "@/lib/types";

export function IntentChip({ intent, className }: { intent: Intent; className?: string }) {
  const map = {
    hot: "bg-destructive/10 text-destructive border-destructive/20",
    warm: "bg-warning/15 text-warning-foreground border-warning/30",
    cold: "bg-info/10 text-info border-info/20",
  } as const;
  const label = { hot: "Hot", warm: "Warm", cold: "Cold" }[intent];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        map[intent],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function StageBadge({ stage, tags }: { stage: LeadStage; tags?: string[] }) {
  // No-show demotes funnel stage to "contacted" so rebooking works — but the
  // operational badge should still say No-show until the tag is cleared on rebook.
  if (tags?.includes("no-show")) {
    return (
      <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium bg-destructive/10 text-destructive border-destructive/20">
        No-show
      </span>
    );
  }
  const map: Record<LeadStage, string> = {
    "new": "bg-info/10 text-info border-info/20",
    "contacted": "bg-secondary text-secondary-foreground border-border",
    "tour-scheduled": "bg-accent/10 text-accent border-accent/30",
    "tour-done": "bg-success/10 text-success border-success/20",
    "negotiation": "bg-warning/15 text-warning-foreground border-warning/30",
    "booked": "bg-success text-success-foreground border-transparent",
    "dropped": "bg-muted text-muted-foreground border-border",
  };
  const label: Record<LeadStage, string> = {
    "new": "New",
    "contacted": "Contacted",
    "tour-scheduled": "Tour Scheduled",
    "tour-done": "Tour Done",
    "negotiation": "Negotiation",
    "booked": "Booked",
    "dropped": "Dropped",
  };
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", map[stage])}>
      {label[stage]}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 75 ? "bg-destructive" : value >= 50 ? "bg-warning" : "bg-info";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{value}</span>
    </div>
  );
}

export function KpiCard({
  label, value, sub, tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "accent" | "success" | "warning" | "destructive";
}) {
  const toneCls = {
    default: "",
    accent: "text-accent",
    success: "text-success",
    warning: "text-warning-foreground",
    destructive: "text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:shadow-sm transition-shadow">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
