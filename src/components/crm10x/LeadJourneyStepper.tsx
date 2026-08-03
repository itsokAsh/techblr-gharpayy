import { useMemo } from "react";
import { useApp } from "@/lib/store";
import { useQuotations } from "@/lib/crm10x/quotations";
import { useCheckins } from "@/lib/checkins/store";
import { useDossierReadiness } from "@/lib/crm10x/dossier-readiness";
import type { Lead } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Circle, ChevronRight, ClipboardCheck,
  Calendar, MessageSquare, FileText, IndianRupee, KeyRound, ArrowRight,
} from "lucide-react";

export type JourneyTab =
  | "dossier" | "tour" | "post" | "quote" | "checkin";

type StepState = "done" | "active" | "todo" | "locked";

interface Step {
  key: JourneyTab;
  label: string;
  icon: typeof Calendar;
  state: StepState;
  cta: string;          // button label
  hint?: string;        // tiny hint under step name
}

export function LeadJourneyStepper({
  lead, currentTab, onJump,
}: {
  lead: Lead;
  currentTab: string;
  onJump: (tab: JourneyTab) => void;
}) {
  const tours = useApp((s) => s.tours);
  const quotes = useQuotations((s) => s.quotations);
  const checkin = useCheckins((s) => s.checkins.find((c) => c.leadId === lead.id));
  const dossier = useDossierReadiness(lead);

  const steps: Step[] = useMemo(() => {
    const leadTours = tours.filter((t) => t.leadId === lead.id);
    const openTour = leadTours.find((t) => t.status === "scheduled");
    const completedTour = leadTours.find((t) => t.status === "completed");
    const pendingPost = leadTours.find((t) => t.status === "completed" && !t.postTour.filledAt);
    const leadQuotes = quotes.filter((q) => q.leadId === lead.id);
    const paidQuote = leadQuotes.find((q) => q.status === "paid");
    const sentQuote = leadQuotes.find((q) => q.status === "sent");

    const dossierDone = dossier.ready;
    const tourDone = !!completedTour || !!openTour;
    const postDone = !!completedTour && !pendingPost;
    const quoteDone = !!paidQuote || !!sentQuote || lead.stage === "booked";
    const bookingDone = lead.stage === "booked" || !!paidQuote;
    const checkinDone = !!checkin && (checkin.stage === "moved_in" || checkin.stage === "settled");

    // No locks — every step is reachable any time. Hints still tell the
    // user what the natural next action is, but the agent is in control.
    const order: Array<{ key: JourneyTab; done: boolean; unlock: boolean; label: string; icon: typeof Calendar; cta: string; hint?: string }> = [
      { key: "dossier", done: dossierDone, unlock: true, label: "Dossier", icon: ClipboardCheck, cta: "Fill Dossier",
        hint: dossierDone ? "Complete" : `${dossier.filledCount}/${dossier.totalCount} fields` },
      { key: "tour", done: tourDone, unlock: true, label: "Tour", icon: Calendar, cta: openTour ? "Manage tour" : "Schedule tour",
        hint: openTour ? "Scheduled" : completedTour ? "Completed" : "Not scheduled" },
      { key: "post", done: postDone, unlock: true, label: "Post-tour", icon: MessageSquare, cta: pendingPost ? "Fill post-tour" : "Review",
        hint: pendingPost ? "Pending form" : postDone ? "Complete" : "Awaiting tour" },
      { key: "quote", done: bookingDone, unlock: true, label: "Quote · Book", icon: IndianRupee,
        cta: bookingDone ? "View booking" : "Send quote",
        hint: bookingDone ? "Booked" : sentQuote ? "Quote sent" : "Pending" },
      { key: "checkin", done: checkinDone, unlock: true, label: "Check-in", icon: KeyRound,
        cta: checkinDone ? "View check-in" : "Start check-in",
        hint: checkin ? checkin.stage.replace(/_/g, " ") : bookingDone ? "Ready" : "Open" },
    ];

    // Prefer urgent steps over an incomplete dossier sitting first in the list.
    const forceActive: JourneyTab | null = pendingPost
      ? "post"
      : openTour
        ? "tour"
        : bookingDone && !checkinDone
          ? "checkin"
          : null;

    let foundActive = false;
    return order.map((o): Step => {
      let state: StepState;
      if (o.done) state = "done";
      else if (forceActive) state = o.key === forceActive ? "active" : "todo";
      else if (!foundActive) { state = "active"; foundActive = true; }
      else state = "todo";
      return { key: o.key, label: o.label, icon: o.icon, state, cta: o.cta, hint: o.hint };
    });
  }, [tours, quotes, checkin, dossier.ready, dossier.filledCount, dossier.totalCount, lead.id, lead.stage]);

  const activeStep = steps.find((s) => s.state === "active") ?? steps.find((s) => s.state === "todo");
  const nextLabel = activeStep ? activeStep.cta : "All steps complete";

  return (
    <div className="border-b border-border bg-muted/20 px-5 py-3 space-y-2.5">
      {/* Step row with arrows */}
      <div className="flex items-center gap-0 overflow-x-auto scrollbar-thin">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isCurrent = currentTab === s.key;
          const tone =
            s.state === "done" ? "border-success/50 bg-success/10 text-success"
            : s.state === "active" ? "border-accent bg-accent/15 text-accent-foreground ring-1 ring-accent"
            : s.state === "locked" ? "border-border bg-muted/40 text-muted-foreground opacity-60"
            : "border-border bg-card text-muted-foreground";
          return (
            <div key={s.key} className="flex items-center shrink-0">
              <button
                onClick={() => onJump(s.key)}
                aria-current={isCurrent ? "step" : undefined}
                className={`group flex flex-col items-center gap-1 rounded-md border px-2 py-1.5 min-w-[68px] transition-all ${tone} ${isCurrent ? "scale-[1.04] shadow-sm" : ""} hover:brightness-110`}
                title={s.label}
              >
                <div className="flex items-center gap-1">
                  {s.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <Icon className="h-3.5 w-3.5" />}
                  <span className="text-[10px] font-semibold whitespace-nowrap">{s.label}</span>
                </div>
                {s.hint && <span className="text-[9px] opacity-80 whitespace-nowrap leading-none">{s.hint}</span>}
              </button>
              {i < steps.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 mx-0.5 shrink-0 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>

      {/* Single primary CTA — "do the next thing" */}
      {activeStep && (
        <Button
          size="sm"
          className="w-full h-8 text-xs gap-1.5 font-semibold"
          onClick={() => onJump(activeStep.key)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Next step · {nextLabel}
        </Button>
      )}
    </div>
  );
}
