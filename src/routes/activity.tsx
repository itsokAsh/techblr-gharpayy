import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/lib/store";
import { format } from "date-fns";
import {
  Activity, MessageSquare, Calendar, CheckCircle2, AlertTriangle, Phone,
  ClipboardCheck, FileText, ArrowRightLeft,
} from "lucide-react";
import type { ActivityKind } from "@/lib/types";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [{ title: "Activity — Gharpayy" }, { name: "description", content: "Auto-generated activity log across all leads, tours and follow-ups." }],
  }),
  component: ActivityPage,
});

const ICON: Record<ActivityKind, typeof Activity> = {
  lead_created: Activity,
  status_changed: ArrowRightLeft,
  tour_scheduled: Calendar,
  tour_completed: CheckCircle2,
  tour_cancelled: AlertTriangle,
  decision_logged: FileText,
  post_tour_filled: ClipboardCheck,
  follow_up_set: Calendar,
  follow_up_done: CheckCircle2,
  note_added: FileText,
  message_sent: MessageSquare,
  call_logged: Phone,
  escalation: AlertTriangle,
  stale_alert: AlertTriangle,
  tour_no_show: AlertTriangle,
  tour_vacancy_confirmed: CheckCircle2,
  tour_pre_check_ok: CheckCircle2,
  tour_pre_check_problem: AlertTriangle,
};

function ActivityPage() {
  const { activities, leads, tcms, selectLead } = useApp();

  return (
    <AppShell>
      <div className="space-y-4">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Activity log</h1>
          <p className="text-sm text-muted-foreground">Auto-generated. No manual dependency.</p>
        </header>

        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {activities.map((a) => {
            const Icon = ICON[a.kind] ?? Activity;
            const lead = a.leadId ? leads.find((l) => l.id === a.leadId) : null;
            const actor = a.actor === "system" ? "system" : tcms.find((t) => t.id === a.actor)?.name ?? a.actor;
            const isAlert = a.kind === "stale_alert" || a.kind === "escalation" || a.kind === "tour_cancelled";
            return (
              <div key={a.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/5 transition-colors">
                <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${isAlert ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{a.text}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {format(new Date(a.ts), "MMM d, p")} · {actor}
                    {lead && (
                      <>
                        {" · "}
                        <button onClick={() => selectLead(lead.id)} className="text-accent hover:underline">
                          {lead.name}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {activities.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">No activity yet.</div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
