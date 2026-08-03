import { useEffect, useMemo, useState } from "react";
import { detectZone } from "@/lib/lead-identity/parser";
import {
  checkDuplicatesBridged,
  createLeadWithCrmSync,
  openCrmLeadForUnified,
} from "@/lib/lead-identity/bridge";
import { getTcm } from "@/lib/store";
import type { MatchResult, ParsedLeadDraft, UnifiedLead } from "@/lib/lead-identity/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, AlertCircle, User, Phone, Mail, MapPin, Wallet,
  CalendarDays, Briefcase, BedDouble, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { DuplicateModal } from "./DuplicateModal";

interface Props {
  onCreated?: (lead: UnifiedLead) => void;
}

const emptyDraft = (): ParsedLeadDraft => ({
  name: "", phone: "", email: "", location: "", areas: [], fullAddress: "",
  budget: "", moveIn: "",
  type: "", room: "", need: "", specialReqs: "", inBLR: null, zone: "", rawSource: "",
});

const TYPE_OPTIONS = ["Student", "Working professional", "Intern", "Family", "Other"];
const ROOM_OPTIONS = ["Private", "Shared (2)", "Shared (3+)", "Studio", "Any"];
const NEED_OPTIONS = ["Boys", "Girls", "Coed", "Any"];

