import { useState } from 'react';
import { useAppState } from '@/myt/lib/app-context';
import { zones, teamMembers } from '@/myt/lib/mock-data';
import { Lead } from '@/myt/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Plus, Phone, ArrowRight, Sparkles, PictureInPicture2, FlaskConical, Zap, Info } from 'lucide-react';
import { useNavigate } from '@/shims/react-router-dom';
import { PasteToLead } from '@/components/leads/PasteToLead';
import { RequestAccessSheet } from '@/components/leads/RequestAccessSheet';
import { useIdentityStore } from '@/lib/lead-identity/store';
import { openCrmLeadForUnified } from '@/lib/lead-identity/bridge';
import { ParserTestModal } from '@/components/leads/ParserTestModal';
import { QuickAddLeadPanel } from '@/components/leads/QuickAddLeadPanel';
import { usePip } from '@/components/pip/PipProvider';

export default function MYTLeadTracker() {
  const { leads, setLeads, currentMemberId } = useAppState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'paste' | 'manual' | 'requests'>('paste');
  // Select stable store refs only — never .slice/.filter inside the selector
  // (new arrays every snapshot → React "Maximum update depth exceeded").
  const identityLeads = useIdentityStore((s) => s.leads);
  const identityLeadCount = identityLeads.length;
  const recentPasted = identityLeads.slice(0, 5);
  const [showForm, setShowForm] = useState(false);
  const [showParserTest, setShowParserTest] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const { open: openPip, close: closePip, active: pipActive, supported: pipSupported } = usePip();
  const [form, setForm] = useState({
    name: '', phone: '', area: '', budget: '10000',
    moveInDate: '', dateConfirmed: false,
  });

  const myLeads = currentMemberId
    ? leads.filter(l => l.addedBy === currentMemberId)
    : leads;

  const qualified = myLeads.filter(l => l.mytQualified);
  const unqualified = myLeads.filter(l => !l.mytQualified);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const budget = parseInt(form.budget);
    const moveIn = new Date(form.moveInDate);
    const areaCovered = zones.some(z => z.area.toLowerCase() === form.area.toLowerCase());
    const daysToMoveIn = (moveIn.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    const mytQualified = areaCovered && budget >= 7000 && daysToMoveIn <= 15 && form.dateConfirmed;

    const agent = currentMemberId
      ? teamMembers.find(m => m.id === currentMemberId)
      : teamMembers.find(m => m.role === 'flow-ops');

    const newLead: Lead = {
      id: `l${Date.now()}`,
      name: form.name,
      phone: form.phone,
      area: form.area,
      budget,
      moveInDate: form.moveInDate,
      dateConfirmed: form.dateConfirmed,
      status: mytQualified ? 'qualified' : 'contacted',
      mytQualified,
      addedBy: agent?.id || 'm1',
      addedByName: agent?.name || 'Rahul Sharma',
      createdAt: new Date().toISOString(),
      notes: '',
    };
    setLeads(prev => [newLead, ...prev]);
    toast.success(mytQualified ? 'MYT Qualified! Ready for tour' : 'Lead added — not MYT qualified');
    setForm({ name: '', phone: '', area: '', budget: '10000', moveInDate: '', dateConfirmed: false });
    setShowForm(false);
  };

  const pushToTour = (lead: Lead) => {
    navigate('/myt/schedule', { state: { lead } });
  };

  const selectClass = "w-full h-10 bg-surface-2 border border-border rounded-md px-3 text-sm text-foreground";

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Toolbar */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-heading font-bold text-foreground">MYT Lead Tracker</h1>
          <p className="text-xs text-muted-foreground">
            Paste any format · auto-dedup against {identityLeadCount} unified leads
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={pipActive ? "secondary" : "default"}
            onClick={() => (pipActive ? closePip() : openPip())}
            disabled={!pipSupported && !pipActive}
            className="h-8 text-xs gap-1.5"
            title={pipSupported ? "Pop dashboard out as a floating window over WhatsApp" : "Document Picture-in-Picture not supported in this browser"}
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
            {pipActive ? "Exit PiP" : "Open PiP"}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={async () => { if (!pipActive && pipSupported) await openPip(); setShowQuickAdd(true); }}
            disabled={!pipSupported && !pipActive}
            className="h-8 text-xs gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90"
            title="Open PiP and immediately start adding a lead inside the floating window"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" /> PiP + Add Lead
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowQuickAdd(true)} className="h-8 text-xs gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Quick Add
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowParserTest(true)} className="h-8 text-xs gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Run Parser Test
          </Button>
        </div>
      </div>

      {/* PiP fallback */}
      {!pipSupported && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-foreground">Picture-in-Picture isn't available in this browser.</div>
            <div className="text-muted-foreground">
              For the floating dashboard, open this site in <strong>Chrome, Edge, Brave or Opera</strong> on
              desktop. Alternative: use split-screen (Windows: <kbd className="px-1 rounded border border-border">Win</kbd>+<kbd className="px-1 rounded border border-border">←</kbd> · macOS: drag tab into a Stage Manager group).
            </div>
          </div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-surface-2/50 w-fit">
        <button onClick={() => setMode('paste')} className={`px-2.5 py-1 text-[11px] rounded-md ${mode === 'paste' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
          <Sparkles className="h-3 w-3 inline mr-1" />Paste
        </button>
        <button onClick={() => setMode('manual')} className={`px-2.5 py-1 text-[11px] rounded-md ${mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
          Manual
        </button>
        <button onClick={() => setMode('requests')} className={`px-2.5 py-1 text-[11px] rounded-md ${mode === 'requests' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
          Requests
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card p-3 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-role-tcm" />
          <div>
            <p className="text-lg font-heading font-bold text-foreground">{qualified.length}</p>
            <p className="text-[10px] text-muted-foreground">MYT Qualified</p>
          </div>
        </div>
        <div className="glass-card p-3 flex items-center gap-3">
          <XCircle className="h-5 w-5 text-danger" />
          <div>
            <p className="text-lg font-heading font-bold text-foreground">{unqualified.length}</p>
            <p className="text-[10px] text-muted-foreground">Not Qualified</p>
          </div>
        </div>
      </div>

      {mode === 'paste' && (
        <>
          <PasteToLead />
          {recentPasted.length > 0 && (
            <div className="glass-card p-3 md:p-4 space-y-2">
              <h3 className="font-heading font-semibold text-xs md:text-sm">Recently pasted (saved to CRM)</h3>
              <div className="space-y-1.5">
                {recentPasted.map((l) => (
                  <button
                    key={l.ulid}
                    type="button"
                    onClick={() => openCrmLeadForUnified(l.ulid)}
                    className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-2/50 hover:bg-surface-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-sm text-foreground">{l.name}</span>
                      <span className="text-muted-foreground text-xs ml-2">{l.area || l.areas?.[0] || '—'}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{l.phoneRaw || l.phoneE164}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {mode === 'requests' && <RequestAccessSheet />}
      {mode === 'manual' && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowForm(!showForm)} className="h-8 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" /> {showForm ? 'Hide form' : 'Manual MYT form'}
          </Button>
        </div>
      )}

      {/* Add Lead Form */}
      {mode === 'manual' && showForm && (
        <form onSubmit={handleSubmit} className="glass-card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-muted-foreground text-xs">Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="bg-surface-2 border-border" />
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Phone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} required className="bg-surface-2 border-border" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-muted-foreground text-xs">Area</Label>
              <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className={selectClass}>
                <option value="">Select Area</option>
                {zones.map(z => <option key={z.id} value={z.area}>{z.area}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Budget (₹)</Label>
              <Input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} className="bg-surface-2 border-border" />
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Move-in Date</Label>
              <Input type="date" value={form.moveInDate} onChange={e => setForm(f => ({ ...f, moveInDate: e.target.value }))} required className="bg-surface-2 border-border" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={form.dateConfirmed} onChange={e => setForm(f => ({ ...f, dateConfirmed: e.target.checked }))} className="rounded" />
            Date confirmed by lead
          </label>
          <Button type="submit" className="w-full">Add & Qualify Lead</Button>
        </form>
      )}

      {/* Qualified Leads */}
      <div className="glass-card p-3 md:p-5">
        <h3 className="font-heading font-semibold text-xs md:text-sm mb-3 text-role-tcm">✅ MYT Qualified — Push to Tour</h3>
        <div className="space-y-2">
          {qualified.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No qualified leads yet</p>}
          {qualified.map(l => (
            <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-surface-2/50">
              <div className="min-w-0">
                <span className="font-medium text-foreground text-sm">{l.name}</span>
                <span className="text-muted-foreground text-xs ml-2">{l.area} · ₹{l.budget.toLocaleString()}</span>
                <span className="text-muted-foreground text-xs ml-2">Move-in: {l.moveInDate}</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <a href={`tel:${l.phone}`} className="p-2 rounded-md bg-primary/10 text-primary">
                  <Phone className="h-3.5 w-3.5" />
                </a>
                {l.status !== 'tour-scheduled' && (
                  <Button size="sm" onClick={() => pushToTour(l)} className="h-8 text-xs gap-1">
                    <ArrowRight className="h-3.5 w-3.5" /> Schedule Tour
                  </Button>
                )}
                {l.status === 'tour-scheduled' && (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-role-tcm/15 text-role-tcm">Tour Set</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unqualified */}
      <div className="glass-card p-3 md:p-5">
        <h3 className="font-heading font-semibold text-xs md:text-sm mb-3 text-danger">❌ Not Qualified</h3>
        <div className="space-y-2">
          {unqualified.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">All leads are qualified!</p>}
          {unqualified.map(l => (
            <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-surface-2/30">
              <div className="min-w-0">
                <span className="font-medium text-foreground text-sm">{l.name}</span>
                <span className="text-muted-foreground text-xs ml-2">{l.area} · ₹{l.budget.toLocaleString()}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {l.budget < 7000 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">Low budget</span>}
                {!l.dateConfirmed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning">No date</span>}
                {!zones.some(z => z.area === l.area) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger">Area N/A</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ParserTestModal open={showParserTest} onClose={() => setShowParserTest(false)} />
      <QuickAddLeadPanel open={showQuickAdd} onClose={() => setShowQuickAdd(false)} />
    </div>
  );
}
