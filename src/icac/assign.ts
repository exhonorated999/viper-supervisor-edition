// ICAC assignment adapter — the ONLY ICAC file that touches the LAN.
//
// Everything else in src/icac/* stays 100% local (store, parse, derive). This
// thin seam pushes an *assignment* to an investigator and folds the returned
// acknowledgement back into the local tip record. Per the hard safety rule,
// the ONLY case data that crosses the wire is the CyberTip NUMBER (plus an
// optional priority/note) — never identifiers, contraband, or parsed content.
// ---------------------------------------------------------------------------

import { lanClient } from "../lan/client";
import { getTips, updateTip } from "./service";
import type { Assignment, CyberTip } from "./types";

export interface OnlineInvestigator {
  deviceId: string;
  name: string;
  badge: string;
  unit?: string;
}

/** Live roster of investigators currently connected to the LAN node. */
export async function getOnlineInvestigators(): Promise<OnlineInvestigator[]> {
  try {
    return await lanClient.request<OnlineInvestigator[]>("get:investigators");
  } catch {
    return [];
  }
}

export interface AssignInput {
  investigator: OnlineInvestigator;
  priority: Assignment["priority"];
  note: string;
}

/**
 * Assign a CyberTip to an investigator. Updates the local tip optimistically,
 * then pushes ONLY the cybertip number over the LAN. Throws if the LAN push
 * fails so the UI can surface it (and the local record is reverted).
 */
export async function assignCyberTip(tip: CyberTip, input: AssignInput): Promise<void> {
  const prev = tip.assignment;
  const next: Assignment = {
    assigned_to: input.investigator.name,
    assigned_to_device_id: input.investigator.deviceId,
    priority: input.priority,
    note: input.note || null,
    status: "sent",
    sentAt: new Date().toISOString(),
    acknowledgedAt: undefined,
  };
  tip.assignment = next;
  await updateTip(tip);

  try {
    await lanClient.request("action:icac:assign", {
      to: input.investigator.deviceId,
      cybertipNumber: tip.cybertip_number,
      priority: input.priority,
      note: input.note || "",
    });
  } catch (e) {
    // Roll the local record back so the queue reflects reality.
    tip.assignment = prev;
    await updateTip(tip);
    throw e;
  }
}

// --- ack routing -----------------------------------------------------------
// Fold an investigator's acknowledgement into the matching local tip. The node
// routes an "icac:assign:ack" event carrying only the cybertip number, the
// acknowledging investigator, and (optionally) the case number they opened.
let wired = false;

export function wireAssignmentEvents(): () => void {
  if (wired) return () => {};
  wired = true;
  const off = lanClient.onEvent((e) => {
    if (e.kind !== "icac:assign:ack") return;
    const p = e.payload || {};
    const tip = getTips().find((t) => t.cybertip_number === p.cybertipNumber);
    if (!tip) return;
    const note = p.caseNumber
      ? `Opened case ${p.caseNumber}`
      : tip.assignment?.note || null;
    tip.assignment = {
      ...tip.assignment,
      assigned_to: tip.assignment?.assigned_to || p.by || null,
      status: "acknowledged",
      acknowledgedAt: p.at || new Date().toISOString(),
      note,
    };
    void updateTip(tip);
  });
  return () => { wired = false; off(); };
}
