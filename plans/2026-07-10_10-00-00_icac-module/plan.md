# V.I.P.E.R. Supervisor Edition — ICAC Module

## Context
Add an **optional** ICAC (Internet Crimes Against Children) subsystem to Supervisor
Edition for triaging NCMEC **CyberTip** exports. It activates from
Settings → Optional Modules → ICAC Processing. When on, it adds an ICAC nav tab,
a dashboard, a bulk ZIP/PDF import + parsing engine, a local intelligence store,
a repeat-suspect linking engine, an assignment queue, and an export center.

**Hard safety rules (non-negotiable):**
1. **Only the CyberTip NUMBER crosses the LAN.** ICAC content — identifiers,
   contraband references, provider metadata, parsed PDF text — NEVER leaves the
   supervisor machine. The ONLY thing shipped over LAN is an *assignment*:
   `{cybertipNumber, priority?, note?}` addressed to one investigator, plus the
   investigator's *acknowledgment* routed back. The investigator then opens the
   CyberTip inside their OWN ICAC datasystem and downloads its contents there —
   so no PII/contraband transits the wire. (Mirrors the existing OPS-plan
   delivery/decision model, direction reversed: supervisor → investigator.)
2. **Metadata only, never bytes.** The import pipeline reads ZIP entry names,
   sizes, counts, and PDF *text* to extract identifiers. It **never decodes,
   persists, or renders** contraband image/video file bytes. Contraband is
   represented only as `{file_count, file_names, sizes}`.
3. **Storage stays on the supervisor's machine/USB.** The DB lives in a
   user-chosen folder or drive (see Storage), never cloud, never LAN.

## Scope & Non-Goals
**First shippable slice (proposed MVP — Phases 1–4, 100% local, no LAN):**
- Settings toggle (Optional Modules → ICAC Processing) gating the tab + store init.
- Storage-location picker (choose folder / USB drive) for the ICAC database.
- Bulk import: drag ZIP(s) → extract (JSZip) → PDF text (pdf.js) → regex parse →
  build CyberTip records → persist. Import queue with status colors.
- ICAC Dashboard (per reference image, dark throughout): metric tiles + timeline
  chart (Recharts) + suspect identifier heatmap + provider intelligence status +
  repeat-suspect linker + recently-imported tips + top-contraband donut + alerts.
- Repeat-suspect linking: identifier index, match-on-import, "Repeat Suspect"
  alerts, linked-tips modal, view-suspect-profile.

**Phase 5 — Assignment loop (adds LAN, cybertip-number only):**
- "Assign" on a tip → pick investigator from LAN roster → push
  `{cybertipNumber, priority, note}` to that investigator via the node.
- Investigator (VIPER app) gets a dashboard alert → **Acknowledge** → prompted to
  launch a new case in their ICAC module. Acknowledgment routes back to the node.
- Supervisor Edition shows/records assignment status: Sent → Acknowledged (with
  timestamp), visible in the Assignment Queue + an assignment log.
- Requires investigator-side (VIPER Electron) work: a receive+ack handler
  (extend `modules/supervisor-link` or a new `icac-assign` module) and node RPCs.

**Deferred (later phases, explicit):**
- Export center CSV/JSON (Phase 6a), then XLSX + PDF summary (Phase 6b).
- Encryption-at-rest + audit logging + RBAC polish — Phase 7.
- Suspect profile builder as a first-class editable entity — Phase 5+.

**Non-goals:** cloud sync of anything ICAC; rendering/opening contraband media;
LAN transmission of tips; NCMEC/provider API integration; hash-matching against
known-CSAM hash sets (PhotoDNA etc.) — out of scope unless later requested.

