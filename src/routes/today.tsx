import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useApp } from "@/lib/store";
import type { Lead } from "@/lib/types";
import { useMountedNow } from "@/hooks/use-now";
import { buildDoNextQueue, computeTcmPerformance, slaForPostTour, type NextAction } from "@/lib/engine";
import { fetchTodayQueue, fetchQueueJobs, triggerQueueWorker } from "@/lib/ops-api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { QuickActionRow } from "@/components/QuickActionRow";
import { format, formatDistanceToNow } from "date-fns";
import {
  Sun, Flame, AlertTriangle, Phone, Trophy, Zap, ArrowUpRight,
  ClipboardPaste, Calendar, Bell, UserX, Cpu, RefreshCw,
} from "lucide-react";
import { KpiCard } from "@/components/atoms";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/today")({
  head: () => ({
    meta: [
      { title: "Today — Gharpayy" },
      { name: "description", content: "Your morning command center. The exact next action, ranked by impact." },
    ],
  }),
  component: TodayPage,
});

type FilterKey = "all" | "urgent" | "tours" | "followups" | "new" | "noshow";

function TodayPage() {
  const {
    role, currentTcmId, leads, tours, followUps, tcms, properties,
    completeFollowUp, selectLead, logCall, setLeadFollowUp,
  } = useApp();
  const [now, mounted] = useMountedNow(15_000);
  const [filter, setFilter] = useState<FilterKey>("all");

  const filterTcm = role === "tcm" ? currentTcmId : undefined;

  const localQueue = useMemo(
    () => buildDoNextQueue(leads, tours, followUps, now || Date.now(), filterTcm, { uniqueByLead: true, properties, tcms }),
    [leads, tours, followUps, now, filterTcm, properties, tcms],
  );

  const queryClient = useQueryClient();
  const { data: opsQueue, isError: opsQueueError } = useQuery({
    queryKey: ["ops-today-queue", role, currentTcmId, filterTcm],
    queryFn: () => fetchTodayQueue({
      role,
      tcmId: currentTcmId,
      filterTcmId: filterTcm,
    }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const { data: workerData } = useQuery({
    queryKey: ["ops-worker-jobs", role, currentTcmId],
    queryFn: () => fetchQueueJobs({ role, tcmId: currentTcmId }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const tickMutation = useMutation({
    mutationFn: () => triggerQueueWorker({ role, tcmId: currentTcmId, action: "tick" }),
    onSuccess: (res) => {
      toast.success(`Worker tick processed ${res.processedCount ?? 0} due job(s)`);
      void queryClient.invalidateQueries({ queryKey: ["ops-worker-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-today-queue"] });
    },
  });

  const queue = opsQueue?.items ?? localQueue;
  const serverNow = opsQueue?.serverNow ?? (now || Date.now());

  const me = role === "tcm" ? tcms.find((t) => t.id === currentTcmId) : null;
  const perf = me ? computeTcmPerformance(me.id, leads, tours, followUps, serverNow) : null;

  const filtered = useMemo(() => {
    if (filter === "all") return queue;
    if (filter === "urgent") {
      return queue.filter((a) =>
        a.kind === "post-tour-overdue" || a.kind === "first-response" || a.kind === "new-paste" || a.kind === "follow-up-overdue" || a.kind === "tour-no-show-rescue" || a.kind === "tour-vacancy-lock",
      );
    }
    if (filter === "tours") {
      return queue.filter((a) => a.kind === "tour-today" || a.kind === "post-tour-overdue" || a.kind === "tour-vacancy-lock");
    }
    if (filter === "followups") {
      return queue.filter((a) => a.kind === "follow-up-overdue" || a.kind === "follow-up-today" || a.kind === "no-follow-up");
    }
    if (filter === "noshow") return queue.filter((a) => a.kind === "tour-no-show-rescue");
    return queue.filter((a) => a.kind === "new-paste" || a.kind === "first-response");
  }, [queue, filter]);

  const top = filtered.slice(0, 15);
  const grouped = groupByKind(queue);
  const pendingPost = tours.filter((t) => {
    if (t.status !== "completed" || t.postTour.filledAt) return false;
    const lead = leads.find((l) => l.id === t.leadId);
    if (!lead || lead.stage === "booked" || lead.stage === "dropped") return false;
    if (filterTcm && lead.assignedTcmId !== filterTcm) return false;
    return true;
  });
  const first = top[0];
  const firstLead = first ? leads.find((l) => l.id === first.leadId) : null;

  const runPrimary = (a: NextAction, lead: Lead) => {
    if (a.kind === "post-tour-overdue") selectLead(lead.id, "post");
    else if (a.kind === "tour-today") selectLead(lead.id, "tour");
    else if (a.kind === "tour-no-show-rescue") {
      if (a.cta === "Reschedule") selectLead(lead.id, "tour");
      else {
        logCall(lead.id);
        toast.success(`No-show rescue call logged · ${lead.name}`);
        selectLead(lead.id, "tour");
      }
    } else if (a.kind === "tour-vacancy-lock") {
      selectLead(lead.id, "tour");
      toast.message("Complete or edit the pre-tour check on the Tour tab");
    } else if (a.kind === "new-paste" || a.kind === "first-response") {
      logCall(lead.id);
      toast.success(`First touch logged · ${lead.name}`);
      selectLead(lead.id);
    } else if (a.kind === "no-follow-up") {
      const due = new Date(Date.now() + 24 * 3600_000).toISOString();
      setLeadFollowUp(lead.id, due, lead.intent === "hot" ? "high" : "medium", "Do-Next scheduled follow-up");
      toast.success("Follow-up set for tomorrow");
    } else if (a.kind === "follow-up-overdue" || a.kind === "follow-up-today") {
      selectLead(lead.id);
    } else {
      selectLead(lead.id);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Sun className="h-3.5 w-3.5" />
              <span className="min-h-[1em]">
                {mounted ? format(new Date(serverNow), "EEEE, MMMM d · h:mm a") : "\u00a0"}
              </span>
              {opsQueue && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted">
                  ops · {opsQueue.cache ?? "—"} · v{opsQueue.cacheVersion}
                </span>
              )}
              {workerData?.stats && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  worker: {workerData.stats.pending} pending · {workerData.stats.completed} done
                </span>
              )}
              {opsQueueError && (
                <span className="text-[10px] text-warning">local fallback</span>
              )}
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {mounted ? greeting(now) : "Hello"}{me ? `, ${me.name.split(" ")[0]}` : ""}.
            </h1>
            <p className="text-sm text-muted-foreground">
              {queue.length === 0
                ? "Inbox zero. Nothing pending right now."
                : `${queue.length} ranked action${queue.length > 1 ? "s" : ""} · one per lead · start at the top`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              disabled={tickMutation.isPending}
              onClick={() => tickMutation.mutate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${tickMutation.isPending ? "animate-spin" : ""}`} />
              Run Worker
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
              <Link to="/myt/leads">
                <ClipboardPaste className="h-3.5 w-3.5" /> Paste lead
              </Link>
            </Button>
            <Link to="/leads" className="text-xs text-accent inline-flex items-center gap-1">
              All leads <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </header>

        {/* Queue KPIs — all roles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Do-Next" value={queue.length} sub="ranked actions" tone={queue.length ? "warning" : "success"} />
          <KpiCard label="Urgent" value={grouped.urgent} sub="SLA / overdue" tone={grouped.urgent ? "destructive" : "default"} />
          <KpiCard label="Tours today" value={grouped.tours} sub="schedule + post" tone={grouped.tours ? "warning" : "default"} />
          <KpiCard
            label={perf ? "Discipline" : "New pastes"}
            value={perf ? perf.discipline : grouped.fresh}
            sub={perf ? "0–100" : "awaiting first call"}
            tone={perf ? (perf.discipline >= 75 ? "success" : "warning") : (grouped.fresh ? "warning" : "default")}
          />
        </div>

        {pendingPost.length > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-destructive">
                  {pendingPost.length} post-tour form{pendingPost.length > 1 ? "s" : ""} pending · 1h SLA
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Highest priority in Do-Next. Fill outcome + follow-up to clear.
                </div>
              </div>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-accent inline-flex items-center gap-1 shrink-0"
              onClick={() => selectLead(pendingPost[0].leadId, "post")}
            >
              Open first <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Do this first */}
        {first && firstLead && (
          <section className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-accent uppercase tracking-wider">
              <Zap className="h-3.5 w-3.5" /> Do this first
            </div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold">{firstLead.name}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{first.reason}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {firstLead.preferredArea} · ₹{(firstLead.budget / 1000).toFixed(0)}k
                  {mounted && first.dueAt ? ` · ${formatDistanceToNow(new Date(first.dueAt), { addSuffix: true })}` : ""}
                </div>
              </div>
              <Button className="shrink-0" onClick={() => runPrimary(first, firstLead)}>
                {first.cta} <ArrowUpRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </section>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all" as const, label: "All", icon: Zap, n: queue.length },
              { key: "urgent" as const, label: "Urgent", icon: AlertTriangle, n: grouped.urgent },
              { key: "tours" as const, label: "Tours", icon: Calendar, n: grouped.tours },
              { key: "followups" as const, label: "Follow-ups", icon: Bell, n: grouped.followups },
              { key: "noshow" as const, label: "No-shows", icon: UserX, n: grouped.noshow },
              { key: "new" as const, label: "New / paste", icon: ClipboardPaste, n: grouped.fresh },
            ]
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                filter === f.key
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <f.icon className="h-3 w-3" />
              {f.label}
              <span className="font-mono opacity-70">{f.n}</span>
            </button>
          ))}
        </div>

        {/* The Queue */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <header className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-accent" />
              <h2 className="font-display text-sm font-semibold">Do this next</h2>
              <span className="text-[11px] text-muted-foreground font-mono">
                {opsQueue ? "ops · 30s" : "live · 15s"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <Legend color="bg-destructive" label={`${grouped.urgent} urgent`} />
              <Legend color="bg-accent" label={`${grouped.tours} tours`} />
              <Legend color="bg-warning" label={`${grouped.fresh} new`} />
              <Legend color="bg-destructive/70" label={`${grouped.noshow} no-show`} />
            </div>
          </header>
          {top.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <Trophy className="h-8 w-8 text-success mx-auto" />
              <div className="font-display font-semibold">Inbox zero.</div>
              <div className="text-xs text-muted-foreground">Paste a WhatsApp lead or wait for the next tour.</div>
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/myt/leads"><ClipboardPaste className="h-3.5 w-3.5" /> Paste from WhatsApp</Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {top.map((a, idx) => {
                const lead = leads.find((l) => l.id === a.leadId);
                if (!lead) return null;
                const pendingTour = a.kind === "post-tour-overdue"
                  ? tours.find((t) => t.leadId === a.leadId && t.status === "completed" && !t.postTour.filledAt)
                  : undefined;
                const sla = pendingTour && mounted ? slaForPostTour(pendingTour, now) : undefined;
                const onDone = a.kind === "follow-up-overdue" || a.kind === "follow-up-today"
                  ? () => {
                      const f = followUps.find((x) => x.leadId === a.leadId && !x.done && !x.reason.startsWith("Post-tour SLA"));
                      if (f) completeFollowUp(f.id);
                    }
                  : undefined;
                const dueLabel = mounted && a.dueAt
                  ? formatDistanceToNow(new Date(a.dueAt), { addSuffix: true })
                  : undefined;
                return (
                  <div key={`${a.leadId}-${a.kind}`} className="relative">
                    {idx === 0 && filter === "all" && (
                      <span className="absolute left-1 top-1 text-[9px] font-mono text-accent">#1</span>
                    )}
                    <QuickActionRow
                      lead={lead}
                      reason={a.reason}
                      accent={toneFor(a)}
                      dueLabel={dueLabel}
                      onDone={onDone}
                      onOpen={() => {
                        if (a.kind === "post-tour-overdue") selectLead(lead.id, "post");
                        else if (a.kind === "tour-today" || a.kind === "tour-no-show-rescue" || a.kind === "tour-vacancy-lock") selectLead(lead.id, "tour");
                        else selectLead(lead.id);
                      }}
                      onPrimary={() => runPrimary(a, lead)}
                      ctaLabel={a.cta}
                      slaState={sla}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Mini
            title="Critical now"
            icon={AlertTriangle}
            accent="destructive"
            count={grouped.urgent}
            items={queue.filter((a) =>
              a.kind === "post-tour-overdue" || a.kind === "first-response" || a.kind === "new-paste" || a.kind === "follow-up-overdue" || a.kind === "tour-no-show-rescue" || a.kind === "tour-vacancy-lock",
            ).slice(0, 5)}
            leads={leads}
          />
          <Mini
            title="Hot pipeline"
            icon={Flame}
            accent="accent"
            count={queue.filter((a) => leads.find((l) => l.id === a.leadId)?.intent === "hot").length}
            items={queue.filter((a) => leads.find((l) => l.id === a.leadId)?.intent === "hot").slice(0, 5)}
            leads={leads}
          />
        </section>
      </div>
    </AppShell>
  );
}

function Mini({
  title, icon: Icon, accent, count, items, leads,
}: {
  title: string;
  icon: typeof Flame;
  accent: "destructive" | "accent";
  count: number;
  items: NextAction[];
  leads: Lead[];
}) {
  const { selectLead } = useApp();
  const cls = accent === "destructive" ? "text-destructive" : "text-accent";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${cls}`} />
          <h2 className="font-display text-sm font-semibold">{title}</h2>
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">{count}</span>
      </header>
      <div className="p-2">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">Nothing here.</div>
        )}
        {items.map((a) => {
          const lead = leads.find((l) => l.id === a.leadId);
          if (!lead) return null;
          return (
            <button
              key={`${a.leadId}-${a.kind}`}
              onClick={() => selectLead(lead.id, a.kind === "post-tour-overdue" ? "post" : a.kind === "tour-today" || a.kind === "tour-no-show-rescue" || a.kind === "tour-vacancy-lock" ? "tour" : null)}
              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-accent/5 transition-colors flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{lead.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{a.reason}</div>
              </div>
              <span className="text-[10px] text-accent shrink-0">{a.cta}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} /> {label}
    </span>
  );
}

function greeting(ts: number) {
  const h = new Date(ts).getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function toneFor(a: NextAction): "destructive" | "warning" | "accent" | "default" {
  if (a.kind === "post-tour-overdue" || a.kind === "first-response" || a.kind === "new-paste" || a.kind === "follow-up-overdue" || a.kind === "tour-no-show-rescue" || a.kind === "tour-vacancy-lock") {
    return "destructive";
  }
  if (a.kind === "no-follow-up") return "warning";
  if (a.kind === "tour-today" || a.kind === "follow-up-today") return "accent";
  return "default";
}

function groupByKind(queue: NextAction[]) {
  return {
    urgent: queue.filter((a) =>
      a.kind === "post-tour-overdue" || a.kind === "first-response" || a.kind === "new-paste" || a.kind === "follow-up-overdue" || a.kind === "tour-no-show-rescue",
    ).length,
    tours: queue.filter((a) => a.kind === "tour-today" || a.kind === "post-tour-overdue" || a.kind === "tour-vacancy-lock").length,
    followups: queue.filter((a) =>
      a.kind === "follow-up-overdue" || a.kind === "follow-up-today" || a.kind === "no-follow-up",
    ).length,
    fresh: queue.filter((a) => a.kind === "new-paste" || a.kind === "first-response").length,
    noshow: queue.filter((a) => a.kind === "tour-no-show-rescue").length,
  };
}