// Light validators
const phoneOk = (v: string) => v.replace(/\D/g, "").length >= 10;
const emailOk = (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function DirectLeadForm({ onCreated }: Props) {
  const [draft, setDraft] = useState<ParsedLeadDraft>(emptyDraft());
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Auto-detect zone when location changes
  useEffect(() => {
    if (!draft.location) return;
    const zone = detectZone(draft.location);
    if (zone && zone !== draft.zone) {
      setDraft((d) => ({ ...d, zone }));
    }
  }, [draft.location]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = <K extends keyof ParsedLeadDraft>(k: K, v: ParsedLeadDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const errors = useMemo(() => {
    const e: Partial<Record<keyof ParsedLeadDraft, string>> = {};
    if (!draft.name.trim()) e.name = "Name is required";
    if (!draft.phone.trim()) e.phone = "Phone is required";
    else if (!phoneOk(draft.phone)) e.phone = "Enter a valid 10-digit phone";
    if (!emailOk(draft.email)) e.email = "Invalid email";
    return e;
  }, [draft]);

  const filled = useMemo(() => {
    const fields: (keyof ParsedLeadDraft)[] = ["name", "phone", "email", "location", "budget", "moveIn", "type", "room"];
    return fields.filter((f) => String(draft[f] ?? "").trim().length > 0).length;
  }, [draft]);
  const completion = Math.round((filled / 8) * 100);

  const submit = () => {
    setTouched({ name: true, phone: true, email: true });
    if (Object.keys(errors).length > 0) {
      toast.error("Fix the highlighted fields first");
      return;
    }
    setSubmitting(true);
    const result = checkDuplicatesBridged(draft);
    setMatch(result);
    setShowModal(true);
    setSubmitting(false);
  };

  const onForceCreate = () => {
    const { unified, assignment } = createLeadWithCrmSync(draft);
    const tcm = getTcm(assignment.tcmId);
    toast.success(`Lead created · assigned to ${tcm?.name ?? "TCM"}`);
    setShowModal(false);
    setDraft(emptyDraft());
    setTouched({});
    setMatch(null);
    onCreated?.(unified);
  };

  const onUseExisting = (lead: UnifiedLead) => {
    const opened = openCrmLeadForUnified(lead.ulid);
    toast.info(opened ? `Opened ${lead.name} in CRM` : `Existing lead: ${lead.name}`);
    setShowModal(false);
    onCreated?.(lead);
  };

  const showError = (k: keyof ParsedLeadDraft) => touched[k as string] && errors[k];

  return (
    <div className="space-y-4">
      {/* Header progress */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">New lead</h3>
            <p className="text-[11px] text-muted-foreground">Direct entry · auto zone detect · live dedup</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Completion</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${completion}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums">{completion}%</span>
          </div>
        </div>
      </div>

      {/* Identity */}
      <Section title="Identity" subtitle="Required for safe deduplication">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField icon={User} label="Full name *" error={showError("name") ? errors.name : undefined}>
            <Input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              placeholder="Rahul Sharma"
              className="h-10 text-sm"
              autoFocus
            />
          </FormField>
          <FormField icon={Phone} label="Phone *" error={showError("phone") ? errors.phone : undefined}>
            <Input
              value={draft.phone}
              onChange={(e) => update("phone", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              placeholder="+91 98xxxxxxxx"
              inputMode="tel"
              className="h-10 text-sm"
            />
          </FormField>
          <FormField icon={Mail} label="Email" error={showError("email") ? errors.email : undefined}>
            <Input
              value={draft.email}
              onChange={(e) => update("email", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              placeholder="rahul@example.com"
              type="email"
              className="h-10 text-sm"
            />
          </FormField>
          <FormField icon={MapPin} label="Preferred area / location">
            <div className="relative">
              <Input
                value={draft.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Koramangala"
                className="h-10 text-sm pr-20"
              />
              {draft.zone && (
                <Badge variant="secondary" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]">
                  {draft.zone}
                </Badge>
              )}
            </div>
          </FormField>
        </div>
      </Section>

      {/* Requirements */}
      <Section title="Requirements" subtitle="The more you fill, the better the match">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField icon={Wallet} label="Budget (₹/month)">
            <Input
              value={draft.budget}
              onChange={(e) => update("budget", e.target.value)}
              placeholder="8000-12000"
              className="h-10 text-sm"
            />
          </FormField>
          <FormField icon={CalendarDays} label="Move-in">
            <Input
              type="date"
              value={draft.moveIn}
              onChange={(e) => update("moveIn", e.target.value)}
              className="h-10 text-sm"
            />
          </FormField>
          <FormField icon={Briefcase} label="Type">
            <Select value={draft.type} onValueChange={(v) => update("type", v)}>
              <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField icon={BedDouble} label="Room preference">
            <Select value={draft.room} onValueChange={(v) => update("room", v)}>
              <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {ROOM_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Cohort / need">
            <Select value={draft.need} onValueChange={(v) => update("need", v)}>
              <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {NEED_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Currently in Bangalore?">
            <Select
              value={draft.inBLR === null ? "" : draft.inBLR ? "yes" : "no"}
              onValueChange={(v) => update("inBLR", v === "" ? null : v === "yes")}
            >
              <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField label="Special requirements / notes">
          <Textarea
            value={draft.specialReqs}
            onChange={(e) => update("specialReqs", e.target.value)}
            placeholder="e.g. needs parking, food preferences, family visiting…"
            className="min-h-20 text-sm"
          />
        </FormField>
      </Section>

      {/* Footer */}
      <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 bg-gradient-to-t from-background via-background/95 to-background/0">
        <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {filled >= 4 ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Strong signals — ready to dedup & save</>
            ) : (
              <><AlertCircle className="h-3.5 w-3.5 text-amber-500" /> Add a few more fields for confident dedup</>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={() => { setDraft(emptyDraft()); setTouched({}); }}>
              Reset
            </Button>
            <Button onClick={submit} disabled={submitting || Object.keys(errors).length > 0} size="sm" className="h-9 gap-2 min-w-36">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save lead
            </Button>
          </div>
        </div>
      </div>

      <DuplicateModal
        open={showModal}
        onClose={() => setShowModal(false)}
        result={match}
        onForceCreate={onForceCreate}
        onUseExisting={onUseExisting}
      />
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function FormField({
  label, error, icon: Icon, children,
}: {
  label: string;
  error?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </Label>
      {children}
      {error && <p className="text-[10px] text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {error}</p>}
    </div>
  );
}
