import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { parseColor, ScrollView, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { safeLabel } from "./workspace-files.mjs";

export type TreeNode = { name: string; kind: "folder" | "file" | "link" | "other"; note?: string; children?: TreeNode[] };
export const POLICY = "OomAgent-selectie · max. 12 niveaus · symlinks niet gevolgd";
const importantRoots = new Set([".pi", "skills", "flows", "workflows", "scripts", "docs", "AGENTS.md", "README.md", "package.json"]);
const hiddenNoise = new Set([".git", "node_modules", "npm", ".DS_Store", "__pycache__", ".cache", "dist", "coverage"]);
const priority = ["skills", "flows", "workflows", "extensions", "prompts", "lib", "themes"];

// Names/metadata only: never open file contents, including .env files.
export async function scanTree(path: string, importantOnly = false): Promise<TreeNode> {
  const root = await realpath(path);
  let remaining = 10000;
  async function visit(path: string, depth: number): Promise<TreeNode> {
    const node: TreeNode = { name: safeLabel(basename(path)), kind: "other" };
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return { ...node, kind: "link", note: "symlink" };
      if (!stat.isDirectory()) return { ...node, kind: stat.isFile() ? "file" : "other" };
      node.kind = "folder";
      if ([".git", "node_modules"].includes(basename(path))) return { ...node, note: "ingeklapt" };
      if (depth >= (importantOnly ? 12 : 3)) return { ...node, note: "dieptelimiet" };
      const canonical = await realpath(path);
      const rel = relative(root, canonical);
      if (canonical !== path || rel === ".." || rel.startsWith(".." + sep)) return { ...node, note: "pad gewijzigd" };
      const entries = (await readdir(path, { withFileTypes: true })).filter(entry => !importantOnly || (
        (depth !== 0 || importantRoots.has(entry.name)) && !hiddenNoise.has(entry.name)
        && !/^\.env(?:\.|$)|^(auth|credentials)\.json$|\.(pem|key|p12|pfx)$/i.test(entry.name)
      ));
      const rank = (name: string) => priority.includes(name) ? priority.indexOf(name) : priority.length;
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory())
        || (importantOnly ? rank(a.name) - rank(b.name) : 0) || a.name.localeCompare(b.name));
      node.children = [];
      for (const entry of entries) {
        if (remaining-- <= 0) { node.note = "rest weggelaten: limiet 10000 items"; break; }
        node.children.push(await visit(join(path, entry.name), depth + 1));
      }
      if (!entries.length) node.note = "leeg";
    } catch { node.note = "niet leesbaar / verdwenen"; }
    return node;
  }
  return visit(root, 0);
}

export const label = (node: TreeNode) => `${node.kind === "folder" ? "📁" : "📄"} ${node.name}${node.note ? ` [${node.note}]` : ""}`;
export const center = (text: string, width: number) => {
  const clipped = truncateToWidth(text, Math.max(0, width));
  return " ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2))) + clipped;
};
type Column = { heading: string; nodes: TreeNode[] };
type Diagram = { columns: Column[]; parent?: string };

export function diagrams(root: TreeNode, width: number): Diagram[] {
  const config = root.children?.find(node => node.name === ".pi" && node.children?.length);
  // Show the real .pi parent once, then its sibling branches beside one another.
  const groups = [
    ...(config ? [{ parent: label(config), nodes: config.children! }] : []),
    { parent: undefined, nodes: (root.children ?? []).filter(node => node !== config) },
  ];
  const count = Math.max(1, Math.floor((width + 2) / 26));
  const pages = groups.flatMap(group => {
    const columns = group.nodes.map(node => ({ heading: label(node), nodes: node.children ?? [] }));
    return Array.from({ length: Math.ceil(columns.length / count) }, (_, i) => ({
      parent: group.parent, columns: columns.slice(i * count, (i + 1) * count),
    }));
  });
  return pages.length ? pages : [{ columns: [{ heading: root.note ?? "leeg", nodes: [] }] }];
}

function branchLines(nodes: TreeNode[], width: number, prefix = ""): string[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1;
    const stem = prefix + (last ? "└─" : "├─");
    const continuation = prefix + (last ? "  " : "│ ");
    const available = Math.max(1, width - visibleWidth(stem));
    const lines = wrapTextWithAnsi(label(node), available).map((line, i) => truncateToWidth((i ? continuation : stem) + line, width));
    return [...lines, ...branchLines(node.children ?? [], width, continuation)];
  });
}

