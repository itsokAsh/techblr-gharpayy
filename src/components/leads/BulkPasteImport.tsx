import { useState } from "react";
import { parseLead, splitLeads } from "@/lib/lead-identity/parser";
import { checkDuplicatesBridged, createLeadWithCrmSync } from "@/lib/lead-identity/bridge";
import type { MatchResult, ParsedLeadDraft } from "@/lib/lead-identity/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ListPlus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface Row {
  draft: ParsedLeadDraft;
  match: MatchResult;
  selected: boolean;
}

const matchColor = (t: MatchResult["type"]) =>
  t === "exact" ? "bg-destructive/10 text-destructive border-destructive/30"
  : t === "strong" ? "bg-warning/10 text-warning border-warning/30"
  : t === "possible" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
  : "bg-primary/10 text-primary border-primary/30";

export function BulkPasteImport() {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const onParse = () => {
    const chunks = splitLeads(raw);
    const drafts = chunks.map(parseLead).filter((d): d is ParsedLeadDraft => !!d);
    if (!drafts.length) { toast.error("No leads detected in pasted text"); return; }
    const next: Row[] = drafts.map((d) => {
      const m = checkDuplicatesBridged(d);
      return { draft: d, match: m, selected: m.type !== "exact" };
    });
    setRows(next);
    toast.success(`Parsed ${next.length} leads`);
  };

  const onImport = () => {
    let created = 0;
    for (const r of rows) {
      if (!r.selected || r.match.type === "exact") continue;
      createLeadWithCrmSync(r.draft, { source: "Bulk paste" });
      created++;
    }
    toast.success(`Imported ${created} leads`);
    setRaw(""); setRows([]);
  };

  const toggle = (i: number) =>
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, selected: !r.selected } : r));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <ListPlus className="h-4 w-4 text-primary" /> Bulk paste
        </h3>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste an entire spreadsheet or WhatsApp dump — multiple leads at once."
          className="min-h-32 font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={onParse} disabled={!raw.trim()}>Parse all</Button>
          {rows.length > 0 && (
            <Button size="sm" variant="default" className="gap-1" onClick={onImport}>
              <ShieldCheck className="h-3.5 w-3.5" /> Import {rows.filter((r) => r.selected && r.match.type !== "exact").length} leads
            </Button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10"></th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Area · Zone</th>
                <th className="text-left px-3 py-2">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      disabled={r.match.type === "exact"}
                      onChange={() => toggle(i)}
                    />
                  </td>
                  <td className="px-3 py-2">{r.draft.name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.draft.phone || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.draft.location || "—"} {r.draft.zone && <span className="text-muted-foreground">· {r.draft.zone}</span>}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[10px] capitalize ${matchColor(r.match.type)}`}>
                      {r.match.type} · {r.match.topScore}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
