import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// An exact allowlist, not a task classifier: ambiguity keeps all project rules.
const CHAT_MESSAGES = new Set([
  "hi", "hallo", "hoi", "hey", "hello", "hey there", "hi there",
  "goedemorgen", "goedemiddag", "goedenavond",
  "dank", "dank je", "dankjewel", "dank je wel", "bedankt", "thanks", "thank you",
  "doei", "dag", "bye", "tot ziens",
]);

export function isCasualMessage(prompt: string, hasImages = false): boolean {
  if (hasImages) return false;
  const normalized = prompt.trim().toLocaleLowerCase("nl-NL")
    .replace(/[!?.]+$/u, "").trim().replace(/\s+/gu, " ");
  return CHAT_MESSAGES.has(normalized);
}

type BranchEntry = {
  type: string;
  message?: {
    role: string;
    content?: string | readonly { type: string; text?: string }[];
  };
};

export function branchHasTask(entries: readonly BranchEntry[]): boolean {
  return entries.some(entry => {
    if (entry.type !== "message" || entry.message?.role !== "user") return false;
    const content = entry.message.content;
    if (typeof content === "string") return !isCasualMessage(content);
    if (!Array.isArray(content)) return true;
    const text = content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
    return !isCasualMessage(text, content.some(part => part.type !== "text"));
  });
}

export function isLocalProjectRule(path: string, cwd: string): boolean {
  if (!/^(?:AGENTS(?:\.override)?|CLAUDE)\.md$/i.test(basename(path))) return false;
  const location = relative(resolve(cwd), resolve(cwd, path));
  return location !== ".." && !location.startsWith(".." + sep) && !isAbsolute(location);
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    // Pi normalizes a fresh copy of the base options for each run. Only change
    // this run; leave the resource loader, file contents and global rules intact.
    if (!isCasualMessage(event.prompt, Boolean(event.images?.length))) return;
    if (branchHasTask(ctx.sessionManager.getBranch())) return;
    event.systemPromptOptions.contextFiles = event.systemPromptOptions.contextFiles
      .filter(file => !isLocalProjectRule(file.path, ctx.cwd));
  });
}
