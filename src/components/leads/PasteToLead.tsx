import { useMemo, useState } from "react";
import { parseLead, detectZone } from "@/lib/lead-identity/parser";
import {
  checkDuplicatesBridged,
  createLeadWithCrmSync,
  openCrmLeadForUnified,
} from "@/lib/lead-identity/bridge";
import type { CreateLeadBridgeResult } from "@/lib/lead-identity/bridge";
import type { MatchResult, ParsedLeadDraft, UnifiedLead } from "@/lib/lead-identity/types";
import { SAMPLE_WHATSAPP_PASTE } from "@/lib/lead-identity/sample-paste";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ClipboardPaste, Search, CheckCircle2, AlertCircle, Sparkles, FileText } from "lucide-react";
import { toast } from "sonner";
import { DuplicateModal } from "./DuplicateModal";
import { LeadSaveSuccess } from "./LeadSaveSuccess";
import { useApp } from "@/lib/store";
import { ingestLeadViaOps } from "@/lib/ops-api";
import type { OpsRole } from "@/server/ops/types";

interface Props {
  onCreated?: (lead: UnifiedLead) => void;
}

const emptyDraft = (): ParsedLeadDraft => ({
  name: "", phone: "", email: "", location: "", areas: [], fullAddress: "",
  budget: "", moveIn: "",
  type: "", room: "", need: "", specialReqs: "", inBLR: null, zone: "", rawSource: "",
});

