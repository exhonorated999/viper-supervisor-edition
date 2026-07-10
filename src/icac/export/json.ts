// JSON builder — a self-describing export document. Includes a provenance
// header so a re-import (or another agency's tool) knows what it is.
// ---------------------------------------------------------------------------

import type { CyberTip } from "../types";
import type { ExportScope } from "./rows";

export interface ExportMeta {
  unit: string;
  scope: ExportScope;
}

export function buildJson(tips: CyberTip[], meta: ExportMeta): string {
  const doc = {
    kind: "viper.icac.export",
    version: 1 as const,
    generated_at: new Date().toISOString(),
    unit: meta.unit,
    scope: meta.scope,
    tip_count: tips.length,
    notice:
      "LOCAL EXPORT — not for LAN transmission. Contains investigative " +
      "identifiers; no contraband media is included (metadata only). Handle " +
      "per agency evidence policy.",
    tips,
  };
  return JSON.stringify(doc, null, 2);
}
