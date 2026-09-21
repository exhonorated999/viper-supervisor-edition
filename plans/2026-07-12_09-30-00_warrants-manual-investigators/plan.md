# Plan — Wilson Warrants + Manual (Off-System) Investigators

## Context
Two supervisor-workflow gaps in the ICAC module of V.I.P.E.R. Supervisor Edition:

1. **Wilson warrant tracking.** Before any CyberTip may be opened/reviewed, a supervisor
   must obtain a judge-signed "Wilson warrant." These are authored in **bulk** (one warrant
   lists many downloaded CyberTips). In court, warrants routinely get lost or can't be matched
   to the right tips due to volume. We need a durable, retrievable link between a warrant
   (number + signed PDF) and the exact CyberTips it authorizes.

2. **Manual / off-system investigators.** Today the assignment roster is *only* live
   LAN-connected Project VIPER investigators (`get:investigators`). Supervisors whose officers
   don't run Project VIPER can't use the system at all. We need to let a supervisor manually
   add investigator names and assign CyberTips to them locally (degraded feature set: no LAN
   push, no automatic acknowledgement).

Everything stays **100% local**. No new data crosses the LAN. Manual assignments never touch
the wire.

## Decisions (resolved)
- **Warrant attach timing:** BOTH — at batch import AND retroactively to already-imported tips.
- **Manual investigators can be assigned:** ICAC CyberTips **and** a lightweight manual "case"
  record the supervisor creates/tracks.
- **Manual assignment tracking:** none — just mark **"Assigned (off-system)"**. No status
  workflow, no ack loop.

