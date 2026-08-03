// Quick Add Lead — full lead schema in a single floating panel.
// Designed for the "WhatsApp + PiP dashboard" workflow:
//  • Paste an entire WhatsApp message into ANY field → auto-parse every column
//  • Manual edit any auto-filled field
//  • Save + Next keeps panel open for rapid one-handed entry
//  • ⌘/Ctrl+Enter saves and closes
//  • Works identically inside the PiP window and the main tab
//
// Captures: Name · Phone · Email · Areas (multi) · Full Address · Budget ·
// Move-in · Type · Room · Need · Special Reqs · In-BLR · Lead Quality ·
// Zone (categorical) · Assign Member · Lead Stage · Notes
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { checkDuplicatesBridged, createLeadWithCrmSync } from "@/lib/lead-identity/bridge";
import { getTcm } from "@/lib/store";
import { detectZone, parseLead } from "@/lib/lead-identity/parser";
import { teamMembers } from "@/myt/lib/mock-data";
import { toast } from "sonner";
import { Save, Repeat2, Phone, MapPin, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { open: boolean; onClose: () => void; }

const todayIso = () => new Date().toISOString().slice(0, 10);

const ZONE_BUCKETS = [
  "CENTRAL STUDENTS", "CU YPR / STUDENTS / WORKING", "HOMES KORA", "HOMES MWB",
  "KORA CORE", "MTECH HUB", "MWB MORE", "OTHERS COLLEGE STUDENTS",
  "YPR MAJOR MAIN", "OTHERS",
] as const;

const STAGES = [
  "MYT [TENANT]",
  "2A. Options Shared – BLR",
  "2B. Options Shared – Non-BLR",
  "3A. Visit Intent Confirmed",
  "3B. try.prebook / virtual tour Intent",
  "4A. Visit Scheduled in BLR",
  "5A. Visit Done",
  "Finalizing",
  "WON 🏆",
  "LOST 😭",
] as const;

const TYPE_OPTS = ["Student", "Working", "Intern", "Family", "Other"];
const ROOM_OPTS = ["Private", "Shared", "Both", "Studio"];
const NEED_OPTS = ["Boys", "Girls", "Coed"];
const QUALITY_OPTS = [
  { v: "hot" as const, label: "🔥 Hot" },
  { v: "good" as const, label: "✅ Good" },
  { v: "bad" as const, label: "❌ Bad" },
];
const BLR_OPTS = [
  { v: true as const, label: "🏙 In" },
  { v: false as const, label: "✈️ Out" },
  { v: null, label: "❓ Unknown" },
];

export function QuickAddLeadPanel({ open, onClose }: Props) {
  const checkDup = checkDuplicatesBridged;

  // Core
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [areasText, setAreasText] = useState("");        // comma-separated areas
  const [fullAddress, setFullAddress] = useState("");
  const [budget, setBudget] = useState("");
  const [moveIn, setMoveIn] = useState(todayIso());
  const [type, setType] = useState("");
  const [room, setRoom] = useState("");
  const [need, setNeed] = useState("");
  const [specialReqs, setSpecialReqs] = useState("");
  // Editorial
  const [inBLR, setInBLR] = useState<boolean | null>(null);
  const [quality, setQuality] = useState<"hot" | "good" | "bad" | null>(null);
  const [zoneBucket, setZoneBucket] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [stage, setStage] = useState<string>(STAGES[0]);
  const [notes, setNotes] = useState("");

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setTimeout(() => nameRef.current?.focus(), 50); }, [open]);

  const detectedZone = useMemo(
    () => detectZone(`${areasText} ${fullAddress}`),
    [areasText, fullAddress],
  );

  const reset = () => {
    setName(""); setPhone(""); setEmail("");
    setAreasText(""); setFullAddress("");
    setBudget(""); setMoveIn(todayIso());
    setType(""); setRoom(""); setNeed(""); setSpecialReqs("");
    setInBLR(null); setQuality(null); setZoneBucket("");
    setAssigneeId(""); setStage(STAGES[0]); setNotes("");
    setTimeout(() => nameRef.current?.focus(), 30);
  };

  const save = (keepOpen: boolean) => {
    if (!name.trim() || !phone.replace(/\D/g, "").match(/^[6-9]\d{9}$/)) {
      toast.error("Need a name and a valid 10-digit phone");
      return;
    }
    const dup = checkDup({ name, phone, email, location: areasText });
    if (dup.type === "exact" || dup.type === "strong") {
      toast.warning(`Duplicate detected: ${dup.candidates[0]?.lead.name}`);
      return;
    }
    const areasArr = areasText.split(",").map((a) => a.trim()).filter(Boolean);
    const assignee = teamMembers.find((m) => m.id === assigneeId);
    const { unified, assignment } = createLeadWithCrmSync(
      {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        location: areasText.trim(),
        areas: areasArr,
        fullAddress: fullAddress.trim(),
        budget: budget.trim(),
        moveIn,
        type, room, need,
        specialReqs: [specialReqs, notes].filter(Boolean).join(" · "),
        inBLR,
        zone: detectedZone,
        rawSource: `[QuickAdd] ${name} ${phone}`,
      },
      {
        quality,
        stage,
        zoneCategory: zoneBucket,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.name ?? null,
        source: "Quick add",
      },
    );
    const tcm = getTcm(assignment.tcmId);
    toast.success(`Lead saved · ${unified.name} · ${tcm?.name ?? "TCM"}`);
    if (keepOpen) reset(); else onClose();
  };

  // Paste WhatsApp message into ANY input → auto-fill everything we can
  const onAnyPaste = (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData("text");
    if (!txt || txt.length < 30) return;
    const parsed = parseLead(txt);
    if (!parsed) return;
    e.preventDefault();
    if (parsed.name) setName(parsed.name);
    if (parsed.phone) setPhone(parsed.phone);
    if (parsed.email) setEmail(parsed.email);
    if (parsed.areas?.length) setAreasText(parsed.areas.join(", "));
    else if (parsed.location) setAreasText(parsed.location);
    if (parsed.fullAddress) setFullAddress(parsed.fullAddress);
    if (parsed.budget) setBudget(parsed.budget);
    if (parsed.moveIn && /^\d{4}-\d{2}-\d{2}$/.test(parsed.moveIn)) setMoveIn(parsed.moveIn);
    if (parsed.type) setType(parsed.type);
    if (parsed.room) setRoom(parsed.room);
    if (parsed.need) setNeed(parsed.need.split(" / ")[0] ?? parsed.need);
    if (parsed.specialReqs) setSpecialReqs(parsed.specialReqs);
    if (parsed.inBLR !== null) setInBLR(parsed.inBLR);
    toast.success("Auto-filled from WhatsApp paste");
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(false); }
        }}
      >
        <SheetHeader className="px-5 pt-5">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Quick Add Lead
          </SheetTitle>
          <p className="text-[11px] text-muted-foreground">
            Paste a WhatsApp message into <strong>any</strong> field → auto-fills every column ·
            ⌘/Ctrl + Enter saves
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" onPaste={onAnyPaste}>
          {/* Name + Phone */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="👤 Name *">
              <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Sharma" />
            </Field>
            <Field label="📱 Phone *">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" inputMode="tel" />
            </Field>
          </div>

          <Field label="✉️ Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" inputMode="email" />
          </Field>

          {/* Areas */}
          <Field label="📍 Areas (comma-separated)">
            <div className="relative">
              <Input
                value={areasText}
                onChange={(e) => setAreasText(e.target.value)}
                placeholder="HSR Layout, BTM, Koramangala"
              />
              {detectedZone && (
                <Badge variant="secondary" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px]">
                  {detectedZone}
                </Badge>
              )}
            </div>
            {areasText.includes(",") && (
              <p className="text-[10px] text-primary mt-1 flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5" /> Multiple Areas Detected
              </p>
            )}
          </Field>

          {/* Full Address */}
          <Field label="🏠 Full Address / Map link">
            <Textarea
              value={fullAddress}
              onChange={(e) => setFullAddress(e.target.value)}
              rows={2}
              placeholder="Door no, street, landmark or Google Maps URL"
              className="resize-none"
            />
          </Field>

          {/* Budget + Move-in */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="💰 Budget">
              <Input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="8-12k" />
            </Field>
            <Field label="📅 Move-in">
              <Input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
            </Field>
          </div>

          {/* Type + Room + Need (chips) */}
          <Field label="💼 Type">
            <ChipGroup options={TYPE_OPTS} value={type} onChange={setType} />
          </Field>
          <Field label="🛏 Room">
            <ChipGroup options={ROOM_OPTS} value={room} onChange={setRoom} />
          </Field>
          <Field label="👥 Need">
            <ChipGroup options={NEED_OPTS} value={need} onChange={setNeed} />
          </Field>

          {/* Special requests */}
          <Field label="⭐ Special Requests">
            <Textarea
              value={specialReqs}
              onChange={(e) => setSpecialReqs(e.target.value)}
              rows={2}
              placeholder="Veg only · attached washroom · top floor…"
              className="resize-none"
            />
          </Field>

          {/* In-BLR */}
          <Field label="Currently in Bangalore?">
            <ChipGroup
              options={BLR_OPTS.map((o) => o.label)}
              value={BLR_OPTS.find((o) => o.v === inBLR)?.label ?? ""}
              onChange={(label) => setInBLR(BLR_OPTS.find((o) => o.label === label)?.v ?? null)}
            />
          </Field>

          {/* Quality */}
          <Field label="Lead Quality">
            <ChipGroup
              options={QUALITY_OPTS.map((o) => o.label)}
              value={QUALITY_OPTS.find((o) => o.v === quality)?.label ?? ""}
              onChange={(label) => setQuality(QUALITY_OPTS.find((o) => o.label === label)?.v ?? null)}
            />
          </Field>

          {/* Zone bucket */}
          <Field label="Zone *">
            <select
              value={zoneBucket}
              onChange={(e) => setZoneBucket(e.target.value)}
              className="w-full h-9 bg-background border border-border rounded-md px-2 text-xs"
            >
              <option value="">Select zone bucket…</option>
              {ZONE_BUCKETS.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>

          {/* Assignee */}
          <Field label="Assign Member">
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full h-9 bg-background border border-border rounded-md px-2 text-xs"
            >
              <option value="">Unassigned</option>
              {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>

          {/* Stage */}
          <Field label="Lead Stage">
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full h-9 bg-background border border-border rounded-md px-2 text-xs"
            >
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          {/* Notes */}
          <Field label="📝 Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Free notes…"
              className="resize-none"
            />
          </Field>
        </div>

        <div className="border-t border-border px-5 py-3 flex flex-col gap-2 bg-background">
          <div className="flex gap-2">
            <Button onClick={() => save(true)} variant="outline" size="sm" className="flex-1 gap-1.5">
              <Repeat2 className="h-3.5 w-3.5" /> Save + Next
            </Button>
            <Button onClick={() => save(false)} size="sm" className="flex-1 gap-1.5">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Tip: paste a WhatsApp message anywhere → all fields auto-fill · ⌘/Ctrl + Enter to save
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</Label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ChipGroup({ options, value, onChange }: {
  options: readonly string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? "" : opt)}
          className={cn(
            "px-2 py-1 text-[11px] rounded-md border transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
