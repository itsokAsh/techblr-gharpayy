import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowUpRight, UserPlus } from "lucide-react";
import type { RouteSuggestion } from "@/lib/routing";
import { getTcm } from "@/lib/store";
import type { UnifiedLead } from "@/lib/lead-identity/types";
import { openCrmLeadForUnified } from "@/lib/lead-identity/bridge";

interface Props {
  unified: UnifiedLead;
  assignment: RouteSuggestion;
  onAddAnother?: () => void;
}

export function LeadSaveSuccess({ unified, assignment, onAddAnother }: Props) {
  const tcm = getTcm(assignment.tcmId);

  return (
    <div className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm">Lead saved to CRM</h3>
          <p className="text-sm text-foreground mt-0.5">
            <span className="font-medium">{unified.name}</span>
            <span className="text-muted-foreground"> · {unified.area || unified.areas?.[0] || "—"}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Assigned to <span className="font-medium text-foreground">{tcm?.name ?? "TCM"}</span>
            {tcm?.zone ? ` · ${tcm.zone}` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {assignment.reasons.slice(0, 4).map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px] font-normal">
                {r}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={() => openCrmLeadForUnified(unified.ulid)}
        >
          Open lead <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" asChild>
          <Link to="/leads">
            View in list <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
        {onAddAnother && (
          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={onAddAnother}>
            <UserPlus className="h-3.5 w-3.5" /> Add another
          </Button>
        )}
      </div>
    </div>
  );
}
