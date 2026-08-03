import { useEffect, useMemo, useState } from "react";
import { useApp, getProperty, getTcm } from "@/lib/store";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBar, IntentChip, StageBadge } from "./atoms";
import { HandoffThread } from "./HandoffThread";
import { SequenceChip } from "./SequenceChip";
import { SupplyMatchPanel } from "./leads/SupplyMatchPanel";
import { PostVisitGate } from "./crm10x/PostVisitGate";
import { CommitmentBanner } from "./crm10x/CommitmentBanner";
import { ObjectionTag } from "./crm10x/ObjectionLogger";
import { LeadDossierPanel } from "./crm10x/LeadDossierPanel";
import { PTQScorecard } from "./crm10x/PTQScorecard";
import { QuotationBuilder } from "./crm10x/QuotationBuilder";
import { CheckInPanel } from "./checkins/CheckInPanel";
import { SlaPulse } from "./SlaPulse";
import { slaForPostTour, SLA, needsVacancyLock, vacancyOutlook, isSameTourSlot, preTourTiming } from "@/lib/engine";
import { PreTourCheckDialog } from "./PreTourCheckDialog";
import { PRE_TOUR_PROBLEM_LABELS } from "@/lib/types";
import { fetchOpsVacancy, markNoShowViaOps, savePreCheckViaOps } from "@/lib/ops-api";
import type { OpsRole } from "@/server/ops/types";

import { SmartDossier } from "./crm10x/SmartDossier";
import { LeadPropertyDossier } from "./impact/LeadPropertyDossier";
import { CommandActions, useImpactStateForLead } from "./impact/ImpactQueue";
import { LeadJourneyStepper, type JourneyTab } from "./crm10x/LeadJourneyStepper";
import { useLeadFocus } from "@/lib/crm10x/lead-focus";
import { useDossierReadiness } from "@/lib/crm10x/dossier-readiness";
import { pressureColor } from "@/lib/crm10x/impact-scoring";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Phone, MessageSquare, Calendar as CalendarIcon, Tag, ClipboardCheck,
  AlertTriangle, CheckCircle2, X, Activity as ActivityIcon, MapPin,
  Wallet, Send, Zap, IndianRupee, BellRing, ExternalLink, UserX,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { LeadStage, FollowUpPriority, SequenceKind, NoShowReason } from "@/lib/types";
import { NO_SHOW_REASON_LABELS } from "@/lib/types";
import { toast } from "sonner";
import { useMountedNow } from "@/hooks/use-now";
import { sendTourMessage as sendOwnerTourMessage } from "@/owner/messaging";
import { useSettings } from "@/myt/lib/settings-context";

const TAG_OPTIONS = ["price-issue", "location-mismatch", "parents-involved", "urgent", "budget-low"];
const OBJECTIONS = ["Budget", "Location", "Amenities", "Timing", "Parents", "Comparing options", "Other"];
const TEMPLATES = [
  { id: "tour-confirm", label: "Tour confirmation", body: "Hi! Confirming your tour today. Looking forward to meeting you." },
  { id: "post-tour", label: "Post-tour check-in", body: "Hi! How did you find the property? Happy to answer any questions." },
  { id: "scarcity", label: "Scarcity", body: "Just a heads-up — only a couple of beds left at this price." },
];