## Architecture (fits existing patterns)
```
Settings → Optional Modules toggle  ── localStorage flag: viper.supervisor.icac.enabled
      │
App.tsx NAV + render switch  ── conditional "ICAC" tab (gated by flag)
      │
src/icac/                         (new, self-contained module dir)
  ├── types.ts                    CyberTip, SuspectProfile, Identifiers, Assignment
  ├── storage/
  │    ├── index.ts               IcacStorage interface + capability-based selector
  │    ├── fsaccess.ts            FsAccessStorage (Chromium File System Access API)
  │    └── indexeddb.ts           IndexedDbStorage fallback (+ Electron adapter later)
  ├── import/
  │    ├── ingest.ts              accept ZIP(s) AND loose PDF(s); classify entries
  │    ├── zip.ts                 JSZip: list entries, classify media vs pdf, counts/sizes
  │    ├── pdftext.ts             pdf.js: extract text per PDF (worker via ?url; empty-pw for AES)
  │    └── parse/
  │         ├── index.ts          type detection + dispatch + generic fallbacks
  │         ├── ncmec.ts          NCMEC CyberTipline Report extractor (primary)
  │         └── warrant.ts        warrant / provider (AT&T, Snapchat, Google, Kik)
  ├── linking.ts                  identifier index + match engine → linked_tips + alerts
  ├── Icac.tsx                    dashboard shell (tabs: Dashboard / Import / Linking / [Assign] / [Export])
  ├── ImportZone.tsx             drag-drop + import queue
  ├── TipDetailModal.tsx
  └── LinkModal.tsx
```
- **New deps:** `jszip`, `pdfjs-dist`. (Later: `xlsx`, `pdf-lib` for export;
  optional `idb` wrapper or hand-rolled IndexedDB.)
- **No changes** to `src/lan/*` or the LAN node. Only `App.tsx` (nav+route),
  `Settings.tsx` (toggle), `styles.css` (ICAC styles) are touched in core app.

## Storage (user-chosen location: folder or USB) — adapter-based
Because Supervisor Edition may be packaged as an **Electron** desktop app later,
storage goes behind a small interface so the UI never cares about the backend:
```ts
interface IcacStorage {
  chooseLocation(): Promise<string>;   // label of chosen folder/drive
  currentLocation(): string | null;
  readIndex(): Promise<IcacIndex>;
  writeIndex(ix: IcacIndex): Promise<void>;
  isAvailable(): boolean;
}
```
- **Now (Chromium web):** `FsAccessStorage` — File System Access API
  (`showDirectoryPicker()`, secure context; localhost qualifies). Supervisor picks
  a folder or USB drive; DB written as `icac_index.json`. Directory handle
  persisted in IndexedDB so it reopens next session (re-prompt on permission).
- **Later (Electron):** `ElectronFsStorage` — Node `fs` via IPC to the same
  `icac_index.json`; drop-in, no UI change.
- **Fallback (no FS Access / denied):** `IndexedDbStorage` — working set in db
  `viper-icac` + manual Export/Import to a `.json` file.
- Runtime picks the adapter by capability detection. Settings shows chosen
  location + "Change location". Nothing ICAC-related is cloud- or LAN-bound.

## Design (match reference image, DARK throughout)
Follow the provided reference layout but **remove the white background at the
bottom** — the Recently-Imported / Top-Contraband / Alerts row uses the same dark
`--panel` surfaces as the rest. Reuse existing tokens/components
(`.panel`, `.status-chip`, `.digest-table`, cyan `--cyan`, Recharts). Layout:
- Header: "ICAC Supervisor Dashboard" + unit selector + last-updated.
- Tier 1: 7 metric tiles (New CyberTips, Unassigned, Repeat Suspect Alerts, Tips
  With Contraband, Warrant Follow-Up, Provider Breakdown, Total Imported).
- Tier 2: CyberTip Timeline (Recharts area/line), Suspect Identifier Heatmap,
  Provider Intelligence Status.
- Tier 3: Repeat Suspect Linker, Assignment Queue, Export Center.
- Tier 4: Recently Imported Tips, Top Contraband Categories (donut), Alerts.

## Data Model
CyberTip and SuspectProfile per the blueprint schemas (see §3), stored in IndexedDB.
Identifiers normalized (lowercased email/username, digits-only phone) for matching.
`contraband: { file_count, file_names[], total_bytes }` — no bytes retained.

## PDF Parsing Strategy — CALIBRATED from samples
Samples analyzed (9 PDFs). Two document types present:

**Type 1 — NCMEC CyberTipline Report** (primary; 7 files incl. one AES-encrypted).
Consistent, label-anchored format. `parse/ncmec.ts` extracts:
- Exec summary (page 1): `CyberTipline Report (\d+)` → cybertip_number;
  `Priority Level:\s*(\S+)`; `Total Uploaded Files:\s*(\d+)`;
  `Received by NCMEC on (.+ UTC)` → date_received; `Incident Type:\s*(.+)`.
