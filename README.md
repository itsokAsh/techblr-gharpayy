# Gharpayy — CRM Ops Command Center

> A production-grade CRM operations platform built for **Gharpayy's PG rental business** — helping Tour Captains (TCMs) manage leads, schedule tours, and close bookings without anything slipping through the cracks.

---

## What This App Does

Imagine you run a PG rental company. Every day, dozens of people message on WhatsApp asking about rooms. Your team of Tour Captains needs to:

1. **Capture those leads** without losing or duplicating them
2. **Schedule property tours** and make sure beds are actually available
3. **Follow up after every tour** — did they book or are they still deciding?
4. **Handle no-shows** — the person didn't turn up, now what?
5. **Know exactly what to do next** — not just a list, but *the* most important action right now

This app solves all five problems and wires them together into one daily command center.

---

## ✨ Features Built

### 🟢 Feature 1 — Lead Intake (WhatsApp Paste → CRM)

**The problem:** Tour Captains receive leads on WhatsApp as messy text — names, phone numbers, budgets, move-in dates scattered across messages. Manually typing them into a CRM is slow and error-prone.

**The solution:** Paste the raw WhatsApp message, and the system automatically:
- **Parses** the text to extract name, phone, budget, location, and move-in date
- **Detects duplicates** by hashing the phone number (so the same person isn't added twice)
- **Auto-assigns** a Tour Captain based on workload and area expertise
- **Syncs into the CRM** instantly — ready to act on

> 💡 *Phone numbers are never stored or logged in plain text — only a secure hash is kept for dedup.*

---

### 🟢 Feature 2 — Tour Lifecycle + Post-Tour SLA

**The problem:** After a property tour is completed, Tour Captains sometimes forget to fill in what happened — did the person book? Are they still deciding? This delay kills conversion.

**The solution:** A strict **1-hour SLA clock** starts the moment a tour is marked as completed:
- Within 1 hour → **fill the outcome** (Booked / Still Deciding / Not Interested)
- After 1 hour → the item turns **red** and jumps to the top of the queue
- After 6 hours → **auto-escalation** to Flow Ops managers

The system tracks every tour's full lifecycle: Scheduled → Completed → Outcome Filled → Follow-up Set.

---

### 🟢 Feature 3 — Do-Next / Today Queue

**The problem:** Tour Captains have 15–30 leads at different stages. They waste time figuring out *"who do I call next?"*

**The solution:** A smart **"Today" command center** that shows exactly one ranked action per lead:
- Post-tour forms due → **#1 priority**
- No-show rescue calls → **#2 priority**
- Vacancy checks needed → **#3 priority**
- Overdue follow-ups → **#4 priority**
- New leads awaiting first call → **#5 priority**

Each item has a **clear CTA button** ("Fill Form", "Call Now", "Confirm Vacancy", "Reschedule") — no guesswork.

**Filter chips** let you slice the queue: All · Urgent · Tours · Follow-ups · No-shows · New

---

### 🔵 Feature 4 — No-Show Rescue *(Original Idea)*

**The problem:** A lead was scheduled for a property tour but didn't show up. Without follow-up, that lead is lost forever.

**The solution:** When a tour is marked as a **no-show**:
1. A **rescue call** follow-up is auto-created → due in **30 minutes**
2. A **rebook offer** follow-up is auto-created → due in **24 hours**
3. Both items surface in the **Today Queue** with high urgency
4. A **background queue worker** independently tracks these jobs on the server — even if the Tour Captain closes their browser, the jobs persist and execute on schedule
5. If execution fails, the worker **retries with exponential backoff** (2 min → 4 min → 8 min) up to 3 attempts

> 💡 *The lead is tagged as "no-show" and their stage is adjusted — nothing falls through the cracks.*

---

### 🔵 Feature 5 — Pre-Tour Vacancy Check *(Original Idea)*

**The problem:** A tour is scheduled at a PG, but by the time the lead arrives, all beds might be taken. This wastes everyone's time and damages trust.

**The solution:** A smart **vacancy check system** with urgency tiers:

| Time Until Tour | Urgency | Action Required |
|---|---|---|
| **≤ 3 hours** | 🔴 **Critical** | TCM *must* confirm vacancy before the tour |
| **> 3 hours** | 🟡 **Optional** | TCM *can* check early, but it's not mandatory yet |

The Tour Captain can:
- ✅ **Confirm** — "All good, beds available" (locks the vacancy with version control)
- ⚠️ **Report Problem** — "No beds / owner issue / wrong property" (triggers rematch)
- 🔄 **Rematch** — system suggests alternative PGs with availability

> 💡 *If two TCMs try to book the last bed at the same time, the system detects the conflict and blocks the second booking — no double-booking ever.*

---

## 🔧 Backend Engineering

These aren't just UI features — each one is backed by real server-side engineering:

### 🗄️ Caching

- **KV-shaped cache** (in-memory for dev, designed for Cloudflare KV / Redis in production)
- Cache key format: `queue:tcm:{id}:v{version}`
- **20-second TTL** — Today Queue responses are cached and served instantly
- **Smart invalidation** — any mutation (new lead, tour update, no-show) bumps the version, guaranteeing fresh data on next read

### 🔐 Security

- **Rate limiting** on lead intake — 20 pastes per TCM per minute, 40 per IP per minute
- **Phone hashing** — SHA-256 of E.164 number for dedup; raw phone is never stored or logged
- **Role-based access guards**:
  - TCMs can only view and edit their own tours and leads
  - Flow Ops / Admins can view everything
  - Only TCM, Flow Ops, and Admin roles can ingest leads

### ⏱️ Time & SLA Correctness

- All time-sensitive calculations (urgency tiers, SLA clocks, countdown timers) use **server-side `Date.now()`** — never the browser clock
- Every mutation response includes `serverNow` and `X-Server-Now` header so the frontend stays in sync

### 🔁 Idempotency

- Every write operation accepts an `Idempotency-Key` header
- If the same request is sent twice (double-tap, network retry), the server **replays the original response** instead of duplicating the action
- Covers: lead intake, no-show, pre-tour check, and vacancy updates
- Response includes `X-Idempotent-Replay: true` header when replaying

### 🔒 Vacancy Lock Service (Optimistic Concurrency)

- Every property tracks `vacantBeds` and a `version` number
- When confirming a tour, the TCM sends `expectedVersion` — if it doesn't match the server's current version, the request is **rejected with a 409 Conflict**
- Error message: *"Beds changed (v13). Refresh and rematch if needed."*
- If `vacantBeds = 0`, tour confirmation is blocked: *"Cannot confirm — bed not available. Rematch PG."*
- This prevents **double-booking** when multiple TCMs act on the same property simultaneously

### ⚙️ Background Queue Worker

- When a tour is marked as a no-show, two **background jobs** are enqueued on the server:
  - `no-show-call` → fires after **30 minutes**
  - `no-show-reschedule` → fires after **24 hours**
- A **worker engine** runs server-side, independent of the browser:
  - Picks up jobs when `runAt ≤ now`
  - Executes the action (tag lead, generate alert)
  - On failure → **retries with exponential backoff** (2^attempts minutes)
  - After 3 failed attempts → marks job as `failed`
- **Observable via API** (`GET /api/ops/jobs`) and a live **Worker Status Badge** on the Today page
- Manual **"Run Worker"** button available for testing and demos

---

## 🗂️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React + Vite + SSR) |
| Routing | TanStack Router (file-based) |
| State | Zustand |
| Server | Cloudflare Workers / Nitro |
| Cache | In-memory KV (Cloudflare KV-ready) |
| UI Components | Radix UI + shadcn/ui |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |

---

## 🚀 Getting Started

```sh
git clone <this-repository-url>
cd techblr-gharpayy
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.

---

## 📁 Project Structure (Key Files)

```
src/
├── server/ops/           # Backend ops layer
│   ├── ingest.ts         # Lead intake (WhatsApp paste → CRM)
│   ├── tour-actions.ts   # No-show + pre-tour check handlers
│   ├── vacancy.ts        # Vacancy lock (optimistic concurrency)
│   ├── worker.ts         # Background queue worker engine
│   ├── cache.ts          # KV cache layer
│   ├── rate-limit.ts     # Sliding-window rate limiter
│   ├── phone.ts          # Phone hashing (SHA-256)
│   ├── auth.ts           # Role guards
│   ├── idempotency.ts    # Idempotency key store
│   └── store.ts          # In-memory ops data store
├── routes/api/ops/       # REST API endpoints
│   ├── leads.ingest.ts   # POST /api/ops/leads/ingest
│   ├── today.queue.ts    # GET  /api/ops/today/queue
│   ├── tours.$tourId.no-show.ts
│   ├── tours.$tourId.pre-check.ts
│   ├── properties.$propertyId.vacancy.ts
│   └── jobs.ts           # GET/POST /api/ops/jobs (worker)
├── lib/
│   ├── engine.ts         # SLA rules, queue ranking, vacancy forecaster
│   ├── ops-api.ts        # Client-side API wrappers
│   └── lead-identity/    # WhatsApp parser + phone normalizer
├── routes/today.tsx      # Today Queue page (command center)
└── components/
    └── PreTourCheckDialog.tsx  # Vacancy check UI
```