## Scope & Non-Goals
**In scope (v1):**
- A `Warrant` entity (number, court/judge, dates, optional signed PDF) that covers 1..N tips.
- Attach a warrant to a batch **at import** and to **already-imported tips** (retroactively).
- Warrant badge on tips (queue + detail modal); a **Warrants** sub-view; a court-ready
  **coverage report** export (warrant → CT# list + signed-PDF filename).
- Local **manual investigator** roster (add/edit/remove), managed in the top-level
  **Investigators** view; merged into the ICAC `AssignDialog` picker.
- Assigning a CyberTip to a manual investigator = local-only update, **no LAN push**, labeled
  "Assigned (off-system)".
- Lightweight **manual case** records (create/list/delete) assignable to a manual investigator,
  surfaced in the top-level **Cases** view as an "Off-System" section.

**Non-goals (deferred):** encrypting the stored signed-PDF blob (prototype caveat, matches
existing unencrypted-key caveats); OCR/verification of warrant PDFs; generating the warrant
document itself; syncing manual investigators/cases over LAN; any status/lifecycle tracking for
manual assignments; mirroring manual cases into the LAN-derived case analytics.

## Store placement (key design)
- **Warrants** are ICAC-specific → live in the **IcacIndex** (`warrants: Warrant[]`); signed-PDF
  bytes in the `idb.ts` KV blob store (survives node restarts; index-independent of vault size).
- **Manual investigators + manual cases** are general and must work even when the ICAC module is
  off and the LAN is down → live in a **new general localStorage store**
  `src/data/offsystem.ts` (mirrors `data/prefs.ts` / `data/identity.ts`: get/set + a
  `onOffSystemChange` subscription). This avoids coupling to `isIcacEnabled()`.

## Implementation Plan

### A. Wilson Warrants
- **types.ts**: add `Warrant { id, warrant_number, court?, judge?, issued_at?, signed_at?,
  agency_case?, signed_pdf_name?, signed_pdf_key?, covered_tip_ids: string[], note?,
  authoredBy?, createdAt }`; add `warrant_id?: string` to `CyberTip` (a tip is covered by one
  warrant; a warrant covers many tips). Add `warrants: Warrant[]` to `IcacIndex`; update
  `emptyIndex()` + `materialize()` fallback so older indexes without `warrants` load cleanly.
- **Signed-PDF storage**: reuse `src/icac/storage/idb.ts` KV, keyed `warrant-pdf:<id>`
  (store `{ name, type, bytes: ArrayBuffer }`). PDF blob itself unencrypted (documented caveat).
- **service.ts**: `getWarrants()`, `createWarrant(data, tipIds)`, `attachWarrant(tipIds,
  warrantId)`, `detachWarrant(tipIds)`, `updateWarrant()`, `deleteWarrant()`,
  `saveWarrantPdf(id, File)` / `loadWarrantPdf(id): Blob|null`; preserve `warrant_id` on
  re-import (same pattern as `disposition`). Audit actions `warrant.create/attach/update/delete`
  (add to `audit.ts` union + `AUDIT_LABELS`).
- **ImportDialog.tsx**: optional collapsible "Wilson warrant" section (number + optional PDF
  picker) applied to the whole batch after parse → `createWarrant()` + `attachWarrant(newTipIds)`.
- **Retroactive attach** (`Icac.tsx`): reuse the Assignment-Queue multi-select to add an
  "Attach warrant…" toolbar action opening a new **`WarrantDialog.tsx`** (pick existing warrant
  or create new, optional PDF).
- **Surfacing**: warrant chip in queue rows + `TipDetailModal.tsx` ("Wilson Warrant #…" +
  "View signed PDF" → `URL.createObjectURL(loadWarrantPdf())` in a new tab). New **Warrants**
  sub-view (tab within the ICAC screen) listing each warrant, its covered CT#s, signed-PDF link,
  and an **Export coverage report** (CSV now; one-page PDF reusing the existing export path).

### B. Manual / Off-System Investigators + Cases
- **`src/data/offsystem.ts`** (new): types `ManualInvestigator { id, name, badge?, unit?,
  email?, createdAt }` and `ManualCase { id, case_number, title, assignee_id?, assignee_name?,
  note?, createdAt }`; localStorage keys under the existing `viper.supervisor.*` prefix; CRUD +
  `onOffSystemChange(cb)` subscription.
- **Investigators view** (`src/Investigators.tsx`): add an "Off-System Investigators" section
  (list + add/edit/remove) above/below the LAN workload grid; small `ManualInvestigatorDialog`.
- **ICAC `assign.ts` / `AssignDialog.tsx`**: picker merges live LAN roster (`get:investigators`)
  + manual roster, visually grouped ("● Online (Project VIPER)" vs "Manual / Off-System").
  Selecting a manual entry → `assignCyberTip` branch that sets `tip.assignment = { assigned_to:
  name, mode: "manual", status: "offsystem", sentAt }` and **skips** `lanClient.request`. Add
  `mode?: "lan" | "manual"` and an `"offsystem"` status value to `Assignment` in types.ts.
  Online path (real VIPER investigator) unchanged.
- **Queue display** (`Icac.tsx` / `derive.ts`): manual assignments render an "Off-system" tag
  instead of sent/acknowledged; no ack expected.
- **Cases view** (`src/Cases.tsx`): add an "Off-System Cases" section — create/list/delete
  `ManualCase`, each optionally assigned to a manual investigator. Lightweight; no status.

## Verification
- `tsc` clean (strict `noUnusedLocals`/`noUnusedParameters`); `npm run build`.
- Import a batch with a warrant number + a sample signed PDF (use a project `*.pdf`) → tips show
  the warrant chip; open the PDF from the detail modal; coverage report lists every CT#.
- Retroactively attach a warrant to a multi-selected set → chips appear; report updates.
- With LAN offline: add a manual investigator, assign a tip → shows "Assigned (off-system)",
  and the LAN node audit log records **nothing** (confirm no push).
- Create a manual case, assign to the manual investigator → appears in Cases → Off-System.
- Online path (real VIPER investigator) still pushes + acks unchanged.
- Repackage NSIS installer; confirm warrants (ICAC index + idb blob) and manual roster/cases
  (localStorage) persist across relaunch — none of this lives in node memory.