- Reporting ESP: name follows `Reporting Electronic Service Provider (ESP)` /
  `Submitter:` → provider. `Incident Time:\s*(.+ UTC)`.
- Repeating role blocks delimited by `Suspect` / `Recipient` headers; per block:
  `Name:`, `Mobile Phone:` (+`(Verified)`), `Email Address:`, `Screen/User Name:`,
  `ESP User ID:`, `Profile URL:`, `Date of Birth:`, `Approximate Age:`,
  `IP Address: <ip> (Login|Other)` with the timestamp on the NEXT line,
  `Estimated Location:`. Collect all IPs (IPv4 + IPv6 both appear).
- `Prior CT Reports:\s*([\d,\s]+)` → seed `linked_tips` directly (authoritative
  repeat-suspect linkage — no fuzzy matching needed for these).
- Contraband: `Number of uploaded files:\s*(\d+)`; repeating `Filename:` (+ may
  wrap across lines → re-join until next label), `MD5:`, `Image Categorization by
  ESP:\s*(\w+)` (A1/B1… → contraband category for the donut). MD5s indexed for
  cross-tip matching. **Filenames/hashes/counts only — never file bytes.**

**Type 2 — Warrant / provider package** (`WB_CYBERTIP_DEMO`=AT&T,
`WB_DEMO1234_SNAP`=Snapchat). `parse/warrant.ts`: `AGENCY CASE NUMBER:\s*(\S+)`,
provider from header/body keywords (AT&T/Snapchat/Google/Kik), target-account and
requested-records fields. Lower priority than Type 1.

**Detection:** presence of `CyberTipline Report \d+` → NCMEC; else
`SEARCH WARRANT`/`AGENCY CASE NUMBER` → warrant; else generic fallback.
**Generic fallbacks** (any type): email, IPv4/IPv6, E.164 phone, IMEI/MAC/GAID/IDFA.
**AES-encrypted PDFs:** pdf.js opens with empty password in-browser (handled).
**Human-in-the-loop:** every parsed field editable in `TipDetailModal.tsx` with a
per-tip parse-confidence flag. Parser structured one module per type/provider so
future layouts are isolated additions.

## Implementation Plan (phase order)
**First build = Phases 1–4 (local MVP). Assignment + Export panels are rendered in
the dashboard but show a "wired in Phase 5/6" disabled state.**
1. **Phase 1 — Activation + storage**: `icac/types.ts`, `storage/*` (adapter +
   FsAccess + IndexedDB fallback), Settings "Optional Modules" panel + ICAC toggle +
   storage-location picker, App.tsx gated nav tab + route, `Icac.tsx` shell.
2. **Phase 2 — Import engine**: `zip.ts` + `pdftext.ts` + `parse.ts` (generic
   extractors first), `ImportZone.tsx` drag-drop + queue + status colors
   (blue/cyan/green/amber/red), persist to storage. Calibrate provider regex when
   sample PDFs arrive.
3. **Phase 3 — Dashboard UI** (dark, per reference): metric tiles, Recharts
   timeline, identifier heatmap, provider intelligence, recently-imported table +
   `TipDetailModal.tsx` (editable fields), top-contraband donut, alerts panel.
4. **Phase 4 — Linking engine**: `linking.ts`, match-on-import, repeat-suspect
   alerts, `LinkModal.tsx`, suspect profile view.
5. **Phase 5 — Assignment loop (LAN, cybertip-number only)**: node RPCs +
   supervisor push + VIPER investigator receive/acknowledge + ack routed back +
   assignment log.
6. **Phase 6 — Export center** (CSV/JSON → XLSX/PDF).
7. **Phase 7 — Encryption / audit / RBAC**.

## Verification
- Toggle off → no ICAC tab, no store init. Toggle on → tab appears, DB created.
- Import a sample ZIP → queue advances through statuses → records land in store →
  dashboard metrics + table populate; contraband shown as count only.
- Re-import a ZIP sharing an identifier → repeat-suspect alert + link appears.
- `npx tsc -b` clean + `npx vite build` succeeds; verify pdf.js worker loads in dev.
- Confirm (grep) ICAC code path issues **zero** `lanClient` calls.
