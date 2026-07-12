// V.I.P.E.R. Supervisor Edition — ICAC module data contracts
//
// These shapes are the ICAC intelligence store. They stay 100% LOCAL to the
// supervisor machine (folder/USB). The ONLY field that ever crosses the LAN is
// `cybertip_number` (inside an assignment) — never identifiers, contraband, or
// parsed PDF content. See plan.md safety rules.
//
// Field map is calibrated against real NCMEC CyberTipline Reports + provider
// warrant packages (see src/icac/parse/*).
// ---------------------------------------------------------------------------

/** Known reporting providers / ESPs we detect. `other` = anything else. */
export type Provider =
  | "Facebook"
  | "Instagram"
  | "WhatsApp"
  | "Google"
  | "Snapchat"
  | "Kik"
  | "X"
  | "AT&T"
  | "Discord"
  | "Microsoft"
  | "Dropbox"
  | "TikTok"
  | "Roblox"
  | "Other";

/** How confident the parser is in the extracted record. */
export type ParseConfidence = "high" | "medium" | "low";

/** Document type the parser recognized. */
export type SourceDocType = "ncmec" | "warrant" | "unknown";

/** A single observed IP address with its context + timestamp. */
export interface IpObservation {
  ip: string;
  /** e.g. "Login" | "Other" | "Registration" (from the "(…)" annotation). */
  kind?: string;
  /** ISO-ish timestamp string exactly as seen (usually UTC). */
  seenAt?: string;
}

/** Device identifiers, grouped by type (per blueprint schema §3.1). */
export interface DeviceIds {
  imei: string[];
  mac: string[];
  gaid: string[];
  idfa: string[];
  /** Any device id we could not classify. */
  other: string[];
}

/** All identifiers extracted from a report (deduped, normalized). */
export interface Identifiers {
  ip_addresses: string[];
  emails: string[];
  usernames: string[];
  phone_numbers: string[];
  esp_user_ids: string[];
  device_ids: DeviceIds;
}

/** Contraband is represented by METADATA ONLY — never file bytes. */
export interface Contraband {
  file_count: number;
  file_names: string[];
  /** MD5 (and other) hashes — used for cross-tip matching, not for content. */
  md5: string[];
  /** ESP categorization codes, e.g. "A1", "B1" (NCMEC/industry buckets). */
  categories: string[];
  /** Total bytes across media entries in a ZIP, when available. */
  total_bytes?: number;
}

/** One person block in a report (Suspect or Recipient). */
export interface PartyBlock {
  role: "suspect" | "recipient" | "unknown";
  name?: string;
  emails: string[];
  usernames: string[];
  phones: string[];
  esp_user_ids: string[];
  profile_urls: string[];
  ips: IpObservation[];
  date_of_birth?: string;
  approximate_age?: string;
  estimated_location?: string;
}

/** Assignment state — only the cybertip number is LAN-transmittable. */
export interface Assignment {
  assigned_to: string | null; // investigator display name
  assigned_to_device_id?: string | null;
  priority: "High" | "Medium" | "Low" | null;
  note: string | null;
  status?: "unassigned" | "sent" | "acknowledged";
  sentAt?: string;
  acknowledgedAt?: string;
}

/** Supervisor close-out reasons for a CyberTip that won't be investigated. */
export type CloseReason =
  | "Not CSAM"
  | "Not a crime"
  | "Unfounded"
  | "Duplicate"
  | "Insufficient info"
  | "Other";

/**
 * Disposition = a supervisor's decision to close (or reopen) a tip. Closed tips
 * stay in the local store + exports but are hidden from active dashboard views.
 * Never LAN-transmitted.
 */
export interface Disposition {
  state: "open" | "closed";
  reason?: CloseReason;
  note?: string;
  closedBy?: string;
  closedAt?: string;
}

/** A parsed CyberTip record — the core ICAC store entity. */
export interface CyberTip {
  /** Stable local id (uuid-ish). Distinct from cybertip_number. */
  id: string;
  cybertip_number: string;
  date_received: string;
  provider: Provider;
  priority_level?: string;
  incident_type?: string;
  incident_time?: string;

  identifiers: Identifiers;
  contraband: Contraband;
  parties: PartyBlock[];

  /** Related cybertip numbers declared by NCMEC ("Prior CT Reports"). */
  prior_reports: string[];
  /** Local tip ids linked by the matching engine (Phase 4). */
  linked_tips: string[];

  assignment: Assignment;

  /** Supervisor close-out state. Absent/undefined ⇒ open. */
  disposition?: Disposition;

  // Provenance / QA
  source_file: string;
  source_doc_type: SourceDocType;
  parse_confidence: ParseConfidence;
  /** Fields the parser could not populate — surfaced in the detail modal. */
  missing_fields: string[];
  imported_at: string;
  /** Raw provider-specific extras (warrant agency case #, etc.). */
  provider_specific?: Record<string, unknown>;
}

/** A repeat-suspect profile aggregated across tips (Phase 4). */
export interface SuspectProfile {
  suspect_id: string;
  label?: string;
  identifiers: Identifiers;
  linked_tips: string[];
  notes: string;
}

/** The on-disk index document (icac_index.json). */
export interface IcacIndex {
  version: 1;
  updated_at: string;
  tips: CyberTip[];
  suspects: SuspectProfile[];
}

/**
 * Encrypted-at-rest wrapper (Phase 7). When the vault is enabled, the storage
 * backend holds this envelope INSTEAD of a plaintext IcacIndex. The ciphertext
 * is AES-256-GCM (ct||tag) over JSON.stringify(IcacIndex); the KDF salt/iters
 * live in the local vault config, never here. Never LAN-transmitted.
 */
export interface VaultEnvelope {
  kind: "viper.icac.vault";
  v: 1;
  cipher: "AES-256-GCM";
  iv: string; // hex, 12 bytes
  ct: string; // hex, ciphertext||tag
  updated_at: string;
}

/** What a storage backend actually persists: plaintext index OR encrypted envelope. */
export type StoredDoc = IcacIndex | VaultEnvelope;

export function isVaultEnvelope(doc: unknown): doc is VaultEnvelope {
  return !!doc && typeof doc === "object" && (doc as any).kind === "viper.icac.vault";
}

export function emptyIdentifiers(): Identifiers {
  return {
    ip_addresses: [],
    emails: [],
    usernames: [],
    phone_numbers: [],
    esp_user_ids: [],
    device_ids: { imei: [], mac: [], gaid: [], idfa: [], other: [] },
  };
}

export function emptyContraband(): Contraband {
  return { file_count: 0, file_names: [], md5: [], categories: [] };
}

export function emptyIndex(): IcacIndex {
  return { version: 1, updated_at: new Date().toISOString(), tips: [], suspects: [] };
}

/** True when a supervisor has closed this tip (hidden from active views). */
export function isClosed(t: CyberTip): boolean {
  return t.disposition?.state === "closed";
}