// An organigram: shared root and crossbar, then whole subtrees stacked in columns.
export function renderDiagram(diagram: Diagram, width: number): string[] {
  if (width < 1) return [];
  const count = diagram.columns.length;
  const available = Math.max(1, Math.floor((width - (count - 1) * 2) / count));
  const contentWidth = Math.max(...diagram.columns.flatMap(column => [
    visibleWidth(column.heading), ...branchLines(column.nodes, available).map(visibleWidth),
  ]));
  const cell = Math.min(available, Math.max(3, contentWidth));
  const used = count * cell + (count - 1) * 2;
  const left = Math.floor((width - used) / 2);
  const middle = Math.floor((width - 1) / 2);
  const points = diagram.columns.map((_, i) => left + i * (cell + 2) + Math.floor((cell - 1) / 2));
  const branch = Array(width).fill(" ");
  const first = Math.min(middle, points[0]), last = Math.max(middle, points.at(-1)!);
  for (let x = first; x <= last; x++) {
    const down = points.includes(x), up = x === middle;
    branch[x] = up && down ? (first === last ? "│" : "┼") : up ? "┴" : down ? (x === first ? "┌" : x === last ? "┐" : "┬") : "─";
  }
  const columns = diagram.columns.map(column => [
    center(column.heading, cell),
    // Link the centered heading to the vertical stem of its stacked children.
    column.nodes.length ? "┌" + "─".repeat(Math.max(0, Math.floor((cell - 1) / 2) - 1)) + "┘" : "",
    ...branchLines(column.nodes, cell),
  ]);
  return [center("│", width), branch.join(""), ...Array.from({ length: Math.max(...columns.map(lines => lines.length)) }, (_, row) =>
    " ".repeat(left) + columns.map(lines => {
      const text = truncateToWidth(lines[row] ?? "", cell);
      return text + " ".repeat(Math.max(0, cell - visibleWidth(text)));
    }).join("  "))];
}

const digits: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  "-": ["000", "000", "111", "000", "000"],
  "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
  "C": ["011", "100", "100", "100", "011"], "D": ["110", "101", "101", "101", "110"],
  "E": ["111", "100", "110", "100", "111"], "F": ["111", "100", "110", "100", "100"],
  "G": ["011", "100", "101", "101", "011"], "H": ["101", "101", "111", "101", "101"],
  "I": ["111", "010", "010", "010", "111"], "J": ["001", "001", "001", "101", "010"],
  "K": ["101", "101", "110", "101", "101"], "L": ["100", "100", "100", "100", "111"],
  "M": ["10001", "11011", "10101", "10001", "10001"], "N": ["1001", "1101", "1011", "1001", "1001"],
  "O": ["010", "101", "101", "101", "010"], "P": ["110", "101", "110", "100", "100"],
  "Q": ["010", "101", "101", "111", "011"], "R": ["110", "101", "110", "101", "101"],
  "S": ["011", "100", "010", "001", "110"], "T": ["111", "010", "010", "010", "010"],
  "U": ["101", "101", "101", "101", "111"], "V": ["101", "101", "101", "101", "010"],
  "W": ["10001", "10001", "10101", "11011", "10001"], "X": ["101", "101", "010", "101", "101"],
  "Y": ["101", "101", "010", "010", "010"], "Z": ["111", "001", "010", "100", "111"],
  "_": ["000", "000", "000", "000", "111"], ".": ["0", "0", "0", "0", "1"],
  " ": ["0", "0", "0", "0", "0"],
};
const dateFormat = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const white = parseColor("#ffffff");
const glowColors = ["#fffac2", "#d8ffc5", "#a5f3bb", "#91e4e8", "#a9baff", "#c4b5fd", "#f5ccf4"].map(parseColor);

const neutralShadow = parseColor("#454545");
const farShadow = parseColor("#292929");
// One seven-column highlight crosses the date, then leaves a quiet interval.
export function dateGlow(x: number, width: number, frame: number) {
  const start = frame % (width + 24) - 8;
  const offset = x - start;
  return offset >= 0 && offset < glowColors.length ? glowColors[offset] : white;
}

