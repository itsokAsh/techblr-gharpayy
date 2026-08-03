// Converts the Property Hub PG catalog into the lightweight Property[] shape
// used by the Impact Queue / LeadActionDialog / store. This kills the dummy
// 7-property seed and lets every action (schedule, quote, book, hold,
// check-in, call) operate on the full real catalog.

import type { Property } from "@/lib/types";
import { PGS } from "@/property-genius/data/pgs";
import { bookableBeds } from "@/lib/owners/account-store";

// Stable hash → deterministic vacancy so re-renders don't shuffle counts.
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickPricePerBed(pg: (typeof PGS)[number]): number {
  const p = pg.prices ?? ({} as { double?: number; single?: number; triple?: number; min?: number });
  return p.double || p.single || p.triple || p.min || 12000;
}

export function pgsAsProperties(): Property[] {
  return PGS.map((pg) => {
    const h = hash(pg.id);
    const totalBeds = 12 + (h % 28);            // 12 – 39
    const vacantBeds = 1 + ((h >> 3) % Math.max(1, Math.floor(totalBeds / 3)));
    const daysSinceLastBooking = (h >> 5) % 21; // 0 – 20
    const eff = bookableBeds(pg.id, vacantBeds, totalBeds);
    return {
      id: pg.id,
      name: pg.name,
      area: pg.area,
      totalBeds: eff.totalBeds,
      vacantBeds: eff.vacantBeds,
      version: 1,
      daysSinceLastBooking,
      pricePerBed: pickPricePerBed(pg),
    };
  });
}