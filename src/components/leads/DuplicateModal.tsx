import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ShieldAlert, Search, Sparkles, ArrowRight } from "lucide-react";
import type { MatchResult, UnifiedLead } from "@/lib/lead-identity/types";
import { OwnershipBadge } from "./OwnershipBadge";
import { formatDistanceToNow } from "date-fns";
import { maskPhoneDisplay } from "@/lib/lead-identity/normalize";

interface Props {
  open: boolean;
  onClose: () => void;
  result: MatchResult | null;
  onForceCreate: () => void;       // user confirmed it really is new
  onUseExisting: (lead: UnifiedLead) => void;
}

export function DuplicateModal({ open, onClose, result, onForceCreate, onUseExisting }: Props) {
  if (!result) return null;
  const { type, candidates } = result;

  const header = {
    exact: { icon: ShieldAlert, title: "Lead already exists", color: "text-destructive", desc: "An exact match was found. You cannot create a duplicate." },
    strong: { icon: AlertTriangle, title: "Likely duplicate", color: "text-warning", desc: "Strong match found. Confirm whether this is a new lead or the same person." },
    possible: { icon: Search, title: "Possible duplicate", color: "text-amber-500", desc: "Some signals match. You can proceed but please double-check." },
    new: { icon: Sparkles, title: "New lead", color: "text-primary", desc: "No matches found. Safe to create." },
  }[type];

  const Icon = header.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${header.color}`}>
            <Icon className="h-5 w-5" /> {header.title}
          </DialogTitle>
          <DialogDescription>
            {header.desc}{" "}
            <span className="text-muted-foreground">Phones shown masked (ops PII policy).</span>
          </DialogDescription>
        </DialogHeader>

        {candidates.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {candidates.map((c) => (
              <div key={c.lead.ulid} className="rounded-lg border border-border p-3 bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{c.lead.name}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {maskPhoneDisplay(c.lead.phoneE164 || c.lead.phoneRaw)} · {c.lead.area || "no area"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Last activity{" "}
                      {(() => {
                        const d = new Date(c.lead.lastActivityAt);
                        return Number.isNaN(d.getTime())
                          ? "recently"
                          : formatDistanceToNow(d, { addSuffix: true });
                      })()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold">{c.score}<span className="text-muted-foreground">/100</span></div>
                    <div className="text-[10px] text-muted-foreground">{c.reasons.slice(0, 2).join(", ")}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <OwnershipBadge lead={c.lead} compact />
                  {type !== "exact" && (
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={() => onUseExisting(c.lead)}>
                      Use this <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                  {type === "exact" && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onUseExisting(c.lead)}>
                      Open lead
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {type !== "exact" && (
            <Button onClick={onForceCreate}>
              {type === "new" ? "Create lead" : "This is a new lead — create anyway"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
