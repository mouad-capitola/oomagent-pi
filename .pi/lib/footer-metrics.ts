import type { SessionEntry } from "@earendil-works/pi-coding-agent";

// Provider usage across the entire session, including abandoned/compacted history.
// Input already includes instructions, tool declarations and repeated context.
export function sessionTokenUsage(entries: readonly SessionEntry[]): { total: number; incomplete: boolean } {
  let total = 0;
  let incomplete = false;
  for (const entry of entries) {
    let usage;
    if (entry.type === "message") {
      if (entry.message.role !== "assistant" && entry.message.role !== "toolResult") continue;
      usage = entry.message.usage;
      if (!usage && entry.message.role === "toolResult") continue;
    } else if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
      if (!usage && entry.type !== "usage") continue;
    } else continue;
    for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      const value = usage?.[field];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) total += value;
      else incomplete = true;
    }
  }
  return { total, incomplete };
}
