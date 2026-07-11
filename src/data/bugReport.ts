// ---------------------------------------------------------------------------
// Bug report submission to the Intellect Unified Dashboard.
//
// POST /api/bug-reports with an X-API-Key header (from registration). If the
// key is missing/stale we self-heal by silently re-registering once, mirroring
// Project V.I.P.E.R.'s submitBugReport. No content ever leaves beyond what the
// user types here.
// ---------------------------------------------------------------------------

import {
  API_BASE,
  PRODUCT_SLUG,
  getApiKey,
  getRegistration,
  refreshApiKey,
  appVersion,
} from "./registration";

const BUG_REPORT_API = `${API_BASE}/api/bug-reports`;

export type BugSeverity = "low" | "medium" | "high" | "critical";

export interface BugReportInput {
  title: string;
  description: string;
  severity: BugSeverity;
  steps?: string;
}

function looksLikeBadKey(status: number, msg: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    /invalid or inactive api key|missing api key/i.test(String(msg))
  );
}

/** Submit a bug report; returns the server-assigned bug id. */
export async function submitBugReport(input: BugReportInput): Promise<string> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || !description) throw new Error("Title and description are required.");

  let apiKey = getApiKey();
  if (!apiKey) {
    // Not registered / no key — try to mint one from stored details.
    apiKey = await refreshApiKey();
  }

  const payload = JSON.stringify({
    title,
    description,
    steps_to_reproduce: (input.steps || "").trim(),
    severity: input.severity,
    product_slug: PRODUCT_SLUG,
    reporter_name: getRegistration().name || "Unknown",
    app_version: await appVersion(),
  });

  const post = async (key: string) => {
    const resp = await fetch(BUG_REPORT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: payload,
    });
    if (resp.ok) return { ok: true as const, data: await resp.json().catch(() => ({} as any)) };
    const err = await resp.json().catch(() => ({} as any));
    const errMsg = err.detail || `Server error (${resp.status})`;
    return { ok: false as const, status: resp.status, errMsg: String(errMsg) };
  };

  let res = await post(apiKey);
  // Stale key → refresh once and retry.
  if (!res.ok && looksLikeBadKey(res.status, res.errMsg)) {
    const fresh = await refreshApiKey();
    res = await post(fresh);
  }
  if (!res.ok) throw new Error(res.errMsg);
  return String(res.data?.bug_id ?? "");
}