export function renderDate(date: Date, width: number, frame: number, theme: Theme, compact = false): string[] {
  if (width < 1) return [];
  const caption = dateFormat.format(date);
  const value = `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
  return renderBlockText(value, caption, width, frame, theme, compact);
}

export function renderProjectName(name: string, width: number, theme: Theme, compact = false): string[] {
  const caption = safeLabel(name);
  const value = caption.toUpperCase();
  const supported = [...value].every(char => Object.hasOwn(digits, char));
  const lines = renderBlockText(supported ? value : "", caption, width, 0, theme, compact || !supported, 1);
  // Preserve the actual spelling as well as the uppercase block lettering.
  return lines.length > 1 ? [...lines, center(theme.fg("muted", truncateToWidth(caption, width)), width)] : lines;
}

function renderBlockText(value: string, caption: string, width: number, frame: number, theme: Theme, compact: boolean, depth: 1 | 2 = 2): string[] {
  if (width < 1) return [];
  const mask = Array.from({ length: 5 }, (_, row) => [...value].map(char => digits[char][row]).join("0"));
  const blockWidth = mask[0].length + depth;
  if (width >= blockWidth && !compact) {
    const pixel = (x: number, y: number) => mask[y]?.[x] === "1";
    const lines = Array.from({ length: 5 + depth }, (_, y) => {
      let line = "";
      for (let x = 0; x < blockWidth; x++) {
        const color = dateGlow(x, blockWidth, frame);
        line += pixel(x, y) ? theme.style("█", { fg: color, bold: true })
          : pixel(x - 1, y - 1) ? theme.style("▓", { fg: neutralShadow })
          : depth === 2 && pixel(x - 2, y - 2) ? theme.style("░", { fg: farShadow }) : " ";
      }
      return " ".repeat(Math.floor((width - blockWidth) / 2)) + line;
    });
    return lines;
  }
  // Narrow terminals retain a readable date instead of clipping giant digits.
  const text = stripVTControlCharacters(truncateToWidth(` ${caption} `, Math.max(1, width - 1)));
  return [center(theme.style(text, { fg: white, bold: true }), width)];
}

export class StartDiagram {
  private page = 0;
  private pages: Diagram[] = [];
  private width = -1;
  private lines: string[] = [];
  private layout: string[] = [];
  private renderedPage = -1;
  private scroll = new ScrollView({ render: () => this.lines, invalidate() {} }, { scrollbar: "hidden" });
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private root: TreeNode, private tui: TUI, private theme: Theme) {
    this.timer = setInterval(() => { this.frame++; this.tui.requestRender(); }, 150);
    this.timer.unref();
  }
  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  invalidate() { this.width = -1; }
  navigate(action: string) {
    if (action === "volgende" || action === "vorige") {
      this.page = Math.max(0, Math.min(this.pages.length - 1, this.page + (action === "volgende" ? 1 : -1)));
      this.scroll.scrollToStart();
    } else if (action === "omlaag") this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1));
    else if (action === "omhoog") this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight - 1));
    this.tui.requestRender();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const margin = Math.floor(width * 0.05);
    const inner = Math.max(1, width - margin * 2);
    if (width !== this.width) {
      this.pages = diagrams(this.root, inner);
      this.page = Math.min(this.page, this.pages.length - 1);
      this.width = width;
      this.renderedPage = -1;
      this.scroll.scrollToStart();
    }
    if (this.renderedPage !== this.page) {
      this.layout = renderDiagram(this.pages[this.page], inner);
      this.renderedPage = this.page;
    }
    const heading = this.layout.slice(0, 3);
    this.lines = this.layout.slice(3);
    // This is a transcript header, not an editor widget. Keep chat space below it.
    const rows = this.tui.terminal.rows;
    const budget = Math.max(1, Math.min(22, Math.floor(rows * 0.55)));
    const date = budget >= 12 ? renderDate(new Date(), inner, this.frame, this.theme, budget < 20) : [];
    const parent = this.pages[this.page].parent;
    const ancestry = parent ? [center("│", inner), center(parent, inner)] : [];
    const height = Math.min(this.lines.length, Math.max(0, budget - 6 - date.length - ancestry.length));
    this.scroll.updateLayout(this.lines.length, height, () => this.tui.requestRender());
    const first = this.scroll.scrollTop;
    const range = height ? `${first + 1}–${Math.min(this.lines.length, first + height)}` : "0";
    const footer = `${this.page + 1}/${this.pages.length} · rijen ${range}/${this.lines.length} · /oom-start`;
    const content = [
      ...date,
      this.theme.fg("accent", center(label(this.root), inner)),
      ...ancestry,
      ...heading,
      ...this.scroll.render(inner).slice(first, first + height),
      this.theme.fg("dim", center(footer, inner)),
      this.theme.fg("dim", center(POLICY, inner)),
    ].slice(0, budget);
    // Lower the whole block on roomy terminals, without shrinking the tree viewport.
    // Small terminals keep the compact layout; at least 35% remains for chat/editor.
    const top = rows < 24 ? 0 : Math.max(0, Math.min(8, Math.floor((rows - content.length) / 4), Math.floor(rows * 0.65) - content.length));
    return [...Array<string>(top).fill(""), ...content].map(line => " ".repeat(margin) + truncateToWidth(line, inner));
  }
}
