import type { SavedRun } from "../types";
import { validateSavedRun } from "./exports";
const KEY = "claimlens.runs.v1";
export function getSavedRuns(): SavedRun[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const runs: SavedRun[] = [];
    const seen = new Set<string>();
    for (const record of raw.slice(0, 12)) {
      try {
        const run = validateSavedRun(record);
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        runs.push(run);
      } catch {
        /* One corrupt snapshot must not prevent access to healthy snapshots. */
      }
    }
    return runs;
  } catch {
    return [];
  }
}
export function putSavedRuns(runs: SavedRun[]) {
  const safe = runs.slice(0, 12).map(validateSavedRun);
  // Let quota or disabled-storage errors reach the UI's download-backup fallback.
  // Validation completes before writing, preserving the existing snapshots on failure.
  localStorage.setItem(KEY, JSON.stringify(safe));
}