export function PasteToLead({ onCreated }: Props) {
  const [raw, setRaw] = useState("");
  const [draft, setDraft] = useState<ParsedLeadDraft>(emptyDraft());
  const [parsed, setParsed] = useState(false);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [lastSave, setLastSave] = useState<CreateLeadBridgeResult | null>(null);

  const detected = useMemo(() => ({
    name: !!draft.name, phone: !!draft.phone, email: !!draft.email,
    location: !!draft.location, budget: !!draft.budget, moveIn: !!draft.moveIn,
    zone: !!draft.zone,
  }), [draft]);

  const resetForm = () => {
    setRaw("");
    setDraft(emptyDraft());
    setParsed(false);
    setMatch(null);
  };

  const applyParse = (text: string) => {
    const p = parseLead(text);
    if (!p) {
      toast.error("Couldn't parse — need at least name, phone, or email.");
      return false;
    }
    setDraft(p);
    setParsed(true);
    setLastSave(null);
    return true;
  };

  const onParse = () => {
    if (applyParse(raw)) {
      toast.success("Parsed — review fields, then save.");
    }
  };

  const onPasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRaw(text);
      if (applyParse(text)) toast.success("Pasted & parsed from clipboard");
    } catch {
      toast.error("Clipboard blocked — paste manually (Ctrl+V).");
    }
  };

  const onLoadSample = () => {
    setRaw(SAMPLE_WHATSAPP_PASTE);
    applyParse(SAMPLE_WHATSAPP_PASTE);
    toast.message("Sample Gharpayy WhatsApp form loaded");
  };

  const updateField = (k: keyof ParsedLeadDraft, v: string) => {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      if (k === "location") {
        next.zone = detectZone(`${v} ${d.rawSource}`);
      }
      return next;
    });
  };

  const commitSave = async (force = false) => {
    const { role, currentTcmId } = useApp.getState();
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const ops = await ingestLeadViaOps({
        role: role as OpsRole,
        tcmId: currentTcmId,
        idempotencyKey,
        body: {
          paste: draft.rawSource || raw || undefined,
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          location: draft.location || draft.areas?.[0],
          budget: draft.budget,
          moveIn: draft.moveIn,
          source: "WhatsApp paste",
          force,
        },
      });

      if (ops.status === "error") {
        toast.error(ops.message);
        return;
      }

      if (ops.status === "duplicate" && !force) {
        toast.message(`Ops dedup · ${ops.phoneMasked} already exists`, {
          description: `${ops.name} · hash ${ops.phoneHash.slice(0, 8)}…`,
        });
        const r = checkDuplicatesBridged(draft);
        if (r.type !== "new") {
          setMatch(r);
          setShowModal(true);
          return;
        }
      }

      const result = createLeadWithCrmSync(draft, { source: "WhatsApp paste" });
      setLastSave(result);
      setShowModal(false);
      resetForm();
      onCreated?.(result.unified);
      if (ops.status === "created") {
        toast.success(`${result.unified.name} saved · ${ops.phoneMasked} · ops v${ops.cacheVersion}${ops.replay ? " · replay" : ""}`);
      } else {
        toast.success(`${result.unified.name} saved · assigned to CRM`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ops ingest failed — saving locally");
      const result = createLeadWithCrmSync(draft, { source: "WhatsApp paste" });
      setLastSave(result);
      setShowModal(false);
      resetForm();
      onCreated?.(result.unified);
    }
  };

  const onCheckAndSave = () => {
    if (!draft.name?.trim() && !draft.phone?.trim() && !draft.email?.trim()) {
      toast.error("Need at least name, phone, or email");
      return;
    }
    void commitSave(false);
  };

  const onForceCreate = () => { void commitSave(true); };

  const onUseExisting = (lead: UnifiedLead) => {
    const opened = openCrmLeadForUnified(lead.ulid);
    toast.info(opened ? `Opened ${lead.name} in CRM` : `Existing lead: ${lead.name}`);
    setShowModal(false);
    onCreated?.(lead);
  };

  const Dot = ({ on }: { on: boolean }) => (
    <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${on ? "bg-primary" : "bg-muted-foreground/30"}`} />
  );

  return (
    <div className="space-y-4">
      {lastSave && (
        <LeadSaveSuccess
          unified={lastSave.unified}
          assignment={lastSave.assignment}
          onAddAnother={() => setLastSave(null)}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Paste from WhatsApp
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Copy the lead&apos;s Gharpayy form message → paste here → we parse name, phone, area, budget.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={onLoadSample}>
              <FileText className="h-3.5 w-3.5" /> Sample
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onPasteFromClipboard}>
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={onParse} disabled={!raw.trim()}>
              Parse
            </Button>
          </div>
        </div>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`Paste the WhatsApp message here…\n\n${SAMPLE_WHATSAPP_PASTE.split("\n").slice(0, 4).join("\n")}\n…`}
          className="min-h-36 font-mono text-xs"
        />
      </div>

      {parsed && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-sm">Review parsed fields</h3>
            {draft.zone && <Badge variant="secondary" className="text-[10px]">Zone · {draft.zone}</Badge>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px]"><Dot on={detected.name} />Name</Label>
              <Input value={draft.name} onChange={(e) => updateField("name", e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-[11px]"><Dot on={detected.phone} />Phone</Label>
              <Input value={draft.phone} onChange={(e) => updateField("phone", e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-[11px]"><Dot on={detected.email} />Email</Label>
              <Input value={draft.email} onChange={(e) => updateField("email", e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-[11px]"><Dot on={detected.location} />Location / Area</Label>
              <Input value={draft.location} onChange={(e) => updateField("location", e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-[11px]"><Dot on={detected.budget} />Budget</Label>
              <Input value={draft.budget} onChange={(e) => updateField("budget", e.target.value)} className="h-9 text-sm" placeholder="e.g. 8-12k" />
            </div>
            <div>
              <Label className="text-[11px]"><Dot on={detected.moveIn} />Move-in</Label>
              <Input value={draft.moveIn} onChange={(e) => updateField("moveIn", e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-[11px]">Type</Label>
              <Input value={draft.type} onChange={(e) => updateField("type", e.target.value)} className="h-9 text-sm" placeholder="Student / Working" />
            </div>
            <div>
              <Label className="text-[11px]">Room</Label>
              <Input value={draft.room} onChange={(e) => updateField("room", e.target.value)} className="h-9 text-sm" placeholder="Private / Shared" />
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            {Object.values(detected).filter(Boolean).length >= 3 ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Enough signals to dedup safely</>
            ) : (
              <><AlertCircle className="h-3.5 w-3.5 text-warning" /> Add more fields for stronger dedup confidence</>
            )}
          </div>

          <Button onClick={onCheckAndSave} className="w-full h-10 gap-2" disabled={!draft.name && !draft.phone && !draft.email}>
            <Search className="h-4 w-4" /> Save lead (dedup + assign)
          </Button>
        </div>
      )}

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