export function LeadControlPanel() {
  const {
    selectedLeadId, selectedLeadTab, selectLead, leads, properties, tours, activities, tcms,
    setLeadStage, setLeadIntent, setLeadFollowUp, addLeadTag, removeLeadTag,
    scheduleTour, cancelTour, rescheduleTour, completeTour, markTourNoShow,
    savePreTourCheck, clearPreTourCheck, setDecision, updatePostTour,
    addNote, logCall, sendMessage, autoAssignLead, startSequence, closeDeal,
    markHandoffsRead,
  } = useApp();
  const { settings } = useSettings();

  const lead = useMemo(() => leads.find((l) => l.id === selectedLeadId) ?? null, [leads, selectedLeadId]);

  // Mark handoffs read when this lead opens
  useEffect(() => {
    if (selectedLeadId) markHandoffsRead(selectedLeadId);
  }, [selectedLeadId, markHandoffsRead]);

  const leadTours = useMemo(
    () => (lead ? tours.filter((t) => t.leadId === lead.id).sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt)) : []),
    [tours, lead],
  );
  const leadActivities = useMemo(
    () => (lead ? activities.filter((a) => a.leadId === lead.id).slice(0, 30) : []),
    [activities, lead],
  );

  // Tour scheduling form state
  const [propertyId, setPropertyId] = useState("");
  const [tcmId, setTcmId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [tab, setTab] = useState("control");
  const [now, mounted] = useMountedNow(15_000);

  // Note state
  const [note, setNote] = useState("");
  const [customMsg, setCustomMsg] = useState("");
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [noShowReason, setNoShowReason] = useState<NoShowReason>("didnt-answer");
  const [noShowTourId, setNoShowTourId] = useState<string | null>(null);

  const pendingPostTour = leadTours.find(
    (t) => t.status === "completed" && !t.postTour.filledAt,
  );
  const upcomingTour = leadTours.find((t) => t.status === "scheduled");
  const noShowTour = leadTours.find((t) => t.status === "no-show");

  // Shared "what is this lead currently focused on?" — feeds prefills across
  // every form in the drawer so filling one (quote / tour / booking / check-in)
  // automatically seeds the others.
  const focus = useLeadFocus(lead);
  const dossier = useDossierReadiness(lead);

  // Seed form state ONCE per lead.id change — not on every lead-store mutation,
  // otherwise typing into the tour/follow-up form wipes mid-entry.
  useEffect(() => {
    if (!lead) return;
    setPropertyId(focus.propertyId ?? upcomingTour?.propertyId ?? "");
    setTcmId(focus.tcmId || upcomingTour?.tcmId || lead.assignedTcmId || "");
    setScheduledAt(
      upcomingTour
        ? toLocal(upcomingTour.scheduledAt)
        : focus.scheduledAt
          ? toLocal(focus.scheduledAt)
          : "",
    );
    setTab(selectedLeadTab ?? (pendingPostTour ? "post" : upcomingTour ? "tour" : settings.matching.drawerDefaultTab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, selectedLeadTab]);

  if (!lead) return null;

  const tcm = getTcm(lead.assignedTcmId);

  const handleSchedule = () => {
    if (!propertyId || !tcmId || !scheduledAt) {
      toast.error("Property, TCM and time are required");
      return;
    }
    if (!dossier.ready) {
      toast.warning(`Dossier ${dossier.filledCount}/${dossier.totalCount} — scheduling anyway`, {
        description: `Still missing: ${dossier.missing.join(", ")}`,
      });
    }
    scheduleTour({ leadId: lead.id, propertyId, tcmId, scheduledAt: new Date(scheduledAt).toISOString() });
    setPropertyId(""); setTcmId(""); setScheduledAt("");
    toast.success("Tour scheduled");
  };

  return (
    <Sheet open={!!selectedLeadId} onOpenChange={(o) => !o && selectLead(null)}>
      <SheetContent side="right" className="w-full sm:max-w-[560px] p-0 flex flex-col" showClose>
        {/* Header block */}
        <SheetHeader className="px-5 py-4 border-b border-border space-y-2 pr-12">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="font-display text-lg leading-tight">{lead.name}</SheetTitle>
              <SheetDescription className="text-xs">
                {lead.phone} · via {lead.source}
              </SheetDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StageBadge stage={lead.stage} tags={lead.tags} />
            <IntentChip intent={lead.intent} />
            <ConfidenceBar value={lead.confidence} />
            <ObjectionTag leadId={lead.id} />
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
            <Meta icon={CalendarIcon} label="Move-in" value={formatMoveIn(lead.moveInDate)} />
            <Meta icon={Wallet} label="Budget" value={`₹${(lead.budget / 1000).toFixed(0)}k`} />
            <Meta icon={MapPin} label="Area" value={lead.preferredArea} />
          </div>
          <div className="text-[11px] text-muted-foreground">Assigned · {tcm?.name ?? "—"} ({tcm?.zone ?? "—"})</div>
        </SheetHeader>

        {/* Guided journey stepper — Dossier → Tour → Post → Quote · Book → Check-in */}
        <LeadJourneyStepper
          lead={lead}
          currentTab={tab}
          onJump={(t: JourneyTab) => setTab(t)}
        />

        {/* CRM 10x — commitment banner + 48h post-visit gate */}
        <CommitmentBanner lead={lead} />
        <PostVisitGate lead={lead} />

        {/* Stale alert — hide once lead is closed (booked/dropped) */}
        {pendingPostTour && lead.stage !== "booked" && lead.stage !== "dropped" && (
          <div className="mx-5 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs flex-1 min-w-0">
              <div className="font-semibold text-destructive flex items-center gap-2">
                Post-tour update missing
                <SlaPulse
                  state={mounted ? slaForPostTour(pendingPostTour, Date.now()) : "warn"}
                  label={`${SLA.postTourHours}h SLA`}
                />
              </div>
              <div className="text-muted-foreground">
                Completed{" "}
                {mounted
                  ? formatDistanceToNow(
                      new Date(pendingPostTour.completedAt ?? pendingPostTour.updatedAt ?? pendingPostTour.scheduledAt),
                      { addSuffix: true },
                    )
                  : "recently"}
                . Fill outcome + follow-up below to clear the SLA and auto-schedule the next touch.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] shrink-0"
              onClick={() => {
                setTab("post");
                selectLead(lead.id, "post");
                // Outcome fields sit below the PTQ scorecard — jump there after paint.
                window.setTimeout(() => {
                  document.getElementById("post-tour-outcome")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }, 80);
              }}
            >
              Fill form
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <Tabs value={tab} onValueChange={setTab} className="px-5 py-4">
            {/* Primary actions live inside each tab (CommandActions in Impact,
                deep dialogs in Tour / Quote / Check-in). The sticky shortcut
                bar was removed because every button it carried was a thinner
                duplicate of the in-depth dialog rendered below. */}
            {/* Journey steps (Dossier · Tour · Post · Quote · Check-in) are
                driven by the stepper above; this row exposes the secondary
                surfaces only. One primary action per state, fewer clicks. */}
            <TabsList className={`grid h-auto w-full gap-1 ${pendingPostTour && lead.stage !== "booked" && lead.stage !== "dropped" ? "grid-cols-6" : "grid-cols-5"}`}>
              {pendingPostTour && lead.stage !== "booked" && lead.stage !== "dropped" && (
                <TabsTrigger value="post" className="text-xs text-destructive data-[state=active]:text-destructive">
                  Post-tour
                </TabsTrigger>
              )}
              <TabsTrigger value="impact" className="text-xs">Impact</TabsTrigger>
              <TabsTrigger value="best-fit" className="text-xs">Best Fit</TabsTrigger>
              <TabsTrigger value="control" className="text-xs">Control</TabsTrigger>
              <TabsTrigger value="handoff" className="text-xs">Handoff</TabsTrigger>
              <TabsTrigger value="log" className="text-xs">Log</TabsTrigger>
            </TabsList>

            <TabsContent value="impact" className="space-y-4 pt-4">
              <ImpactTabContent lead={lead} />
            </TabsContent>

            <TabsContent value="dossier" className="space-y-4 pt-4">
              <LeadDossierPanel lead={lead} />
            </TabsContent>

            <TabsContent value="checkin" className="space-y-4 pt-4">
              <CheckInPanel lead={lead} />
            </TabsContent>

            <TabsContent value="best-fit" className="space-y-4 pt-4">
              <Section title="Best property matches">
                <SupplyMatchPanel lead={lead} onNavigateAway={() => selectLead(null)} />
              </Section>
            </TabsContent>

            {/* CONTROL — status, intent, follow-up, action engine, notes, tags */}
            <TabsContent value="control" className="space-y-4 pt-4">
              <SequenceChip leadId={lead.id} />

              <Section title="Routing">
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => {
                      const r = autoAssignLead(lead.id);
                      const tcm = tcms.find((t) => t.id === r.tcmId);
                      toast.success(`Auto-routed to ${tcm?.name ?? "TCM"}`, { description: r.reasons.join(" · ") });
                    }}
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" /> Auto-route to best TCM
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Currently with <span className="text-foreground font-medium">{tcm?.name ?? "—"}</span> · {tcm?.zone ?? "—"} · {Math.round((tcm?.conversionRate ?? 0) * 100)}% conv
                </div>
              </Section>

              <Section title="Status engine">
                <Select value={lead.stage} onValueChange={(v) => {
                  const prev = lead.stage;
                  setLeadStage(lead.id, v as LeadStage);
                  if (v === "dropped") {
                    toast("Marked dropped", {
                      description: `${lead.name} → dropped`,
                      action: {
                        label: "Undo",
                        onClick: () => { setLeadStage(lead.id, prev); toast.success("Restored"); },
                      },
                      duration: 5000,
                    });
                  }
                }}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["new","contacted","tour-scheduled","tour-done","negotiation","booked","dropped"] as LeadStage[]).map((s) => (
                      <SelectItem key={s} value={s} className="text-sm capitalize">{s.replace("-", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {(["first-contact","post-tour","pre-decision","cold-revival"] as SequenceKind[]).map((k) => (
                    <Button
                      key={k} size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => { startSequence(lead.id, k); toast.success(`Started ${k} sequence`); }}
                    >
                      Start {k}
                    </Button>
                  ))}
                </div>
              </Section>

              <Section title="Action engine">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={() => { logCall(lead.id); toast.success("Call logged"); }}>
                    <Phone className="h-3.5 w-3.5 mr-1.5" /> Call
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { sendMessage(lead.id, "WhatsApp template sent"); toast.success("Message sent"); }}>
                    <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> WhatsApp
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Templates</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATES.map((t) => (
                      <Button
                        key={t.id} variant="secondary" size="sm" className="h-7 text-[11px]"
                        onClick={() => { sendMessage(lead.id, t.body); toast.success(`Sent: ${t.label}`); }}
                      >
                        {t.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customMsg} onChange={(e) => setCustomMsg(e.target.value)}
                    placeholder="Custom message…" className="h-9 text-sm"
                  />
                  <Button
                    size="sm" disabled={!customMsg.trim()}
                    onClick={() => { sendMessage(lead.id, customMsg); setCustomMsg(""); toast.success("Sent"); }}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Section>

              <Section title="Follow-up engine">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Next follow-up</Label>
                    <Input
                      key={lead.id}
                      type="datetime-local"
                      defaultValue={lead.nextFollowUpAt ? toLocal(lead.nextFollowUpAt) : ""}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setLeadFollowUp(lead.id, new Date(e.target.value).toISOString(), priorityFor(lead.confidence));
                      }}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Temperature</Label>
                    <Select
                      value={lead.intent}
                      onValueChange={(v) => setLeadIntent(lead.id, v as "hot" | "warm" | "cold")}
                    >
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hot">Hot</SelectItem>
                        <SelectItem value="warm">Warm</SelectItem>
                        <SelectItem value="cold">Cold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {lead.nextFollowUpAt && (
                  <div className="text-[11px] text-muted-foreground">
                    Due {mounted ? formatDistanceToNow(new Date(lead.nextFollowUpAt), { addSuffix: true }) : "soon"}
                  </div>
                )}
              </Section>

              <Section title="Notes & signals">
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] gap-1">
                      <Tag className="h-2.5 w-2.5" />
                      {t}
                      <button onClick={() => removeLeadTag(lead.id, t)} className="hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_OPTIONS.filter((t) => !lead.tags.includes(t)).map((t) => (
                    <button
                      key={t} onClick={() => addLeadTag(lead.id, t)}
                      className="text-[10px] px-2 py-0.5 rounded-md border border-dashed border-border text-muted-foreground hover:border-accent hover:text-accent transition-colors"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note…" rows={2} className="text-sm resize-none"
                  />
                  <Button
                    size="sm" disabled={!note.trim()}
                    onClick={() => { addNote(lead.id, note); setNote(""); toast.success("Note added"); }}
                  >
                    Add
                  </Button>
                </div>
              </Section>
            </TabsContent>

            {/* TOUR */}
            <TabsContent value="tour" className="space-y-4 pt-4">
              {upcomingTour ? (
                <Section title="Upcoming tour">
                  <UpcomingTourCard
                    tour={upcomingTour}
                    lead={lead}
                    scheduledAt={scheduledAt}
                    onScheduledAtChange={setScheduledAt}
                    now={mounted ? now : Date.now()}
                    property={properties.find((p) => p.id === upcomingTour.propertyId)}
                    onReschedule={() => {
                      if (!scheduledAt) {
                        toast.error("Choose a date and time to reschedule");
                        return;
                      }
                      const nextIso = new Date(scheduledAt).toISOString();
                      if (isSameTourSlot(nextIso, upcomingTour.scheduledAt)) {
                        toast.error("Pick a different date or time — same as current tour slot");
                        return;
                      }
                      if (rescheduleTour(upcomingTour.id, nextIso)) {
                        toast.success("Tour rescheduled");
                      } else {
                        toast.error("Could not reschedule — pick a new slot");
                      }
                    }}
                    onCancel={() => {
                      const prevAt = upcomingTour.scheduledAt;
                      const tourId = upcomingTour.id;
                      cancelTour(tourId);
                      toast("Tour cancelled", {
                        description: `${lead.name} · ${format(new Date(prevAt), "MMM d, p")}`,
                        action: {
                          label: "Undo",
                          onClick: () => {
                            useApp.setState((s) => ({
                              tours: s.tours.map((x) => x.id === tourId ? { ...x, status: "scheduled" } : x),
                            }));
                            rescheduleTour(tourId, prevAt);
                            toast.success("Tour restored");
                          },
                        },
                        duration: 5000,
                      });
                    }}
                    onCancelAndRematch={() => {
                      const prevAt = upcomingTour.scheduledAt;
                      const tourId = upcomingTour.id;
                      cancelTour(tourId);
                      toast("Tour cancelled — pick another PG below", {
                        description: `${lead.name} · was ${format(new Date(prevAt), "MMM d, p")}`,
                        duration: 6000,
                      });
                    }}
                    onNoShow={() => {
                      setNoShowTourId(upcomingTour.id);
                      setNoShowReason("didnt-answer");
                      setNoShowOpen(true);
                    }}
                    onComplete={() => {
                      completeTour(upcomingTour.id);
                      setTab("post");
                      toast.success(`Tour completed · fill post-tour within ${SLA.postTourHours}h`, {
                        description: "SLA clock started. Outcome + next follow-up clear the breach.",
                      });
                    }}
                  />
                </Section>
              ) : noShowTour ? (
                <Section title="No-show — rescue">
                  <NoShowTourCard
                    tour={noShowTour}
                    scheduledAt={scheduledAt}
                    onScheduledAtChange={setScheduledAt}
                    onRebook={() => {
                      if (!scheduledAt) {
                        toast.error("Pick a new date and time to rebook");
                        return;
                      }
                      const nextIso = new Date(scheduledAt).toISOString();
                      if (isSameTourSlot(nextIso, noShowTour.scheduledAt)) {
                        toast.error("Pick a different date or time — same as the no-show slot");
                        return;
                      }
                      if (rescheduleTour(noShowTour.id, nextIso)) {
                        toast.success("Tour rebooked · no-show cleared");
                      } else {
                        toast.error("Could not rebook — pick a new slot");
                      }
                    }}
                  />
                </Section>
              ) : (
                <Section title="Schedule tour">
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    {!dossier.ready && (
                      <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">Dossier {dossier.filledCount}/{dossier.totalCount} — fill first</div>
                          <div className="text-warning/80">Missing: {dossier.missing.join(", ")}</div>
                        </div>
                        <button onClick={() => setTab("dossier")} className="underline font-medium shrink-0">Open Dossier</button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2">
                      <div>
                        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Property</Label>
                        <Select value={propertyId} onValueChange={setPropertyId}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pick property" /></SelectTrigger>
                          <SelectContent>
                            {properties.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-sm">{p.name} · {p.area}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">TCM</Label>
                          <Select value={tcmId} onValueChange={setTcmId}>
                            <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pick TCM" /></SelectTrigger>
                            <SelectContent>
                              {tcms.map((t) => (
                                <SelectItem key={t.id} value={t.id} className="text-sm">{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">When</Label>
                          <Input
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                            className="h-9 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                    <Button onClick={handleSchedule} className="w-full h-9" size="sm">
                      <CalendarIcon className="h-4 w-4 mr-1.5" />
                      {dossier.ready ? "Schedule tour" : `Schedule anyway (dossier ${dossier.filledCount}/${dossier.totalCount})`}
                    </Button>
                    {scheduledAt && (() => {
                      const slotIso = new Date(scheduledAt).toISOString();
                      const hint = preTourTiming(
                        { id: "", leadId: lead.id, propertyId: "", tcmId: "", scheduledAt: slotIso, status: "scheduled", decision: null, postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null }, createdAt: "", updatedAt: "" },
                        mounted ? now : Date.now(),
                      );
                      return (
                        <p className={`text-[10px] text-center ${hint.isRequired ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {hint.isOptionalAvailable
                            ? `Pre-tour check optional now · required ${SLA.preTourVacancyHours}h before slot (${hint.countdown})`
                            : `Pre-tour check will be very important · ${hint.countdown}`}
                        </p>
                      );
                    })()}
                    <div className="text-[10px] text-muted-foreground text-center">
                      Need bulk view? Open the <button onClick={() => selectLead(null)} className="underline">Schedule console</button>.
                    </div>
                  </div>
                </Section>
              )}

              {leadTours.length > 1 && (
                <Section title="Tour history">
                  <div className="space-y-2">
                    {leadTours.slice(upcomingTour ? 1 : 0).map((t) => {
                      const prop = getProperty(t.propertyId, properties);
                      const histTiming = t.status === "scheduled"
                        ? preTourTiming(t, mounted ? now : Date.now())
                        : null;
                      return (
                        <div key={t.id} className="rounded-lg border border-border bg-card p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{prop?.name}</span>
                            <span className="text-muted-foreground">{format(new Date(t.scheduledAt), "MMM d, p")}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] flex-wrap">
                            <Badge variant="outline" className="capitalize">{t.status}</Badge>
                            {histTiming && (
                              <Badge variant="outline" className={histTiming.isRequired ? "text-destructive border-destructive/40" : "text-muted-foreground"}>
                                {histTiming.isRequired ? "Check required" : histTiming.countdown}
                              </Badge>
                            )}
                            {t.decision && <Badge variant="outline" className="capitalize">{t.decision}</Badge>}
                            {t.postTour.filledAt ? (
                              <span className="text-success inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Form complete</span>
                            ) : t.status === "completed" ? (
                              <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Form pending</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
            </TabsContent>

            {/* QUOTATION — inline builder */}
            <TabsContent value="quote" className="space-y-4 pt-4">
              <QuotationBuilder lead={lead} />
            </TabsContent>

            {/* POST-TOUR */}
            <TabsContent value="post" className="space-y-4 pt-4">
              {(() => {
                const target = pendingPostTour ?? leadTours.find((t) => t.status === "completed");
                if (!target) {
                  return (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      No completed tours yet. The post-tour form appears here once a tour is marked complete.
                    </div>
                  );
                }
                const prop = getProperty(target.propertyId, properties);
                const pt = target.postTour;
                return (
                  <div className="space-y-4">
                    <div className="text-xs text-muted-foreground">
                      Tour at <span className="text-foreground font-medium">{prop?.name}</span> · {format(new Date(target.scheduledAt), "MMM d, p")}
                    </div>

                    <PTQScorecard lead={lead} tour={target} />

                    {/* Send updates / reminders — one row, always visible post-tour */}
                    <div className="flex flex-wrap gap-1.5">

                      <Button
                        size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        disabled={!prop}
                        onClick={() => {
                          if (!prop) return;
                          sendOwnerTourMessage('post_visit_thanks', {
                            tourId: target.id, leadName: lead.name, phone: lead.phone,
                            propertyName: prop.name, area: prop.area,
                            tourDate: target.scheduledAt.slice(0, 10),
                            tourTime: target.scheduledAt.slice(11, 16),
                            tcmName: tcms.find((t) => t.id === target.tcmId)?.name,
                          });
                          toast.success('Thank-you message opened');
                        }}
                      >
                        <ExternalLink className="h-3 w-3" /> Thank-you msg
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => {
                          sendMessage(lead.id, 'Quick update — any thoughts on the property?');
                          toast.success('Update sent');
                        }}
                      >
                        <Send className="h-3 w-3" /> Send update
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => {
                          const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                          setLeadFollowUp(lead.id, dueAt, priorityFor(pt.confidence), 'Post-tour reminder');
                          toast.success('Reminder set for tomorrow');
                        }}
                      >
                        <BellRing className="h-3 w-3" /> Set reminder
                      </Button>
                    </div>

                    <Section title="Tour outcome — pick one">
                      <div id="post-tour-outcome" className="scroll-mt-4 space-y-2">
                        <p className="text-[11px] text-muted-foreground">
                          One choice only. You can change it anytime — Booked is not locked.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { o: "booked" as const, label: "Booked", decision: "booked" as const, hint: "Deal closed" },
                            { o: "thinking" as const, label: "Still deciding", decision: "thinking" as const, hint: "Needs follow-up" },
                            { o: "not-interested" as const, label: "Not interested", decision: "dropped" as const, hint: "Lost" },
                          ]).map((opt) => {
                            const selected = pt.outcome === opt.o;
                            return (
                              <button
                                key={opt.o}
                                type="button"
                                onClick={() => {
                                  updatePostTour(target.id, { outcome: opt.o });
                                  setDecision(target.id, opt.decision);
                                  toast.success(opt.label);
                                }}
                                className={`rounded-lg border px-2 py-2.5 text-left transition-colors ${
                                  selected
                                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                                    : "border-border bg-card hover:bg-muted/40"
                                }`}
                              >
                                <div className={`text-xs font-semibold ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                                  {selected ? "● " : "○ "}{opt.label}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{opt.hint}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </Section>

                    <Section title={`Deal confidence — ${pt.confidence}%`}>
                      <input
                        type="range" min={0} max={100} value={pt.confidence}
                        onChange={(e) => updatePostTour(target.id, { confidence: +e.target.value })}
                        className="w-full accent-[var(--color-accent)]"
                      />
                    </Section>

                    <Section title="Key objection">
                      <Select
                        value={pt.objection ?? ""}
                        onValueChange={(v) => updatePostTour(target.id, { objection: v })}
                      >
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select objection" /></SelectTrigger>
                        <SelectContent>
                          {OBJECTIONS.map((o) => <SelectItem key={o} value={o} className="text-sm">{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Textarea
                        rows={2} placeholder="Note…" value={pt.objectionNote}
                        onChange={(e) => updatePostTour(target.id, { objectionNote: e.target.value })}
                        className="text-sm resize-none mt-2"
                      />
                    </Section>

                    <div className="grid grid-cols-2 gap-3">
                      <Section title="Expected decision">
                        <Input
                          type="date"
                          value={pt.expectedDecisionAt ? pt.expectedDecisionAt.slice(0, 10) : ""}
                          onChange={(e) => {
                            const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
                            updatePostTour(target.id, { expectedDecisionAt: iso });
                            // Default follow-up to the day before decision (agent nudges before they decide).
                            if (iso && !pt.nextFollowUpAt) {
                              const nudge = new Date(iso);
                              nudge.setDate(nudge.getDate() - 1);
                              if (nudge.getTime() < Date.now()) nudge.setTime(Date.now() + 2 * 3600_000);
                              updatePostTour(target.id, { nextFollowUpAt: nudge.toISOString() });
                            }
                          }}
                          className="h-9 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">When the lead said they will decide</p>
                      </Section>
                      <Section title="Next follow-up">
                        <Input
                          type="datetime-local"
                          value={pt.nextFollowUpAt ? toLocal(pt.nextFollowUpAt) : ""}
                          onChange={(e) => {
                            const next = e.target.value ? new Date(e.target.value).toISOString() : null;
                            if (
                              next &&
                              pt.expectedDecisionAt &&
                              +new Date(next) > +new Date(pt.expectedDecisionAt)
                            ) {
                              toast.message("Follow-up is after decision date", {
                                description: "Usually call before they decide — nudging after is often too late.",
                              });
                            }
                            updatePostTour(target.id, { nextFollowUpAt: next });
                          }}
                          className="h-9 text-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">Should be before expected decision</p>
                      </Section>
                    </div>

                    {pt.filledAt ? (
                      <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-1 text-xs">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          <span className="font-medium">
                            {pt.outcome === "booked"
                              ? "Post-tour saved · ready to close the deal if payment is confirmed"
                              : pt.outcome === "thinking"
                                ? "Post-tour saved · follow-up is on /today — you're done here"
                                : "Post-tour saved · lead marked not interested"}
                          </span>
                        </div>
                        {pt.outcome === "thinking" && (
                          <p className="text-muted-foreground pl-6">
                            Do <strong>not</strong> click Close deal unless they actually pay/book. Still deciding ≠ booked.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2 text-xs">
                        <div className="flex items-start gap-2">
                          <ClipboardCheck className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-medium">Almost done — pick a Tour outcome above</div>
                            <p className="text-muted-foreground mt-0.5">
                              Click <strong>Still deciding</strong>, <strong>Booked</strong>, or <strong>Not interested</strong>.
                              The form saves automatically; then a <strong>Done</strong> / <strong>Close deal</strong> button appears here.
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="w-full h-8 text-xs"
                          onClick={() => {
                            document.getElementById("post-tour-outcome")?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }}
                        >
                          Jump to Tour outcome
                        </Button>
                      </div>
                    )}

                    {/* Close deal only when outcome is Booked — not for "still deciding". */}
                    {lead.stage !== "booked" && pt.outcome === "booked" && pt.filledAt && (
                      <Button
                        size="lg" className="w-full bg-success text-success-foreground hover:bg-success/90"
                        onClick={() => {
                          closeDeal({
                            leadId: lead.id,
                            tourId: target.id,
                            propertyId: target.propertyId,
                            tcmId: target.tcmId,
                            amount: prop?.pricePerBed ?? 12000,
                          });
                          toast.success(`Deal closed · ${lead.name} → ${prop?.name}`, {
                            description: `Bed blocked, MRR +₹${((prop?.pricePerBed ?? 12000) / 1000).toFixed(0)}k`,
                          });
                          setTab("checkin");
                        }}
                      >
                        <IndianRupee className="h-4 w-4 mr-1.5" /> Confirm booking · Close deal · ₹{((prop?.pricePerBed ?? 12000) / 1000).toFixed(0)}k/mo
                      </Button>
                    )}
                    {lead.stage !== "booked" && pt.outcome === "thinking" && pt.filledAt && (
                      <Button
                        size="lg"
                        className="w-full"
                        onClick={() => {
                          selectLead(null);
                          toast.message("Follow-up queued", {
                            description: "Check /today for the next touch on this lead.",
                          });
                        }}
                      >
                        Done · back to Today queue
                      </Button>
                    )}
                    {lead.stage !== "booked" && pt.outcome === "not-interested" && pt.filledAt && (
                      <Button
                        size="lg"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          selectLead(null);
                          toast.message("Lead marked not interested");
                        }}
                      >
                        Done · close panel
                      </Button>
                    )}
                    {lead.stage === "booked" && (
                      <div className="rounded-lg border border-success/40 bg-success/10 p-3 flex flex-col gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-success" />
                          <span className="font-semibold text-success">Booked.</span>
                          <span className="text-muted-foreground">Bed blocked, lead closed.</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs self-start"
                          onClick={() => {
                            setDecision(target.id, "thinking");
                            updatePostTour(target.id, { outcome: "thinking", confidence: 40 });
                            toast.message("Reverted to Still deciding", {
                              description: "Confidence set to 40 · Cold. Close deal was undone.",
                            });
                          }}
                        >
                          Undo booking · back to Still deciding
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </TabsContent>

            {/* HANDOFF — FlowOps ↔ TCM thread for this lead */}
            <TabsContent value="handoff" className="pt-4">
              <Section title="FlowOps ↔ TCM thread">
                <HandoffThread leadId={lead.id} />
              </Section>
            </TabsContent>

            {/* ACTIVITY LOG */}
            <TabsContent value="log" className="pt-4">
              <Section title="Activity log (auto)">
                <div className="space-y-2">
                  {leadActivities.length === 0 && (
                    <div className="text-xs text-muted-foreground">No activity yet.</div>
                  )}
                  {leadActivities.map((a) => (
                    <div key={a.id} className="flex gap-2 text-xs border-l-2 border-border pl-3 py-1">
                      <ActivityIcon className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground">{a.text}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">
                          {format(new Date(a.ts), "MMM d, p")} · {a.actor === "system" ? "system" : tcms.find((t) => t.id === a.actor)?.name ?? a.actor}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>

      <Dialog open={noShowOpen} onOpenChange={setNoShowOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-destructive" /> Mark no-show
            </DialogTitle>
            <DialogDescription>
              Lead missed the tour. We&apos;ll queue a rescue call in 30m and a reschedule nudge tomorrow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Reason</Label>
            <Select value={noShowReason} onValueChange={(v) => setNoShowReason(v as NoShowReason)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.entries(NO_SHOW_REASON_LABELS) as [NoShowReason, string][]).map(([k, label]) => (
                  <SelectItem key={k} value={k} className="text-sm">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setNoShowOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!noShowTourId) return;
                const { role, currentTcmId } = useApp.getState();
                void (async () => {
                  try {
                    const ops = await markNoShowViaOps({
                      role: role as OpsRole,
                      tcmId: currentTcmId,
                      tourId: noShowTourId,
                      reason: noShowReason,
                    });
                    if (ops.status === "error") {
                      toast.error(ops.message);
                      return;
                    }
                    markTourNoShow(noShowTourId, noShowReason);
                    setNoShowOpen(false);
                    toast.warning("No-show logged · ops", {
                      description: `Call due ${new Date(ops.rescueCallDueAt).toLocaleString()} · queue v${ops.cacheVersion}`,
                    });
                  } catch (e) {
                    markTourNoShow(noShowTourId, noShowReason);
                    setNoShowOpen(false);
                    toast.warning("No-show logged locally", {
                      description: e instanceof Error ? e.message : "Ops unavailable",
                    });
                  }
                })();
              }}
            >
              Confirm no-show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof CalendarIcon; label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-2.5 w-2.5" /> {label}
      </div>
      <div className="text-xs font-medium text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function UpcomingTourCard({
  tour, lead, scheduledAt, onScheduledAtChange, onReschedule, onCancel, onCancelAndRematch,
  onComplete, onNoShow, now, property,
}: {
  tour: import("@/lib/types").Tour;
  lead: import("@/lib/types").Lead;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  onReschedule: () => void;
  onCancel: () => void;
  onCancelAndRematch: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  now: number;
  property?: import("@/lib/types").Property;
}) {
  const { tcms, savePreTourCheck, clearPreTourCheck, syncPropertyVacancy, role, currentTcmId } = useApp();
  const [liveNow] = useMountedNow(30_000);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkDefault, setCheckDefault] = useState<"ok" | "problem">("ok");
  const [lockVersion, setLockVersion] = useState<number | null>(null);
  const [lockBeds, setLockBeds] = useState<number | null>(null);
  const tcm = tcms.find((t) => t.id === tour.tcmId);
  const check = tour.preTourCheck;
  const timing = preTourTiming(tour, liveNow || now);
  const lockNeeded = needsVacancyLock(tour, liveNow || now);
  const outlook = vacancyOutlook(property, tour.scheduledAt, liveNow || now, check);
  const atRisk = !outlook.availableForTour;
  const originally = tour.originallyScheduledAt ?? tour.scheduledAt;
  const rescheduled = originally !== tour.scheduledAt;
  const tourSlot = format(new Date(tour.scheduledAt), "EEE, MMM d · h:mm a");
  const sameSlot = scheduledAt
    ? isSameTourSlot(new Date(scheduledAt).toISOString(), tour.scheduledAt)
    : true;

  const statusBadge = timing.phase === "done"
    ? { label: "Confirmed", cls: "bg-success/15 text-success border-success/30" }
    : check?.outcome === "problem"
      ? { label: timing.isRequired ? "Very important" : "Problem logged", cls: "bg-destructive/15 text-destructive border-destructive/30" }
      : timing.isRequired
        ? { label: "Very important", cls: "bg-destructive/15 text-destructive border-destructive/30 animate-pulse" }
        : { label: "Optional", cls: "bg-muted text-muted-foreground border-border" };

  const openCheck = (mode: "ok" | "problem") => {
    setCheckDefault(mode);
    setLockVersion(property?.version ?? 1);
    setLockBeds(property?.vacantBeds ?? 0);
    setCheckOpen(true);
    if (property?.id) {
      void fetchOpsVacancy({
        role: role as OpsRole,
        tcmId: currentTcmId,
        propertyId: property.id,
      })
        .then((snap) => {
          setLockVersion(snap.version);
          setLockBeds(snap.vacantBeds);
          syncPropertyVacancy(snap.propertyId, snap.vacantBeds, snap.version, snap.nextVacancyAt);
        })
        .catch(() => {
          /* local version fallback already set */
        });
    }
  };

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-semibold text-sm">{lead.name}</div>
          <div className="text-xs text-muted-foreground truncate">{property?.name ?? "Property"}</div>
        </div>
        <Badge className="bg-accent text-accent-foreground capitalize shrink-0">{tour.status}</Badge>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Tour slot</dt>
        <dd className="font-medium">{tourSlot}</dd>
        <dt className="text-muted-foreground">Time left</dt>
        <dd className={timing.isRequired ? "font-semibold text-destructive" : "font-medium"}>
          {timing.countdown}
        </dd>
        <dt className="text-muted-foreground">Assigned</dt>
        <dd>{tcm?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">Availability</dt>
        <dd className={atRisk ? "text-destructive font-semibold" : "text-success font-medium"}>
          {outlook.summary}
        </dd>
        {rescheduled && (
          <>
            <dt className="text-muted-foreground">Originally</dt>
            <dd className="text-muted-foreground">{format(new Date(originally), "EEE, MMM d · h:mm a")}</dd>
          </>
        )}
      </dl>

      {/* TCM pre-tour check — required inside 3h, optional before */}
      <div className={`rounded-md border p-2.5 space-y-2 ${
        timing.isRequired
          ? "border-destructive/50 bg-destructive/5 ring-1 ring-destructive/20"
          : "border-border bg-card/80"
      }`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5" /> Pre-tour check
          </div>
          <Badge variant="outline" className={`text-[10px] h-5 ${statusBadge.cls}`}>{statusBadge.label}</Badge>
        </div>
        {timing.isRequired && !check && (
          <p className="text-[11px] text-destructive font-semibold">
            Very important — less than {SLA.preTourVacancyHours}h to tour ({timing.countdown}). Call owner & log below.
          </p>
        )}
        {timing.isOptionalAvailable && !check && (
          <p className="text-[11px] text-muted-foreground">
            Optional early check · {timing.countdown}
            {timing.windowOpensIn && ` · becomes required in ${timing.windowOpensIn}`}
          </p>
        )}
        {check && (
          <div className="text-[11px] space-y-0.5">
            {check.outcome === "problem" && check.problemKind && (
              <div className="font-medium text-destructive">{PRE_TOUR_PROBLEM_LABELS[check.problemKind]}</div>
            )}
            {check.bedsReported != null && (
              <div className="text-muted-foreground">Beds reported: {check.bedsReported}</div>
            )}
            {check.nextBedAt && (
              <div className="text-muted-foreground">Next bed: {format(new Date(check.nextBedAt), "EEE, MMM d · h:mm a")}</div>
            )}
            {check.note && <div className="text-muted-foreground italic">{check.note}</div>}
            <div className="text-[10px] text-muted-foreground">
              Updated {formatDistanceToNow(new Date(check.at), { addSuffix: true })}
            </div>
          </div>
        )}
        {outlook.actionHint && lockNeeded && (
          <p className="text-[11px] font-medium text-destructive">{outlook.actionHint}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => openCheck("ok")}>
            {check ? "Edit check" : "All good"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] text-destructive border-destructive/40" onClick={() => openCheck("problem")}>
            Report problem
          </Button>
          {check && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => {
              clearPreTourCheck(tour.id);
              toast.success("Pre-tour check cleared");
            }}>
              Clear
            </Button>
          )}
          {atRisk && (
            <Button size="sm" variant="destructive" className="h-7 text-[10px]" onClick={onCancelAndRematch}>
              Cancel & rematch PG
            </Button>
          )}
        </div>
      </div>

      <PreTourCheckDialog
        open={checkOpen}
        onOpenChange={setCheckOpen}
        tour={tour}
        lead={lead}
        property={property}
        existing={check}
        defaultOutcome={checkDefault}
        lockVersion={lockVersion}
        lockBeds={lockBeds}
        onSave={async (input) => {
          try {
            const ops = await savePreCheckViaOps({
              role: role as OpsRole,
              tcmId: currentTcmId,
              tourId: tour.id,
              body: input,
            });
            if (ops.status === "error") {
              const conflict = ops.code === "version_conflict" || ops.code === "no_beds";
              toast.error(ops.message, {
                description: conflict
                  ? `v${ops.propertyVersion ?? "?"} · ${ops.vacantBeds ?? "?"} beds · Cancel & rematch`
                  : ops.timingCountdown
                    ? `${ops.timingPhase} · ${ops.timingCountdown}`
                    : undefined,
              });
              if (ops.propertyVersion != null && property && ops.vacantBeds != null) {
                setLockVersion(ops.propertyVersion);
                setLockBeds(ops.vacantBeds);
                syncPropertyVacancy(property.id, ops.vacantBeds, ops.propertyVersion);
              }
              return false;
            }
            const ok = savePreTourCheck(tour.id, input);
            if (!ok) {
              toast.error("Local save failed after ops OK");
              return false;
            }
            syncPropertyVacancy(tour.propertyId, ops.vacantBeds, ops.propertyVersion);
            toast.success(
              input.outcome === "ok"
                ? `Pre-tour OK · lock v${ops.propertyVersion} · ops v${ops.cacheVersion}`
                : `Problem logged · lock v${ops.propertyVersion} · ops v${ops.cacheVersion}`,
            );
            return true;
          } catch (e) {
            const ok = savePreTourCheck(tour.id, input);
            if (ok) {
              toast.success(
                input.outcome === "ok" ? "Pre-tour check saved locally" : "Problem logged locally",
                { description: e instanceof Error ? e.message : "Ops unavailable" },
              );
            } else {
              toast.error("Could not save — beds not available for this tour slot");
            }
            return ok;
          }
        }}
      />
      <div className="space-y-1">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => onScheduledAtChange(e.target.value)}
            className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" onClick={onReschedule} disabled={sameSlot}>
            Reschedule
          </Button>
        </div>
        {sameSlot && (
          <p className="text-[10px] text-muted-foreground">Pick a different date or time to reschedule.</p>
        )}
      </div>
      <div className="flex gap-2 pt-1 flex-wrap">
        <Button size="sm" variant="outline" className="flex-1 min-w-[7rem]" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="outline" className="flex-1 min-w-[7rem] text-destructive border-destructive/40" onClick={onNoShow}>
          <UserX className="h-3.5 w-3.5 mr-1" /> No-show
        </Button>
        <Button size="sm" className="flex-1 min-w-[7rem]" onClick={onComplete}>Mark complete</Button>
      </div>
    </div>
  );
}

function NoShowTourCard({
  tour, scheduledAt, onScheduledAtChange, onRebook,
}: {
  tour: import("@/lib/types").Tour;
  scheduledAt: string;
  onScheduledAtChange: (value: string) => void;
  onRebook: () => void;
}) {
  const { properties, tcms } = useApp();
  const prop = properties.find((p) => p.id === tour.propertyId);
  const tcm = tcms.find((t) => t.id === tour.tcmId);
  const reasonLabel = tour.noShowReason ? NO_SHOW_REASON_LABELS[tour.noShowReason] : "No-show";
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-display font-semibold text-sm text-destructive flex items-center gap-1.5">
          <UserX className="h-4 w-4" /> {prop?.name}
        </div>
        <Badge variant="outline" className="text-destructive border-destructive/40">No-show</Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        Was {format(new Date(tour.scheduledAt), "EEE, MMM d · p")} · {tcm?.name}
        {tour.noShowAt && ` · logged ${formatDistanceToNow(new Date(tour.noShowAt), { addSuffix: true })}`}
      </div>
      <div className="text-[11px] text-muted-foreground">Reason: {reasonLabel}</div>
      <p className="text-[11px] text-muted-foreground">
        Rescue call + reschedule follow-ups are on <strong>/today</strong>. Rebook below when they confirm.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => onScheduledAtChange(e.target.value)}
          className="h-8 text-xs"
        />
        <Button size="sm" onClick={onRebook}>Rebook tour</Button>
      </div>
    </div>
  );
}

function formatMoveIn(raw: string | undefined | null): string {
  if (!raw?.trim()) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // Free-text from WhatsApp paste (e.g. "Last week of April")
    return raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
  }
  return format(d, "MMM d");
}

function toLocal(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function priorityFor(c: number): FollowUpPriority {
  return c >= 75 ? "high" : c >= 50 ? "medium" : "low";
}

/**
 * Impact tab — surfaces the Impact-Queue intelligence (NBA banner, SmartDossier,
 * property dossier, full CommandActions toolbelt) inside the unified Lead drawer
 * so every persona sees the same buttons (Dossier/Tour/Quote/Best Fit/Control/
 * Handoff/Log + Impact) from any entry point.
 */
function ImpactTabContent({ lead }: { lead: import("@/lib/types").Lead }) {
  const state = useImpactStateForLead(lead);
  if (!state) return null;
  const { openTour, lastQuote, column, nba, property, tcm } = state;
  return (
    <div className="space-y-4">
      <div className={`rounded-md border px-3 py-2 ${pressureColor(nba.pressure)}`}>
        <div className="text-[10px] uppercase tracking-wider opacity-70">Next best action</div>
        <div className="text-sm font-semibold">{nba.label}</div>
        <div className="text-[10px] opacity-80">{nba.reason}</div>
      </div>
      <SmartDossier lead={lead} />
      <LeadPropertyDossier lead={lead} />
      <CommandActions
        lead={lead}
        tcm={tcm}
        openTour={openTour}
        lastQuote={lastQuote}
        property={property}
        column={column}
      />
    </div>
  );
}
