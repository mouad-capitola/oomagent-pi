import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Quota = { fiveHour?: number; weekly?: number };
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const isCodex = (provider?: string) => /^openai-codex(?:-\d+)?$/.test(provider ?? "");
const percentage = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function parseQuota(data: unknown, now = Date.now()): Quota {
  const rate = (data as any)?.rate_limit;
  const result: Quota = {};
  for (const window of [rate?.primary_window, rate?.secondary_window]) {
    if (!percentage(window?.used_percent) || typeof window?.limit_window_seconds !== "number") continue;
    if (window.reset_at !== undefined && (typeof window.reset_at !== "number" || !Number.isFinite(window.reset_at) || window.reset_at * 1000 <= now)) continue;
    if (Math.abs(window.limit_window_seconds - 18000) <= 120) result.fiveHour = window.used_percent;
    if (Math.abs(window.limit_window_seconds - 604800) <= 120) result.weekly = window.used_percent;
  }
  return result;
}

export function formatQuota(quota?: Quota): string {
  const fmt = (value?: number) => percentage(value) ? `${Math.round(value)}%` : "?%";
  return `ChatGPT week ${fmt(quota?.weekly)}`;
}

export function formatContext(ctx: Pick<ExtensionContext, "getContextUsage" | "model">): string {
  const usage = ctx.getContextUsage?.();
  const capacity = usage?.contextWindow ?? ctx.model?.contextWindow;
  const size = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0
    ? capacity >= 1000 ? `${Number((capacity / 1000).toFixed(1))}k` : String(capacity)
    : "?";
  const percent = typeof usage?.percent === "number" && Number.isFinite(usage.percent)
    ? `${Math.min(100, Math.max(0, usage.percent)).toFixed(1)}%` : "?%";
  return `CTX ${percent} / ${size}`;
}

// Only Pi's active Codex credential goes to the fixed ChatGPT origin; no auth-file reads,
// configurable destinations, redirects, retries, raw error logging or persisted tokens.
export async function fetchQuota(ctx: ExtensionContext, signal: AbortSignal): Promise<Quota | undefined> {
  const model = ctx.model;
  if (!model || !isCodex(model.provider)) return;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (signal.aborted || !auth.ok || !auth.apiKey) return;
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.apiKey}`, Accept: "application/json" };
  try {
    const claim = JSON.parse(Buffer.from(auth.apiKey.split(".")[1], "base64url").toString("utf8"))["https://api.openai.com/auth"];
    if (typeof claim?.chatgpt_account_id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(claim.chatgpt_account_id)) {
      headers["chatgpt-account-id"] = claim.chatgpt_account_id;
    }
  } catch { /* Some credentials have no readable JWT metadata. */ }
  const response = await fetch(USAGE_URL, {
    headers, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); return; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) return;
      chunks.push(value);
    }
    return parseQuota(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally { await reader.cancel(); }
}

export function createQuotaMonitor(redraw: () => void, load = fetchQuota, now = Date.now) {
  let context: ExtensionContext | undefined;
  let quota: Quota | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let request: AbortController | undefined;
  let lastAttempt = -Infinity;
  let fetchedAt = -Infinity;
  const stop = () => {
    context = undefined;
    request?.abort(); request = undefined;
    if (timer) clearInterval(timer);
    timer = undefined;
    quota = undefined;
    lastAttempt = fetchedAt = -Infinity;
  };
  const refresh = async () => {
    if (!context || request || now() - lastAttempt < 60000) return;
    lastAttempt = now();
    const controller = new AbortController();
    request = controller;
    try {
      const result = await load(context, controller.signal);
      if (request === controller) { quota = result; fetchedAt = now(); }
    } catch {
      if (request === controller) quota = undefined;
    } finally {
      if (request === controller) { request = undefined; redraw(); }
    }
  };
  return {
    stop, refresh,
    snapshot: () => now() - fetchedAt < 120000 ? quota : undefined,
    start(ctx: ExtensionContext) {
      stop();
      if (ctx.mode !== "tui" || !ctx.hasUI || !isCodex(ctx.model?.provider) || !ctx.modelRegistry?.getApiKeyAndHeaders) return;
      context = ctx;
      timer = setInterval(() => { void refresh(); }, 60000);
      timer.unref();
      void refresh();
    },
  };
}
