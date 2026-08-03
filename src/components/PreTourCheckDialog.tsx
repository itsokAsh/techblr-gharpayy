import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Lead, Property, PreTourCheck, PreTourProblemKind, Tour } from "@/lib/types";
import { PRE_TOUR_PROBLEM_LABELS } from "@/lib/types";
import { format } from "date-fns";

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PreTourCheckDialog({
  open,
  onOpenChange,
  tour,
  lead,
  property,
  existing,
  defaultOutcome = "problem",
  lockVersion,
  lockBeds,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tour: Tour;
  lead: Lead;
  property?: Property;
  existing?: PreTourCheck | null;
  defaultOutcome?: "ok" | "problem";
  /** Server vacancy version for optimistic lock (ops). */
  lockVersion?: number | null;
  /** Server vacantBeds snapshot when dialog opened. */
  lockBeds?: number | null;
  onSave: (input: {
    outcome: "ok" | "problem";
    problemKind?: PreTourProblemKind | null;
    note?: string | null;
    bedsReported?: number | null;
    nextBedAt?: string | null;
    expectedVersion?: number;
  }) => boolean | Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<"ok" | "problem">(defaultOutcome);
  const [problemKind, setProblemKind] = useState<PreTourProblemKind>("no-bed");
  const [beds, setBeds] = useState(String(property?.vacantBeds ?? 0));
  const [nextBedAt, setNextBedAt] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const version = lockVersion ?? property?.version ?? 1;

  useEffect(() => {
    if (!open) return;
    setOutcome(existing?.outcome ?? defaultOutcome);
    setProblemKind(existing?.problemKind ?? "no-bed");
    setBeds(String(existing?.bedsReported ?? lockBeds ?? property?.vacantBeds ?? 0));
    setNextBedAt(toLocalInput(existing?.nextBedAt ?? property?.nextVacancyAt));
    setNote(existing?.note ?? "");
  }, [open, existing, defaultOutcome, property, lockBeds]);

  const tourSlot = format(new Date(tour.scheduledAt), "EEE, MMM d · h:mm a");

  const handleSave = async () => {
    const bedsN = beds === "" ? null : Math.max(0, parseInt(beds, 10) || 0);
    const nextIso = nextBedAt ? new Date(nextBedAt).toISOString() : null;
    setSaving(true);
    try {
      const ok = await onSave({
        outcome,
        problemKind: outcome === "problem" ? problemKind : null,
        note: note.trim() || null,
        bedsReported: bedsN,
        nextBedAt: nextIso,
        expectedVersion: version,
      });
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pre-tour check · {lead.name}</DialogTitle>
          <DialogDescription>
            {property?.name ?? "Property"} · tour {tourSlot}. Vacancy lock v{version}
            {lockBeds != null ? ` · ${lockBeds} beds` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={outcome === "ok" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setOutcome("ok")}
            >
              All good
            </Button>
            <Button
              type="button"
              size="sm"
              variant={outcome === "problem" ? "destructive" : "outline"}
              className="flex-1"
              onClick={() => setOutcome("problem")}
            >
              Report problem
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Beds free now</Label>
              <Input
                type="number"
                min={0}
                value={beds}
                onChange={(e) => setBeds(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Next bed free</Label>
              <Input
                type="datetime-local"
                value={nextBedAt}
                onChange={(e) => setNextBedAt(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          {outcome === "problem" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Problem type</Label>
                <Select value={problemKind} onValueChange={(v) => setProblemKind(v as PreTourProblemKind)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRE_TOUR_PROBLEM_LABELS) as PreTourProblemKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{PRE_TOUR_PROBLEM_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes for Flow Ops / rematch</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Owner said checkout Friday, only twin left, gate locked…"
                  className="min-h-[72px] text-sm"
                />
              </div>
            </>
          )}

          {outcome === "ok" && (
            <p className="text-[11px] text-muted-foreground">
              Confirms bed availability with optimistic lock (v{version}). If beds changed elsewhere you&apos;ll get a conflict — rematch PG.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : existing ? "Update check" : "Save check"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
