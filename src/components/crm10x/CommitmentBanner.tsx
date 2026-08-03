import { useCRM10x } from "@/lib/crm10x/store";
import type { Lead } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CalendarClock, CheckCircle2, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

/** Banner that surfaces the lead's own commitment date — separate from agent follow-ups. */
export function CommitmentBanner({ lead }: { lead: Lead }) {
  const commitment = useCRM10x((s) =>
    s.commitments.find((c) => c.leadId === lead.id && c.status === "pending") ?? null);
  const resolve = useCRM10x((s) => s.resolveCommitment);
  if (!commitment) return null;

  const due = new Date(commitment.decisionBy);
  const overdue = due.getTime() < Date.now();
  const tone = overdue ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-warning/50 bg-warning/10";

  return (
    <div className={`mx-5 mt-3 rounded-lg border p-3 flex items-start gap-2 ${tone}`}>
      <CalendarClock className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 text-xs">
        <div className="font-semibold">
          Lead committed to decide by {format(due, "EEE, MMM d")} {overdue && "· OVERDUE"}
        </div>
        <div className="italic text-muted-foreground mt-0.5">"{commitment.exactWords}"</div>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
          onClick={() => { resolve(commitment.id, "kept"); toast.success("Marked kept"); }}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" /> Kept
        </Button>
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
          onClick={() => { resolve(commitment.id, "missed"); toast("Marked missed"); }}
        >
          <X className="h-3 w-3 mr-1" /> Missed
        </Button>
      </div>
    </div>
  );
}
