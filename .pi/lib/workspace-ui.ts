import { highlightCode, getLanguageFromPath, CustomEditor, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, decodeKittyPrintable, CURSOR_MARKER, renderFakeCursor, truncateToWidth, sliceByColumn, visibleWidth, type TUI, type EditorTheme, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { basename, relative } from "node:path";
import { ChangeTracker, changeLines } from "./workspace-changes.mjs";
import { listFolder, readDocument, saveDocument, safeLabel, TextBuffer } from "./workspace-files.mjs";

const fit = (text: string, width: number) => truncateToWidth(text, Math.max(0, width), "");
const pad = (text: string, width: number) => { const line = fit(text, width); return line + " ".repeat(Math.max(0, width - visibleWidth(line))); };
const digits: Record<string, string[]> = {
  "0": ["███","█ █","█ █","█ █","███"], "1": [" █ ","██ "," █ "," █ ","███"],
  "2": ["███","  █","███","█  ","███"], "3": ["███","  █"," ██","  █","███"],
  "4": ["█ █","█ █","███","  █","  █"], "5": ["███","█  ","███","  █","███"],
  "6": ["███","█  ","███","█ █","███"], "7": ["███","  █","  █"," █ "," █ "],
  "8": ["███","█ █","███","█ █","███"], "9": ["███","█ █","███","  █","███"],
  "-": ["   ","   ","───","   ","   "],
};

export function dateArt(date = new Date()) {
  const value = [date.getDate(), date.getMonth() + 1, date.getFullYear()].map((v, i) => String(v).padStart(i === 2 ? 4 : 2, "0")).join("-");
  const front = Array.from({ length: 5 }, (_, row) => [...value].map(ch => digits[ch][row]).join(" "));
  return front.map((line, row) => [...line + " "].map((ch, col) => ch !== " " ? ch : row > 0 && front[row - 1][col - 1] === "█" ? "░" : " ").join(""))
    .concat(" " + front[4].replace(/█/g, "░"));
}

export class WelcomeScreen {
  focused = true;
  input = new Input();
  constructor(private tui: TUI, private theme: ExtensionContext["ui"]["theme"], private done: (ready: boolean) => void) {
    this.input.onSubmit = value => { if (value.trim().toLowerCase() === "ready") this.done(true); };
  }
  invalidate() {}
  handleInput(data: string) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.done(false); return; }
    this.input.handleInput(data); this.tui.requestRender();
  }
  render(width: number) {
    const height = Math.max(1, this.tui.terminal.rows);
    const center = (line: string) => pad(" ".repeat(Math.max(0, Math.floor((width - visibleWidth(line)) / 2))) + line, width);
    this.input.focused = this.focused;
    const art = width >= 42 ? dateArt().map(line => this.theme.fg("accent", line)) : [new Date().toLocaleDateString("nl-NL")];
    const lines = [center(this.theme.bold("OOMAGENT · PROJECTS")), "", ...art.map(center), "",
      center("Typ ready + Enter · Esc = gewone Pi"), center(this.input.render(Math.min(24, Math.max(1, width)))[0] ?? "")];
    const top = Math.max(0, Math.floor((height - lines.length) / 2));
    return [...Array(top).fill(" ".repeat(width)), ...lines, ...Array(Math.max(0, height - top - lines.length)).fill(" ".repeat(width))].slice(0, height);
  }
}

export class WorkspaceState {
  rows: any[] = [];
  expanded = new Set<string>();
  children = new Map<string, any[]>();
  selected = 0;
  document: ReturnType<typeof readDocument> | undefined;
  buffer = new TextBuffer();
  savedText = "";
  pane: "tree" | "file" | "chat" = "chat";
  message = "";
  visible = true;
  top = 0;
  treeTop = 0;
  hoveredPath: string | undefined;
  changes: ChangeTracker;
  reviewPath: string | undefined;
  reviewTop = 0;
  constructor(public root: string) { this.changes = new ChangeTracker(root); }
  poll(activeProject?: string) {
    const events = this.changes.poll([
      { path: this.root, recursive: false },
      ...(activeProject ? [{ path: activeProject, recursive: true }] : []),
      ...[...this.expanded].map(path => ({ path, recursive: false })),
    ]);
    const selectedPath = this.rows[this.selected]?.path;
    this.refresh();
    const selected = this.rows.findIndex(row => row.path === selectedPath);
    if (selected >= 0) this.selected = selected;
    if (events.length) {
      this.message = events.map(event => event.kind + ": " + safeLabel(relative(this.root, event.path))).join(" · ");
      if (this.document && events.some(event => event.path === this.document!.path)) {
        if (this.dirty) this.message += " · concept behouden; schijf gewijzigd";
        else {
          try { this.reloadFile(); } catch { this.message += " · geopend bestand niet meer leesbaar"; }
        }
      }
    } else if (this.changes.warning) this.message = this.changes.warning;
    return events;
  }
  review(path: string) {
    if (!this.changes.changes.has(path)) return;
    this.reviewPath = path; this.reviewTop = 0; this.pane = "file"; this.visible = true;
  }
  get dirty() { return !!this.document && this.buffer.text !== this.savedText; }
  refresh() {
    this.children.clear();
    this.rebuild();
  }
  rebuild() {
    const rows: any[] = [];
    const visit = (path: string, depth: number) => {
      if (depth > 30 || rows.length > 10000) throw Error("Te veel uitgeklapte mappen.");
      let entries = this.children.get(path);
      if (!entries) { entries = listFolder(this.root, path); this.children.set(path, entries); }
      for (const entry of entries) {
        rows.push({ ...entry, depth });
        if (entry.directory && this.expanded.has(entry.path) && !entry.blocked) visit(entry.path, depth + 1);
      }
    };
    visit(this.root, 0);
    this.rows = rows; this.selected = Math.max(0, Math.min(this.selected, rows.length - 1));
  }
  openSelected() {
    const entry = this.rows[this.selected];
    if (!entry) return;
    if (entry.blocked) throw Error("Afgeschermd bestand of symlink.");
    if (entry.directory) {
      if (this.expanded.has(entry.path)) this.expanded.delete(entry.path); else this.expanded.add(entry.path);
      this.rebuild();
    } else {
      if (this.dirty) throw Error("Sla je concept eerst op (Ctrl+S), of sluit het met /workspace-close.");
      const document = readDocument(this.root, entry.path);
      this.document = document; this.buffer = new TextBuffer(document.text);
      this.savedText = document.text; this.top = 0; this.pane = "file"; this.message = "";
      this.reviewPath = undefined;
      this.review(entry.path);
    }
  }
  reloadFile() {
    if (!this.document) return;
    if (this.dirty) throw Error("Concept heeft wijzigingen; herladen zou ze verliezen. Sla op of sluit eerst.");
    const next = readDocument(this.root, this.document.path);
    if (next.text !== this.buffer.text) {
      const cursor = Math.min(this.buffer.cursor, next.text.length);
      this.buffer = new TextBuffer(next.text); this.buffer.cursor = cursor;
    }
    this.document = next; this.savedText = next.text;
  }
  save() {
    if (!this.document || !this.dirty) return;
    this.document = saveDocument(this.root, this.document, this.buffer.text);
    this.savedText = this.buffer.text; this.message = "Opgeslagen · vraag Pi om dit bestand te bekijken.";
  }
}

export class WorkspaceEditor extends CustomEditor {
  private panelHeight = 0;
  private leftWidth = 0;
  private paste: string | undefined;
  private highlightCache: { text: string; path: string; theme: unknown; lines: string[] } | undefined;
  invalidate() { this.highlightCache = undefined; super.invalidate(); }
  constructor(tui: TUI, theme: EditorTheme, keys: KeybindingsManager,
    public workspace: WorkspaceState, private ctx: ExtensionContext, private activate: () => void) {
    super(tui, theme, keys);
  }
  private run(action: () => void) {
    try { action(); } catch (error) { this.workspace.message = safeLabel(error instanceof Error ? error.message : "Actie mislukt."); }
    this.tui.requestRender();
  }
  handleInput(data: string) {
    const state = this.workspace;
    // Bracketed paste belongs entirely to its starting pane, never to shortcuts.
    if (state.pane === "file" && (this.paste !== undefined || data.includes("\x1b[200~"))) {
      this.paste = (this.paste ?? "") + data.replace("\x1b[200~", "");
      if (this.paste.length > 600000) { this.paste = undefined; state.message = "Plaktekst te groot."; return; }
      if (this.paste.includes("\x1b[201~")) {
        const value = this.paste.split("\x1b[201~")[0]; this.paste = undefined;
        this.run(() => {
          if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw Error("Plaktekst bevat besturingscodes.");
          state.buffer.insert(value.replace(/\r\n|\r/g, "\n").replace(/\n/g, state.savedText.includes("\r\n") ? "\r\n" : "\n"));
        });
      }
      return;
    }
    if (matchesKey(data, "f2") && this.panelHeight !== -1) {
      state.visible = true;
      state.pane = state.pane === "chat" ? "tree" : state.pane === "tree" ? "file" : "chat";
      this.tui.requestRender(); return;
    }
    if (matchesKey(data, "escape") && state.pane !== "chat") { state.pane = "chat"; this.tui.requestRender(); return; }
    if (!state.visible || state.pane === "chat") { super.handleInput(data); return; }
    if (matchesKey(data, "f4")) {
      if (state.reviewPath) state.reviewPath = undefined;
      else if (state.document) state.review(state.document.path);
      this.tui.requestRender(); return;
    }
    if (state.pane === "file" && state.reviewPath) {
      if (matchesKey(data, "up")) state.reviewTop = Math.max(0, state.reviewTop - 1);
      else if (matchesKey(data, "down")) state.reviewTop++;
      else if (matchesKey(data, "pageUp")) state.reviewTop = Math.max(0, state.reviewTop - this.panelHeight);
      else if (matchesKey(data, "pageDown")) state.reviewTop += this.panelHeight;
      else if (matchesKey(data, "home")) state.reviewTop = 0;
      this.tui.requestRender(); return;
    }
    if (matchesKey(data, "ctrl+s")) { this.run(() => state.save()); return; }
    if (matchesKey(data, "ctrl+c")) { super.handleInput(data); return; }
    if (state.pane === "tree") {
      this.run(() => {
        if (matchesKey(data, "up")) state.selected = Math.max(0, state.selected - 1);
        else if (matchesKey(data, "down")) state.selected = Math.min(state.rows.length - 1, state.selected + 1);
        else if (matchesKey(data, "return") || matchesKey(data, "right")) state.openSelected();
        else if (matchesKey(data, "left")) {
          const row = state.rows[state.selected];
          if (row && state.expanded.has(row.path)) { state.expanded.delete(row.path); state.rebuild(); }
          else if (row) { const parent = state.rows.slice(0, state.selected).findLastIndex(r => r.depth < row.depth); if (parent >= 0) state.selected = parent; }
        } else if (matchesKey(data, "f5")) state.refresh();
        else if (matchesKey(data, "ctrl+o")) this.activate();
      });
      return;
    }
    if (!state.document) return;
    if (matchesKey(data, "f5")) { this.run(() => state.reloadFile()); return; }
    const b = state.buffer;
    this.run(() => {
      if (matchesKey(data, "left")) b.cursor = b.previous();
      else if (matchesKey(data, "right")) b.cursor = b.next();
      else if (matchesKey(data, "up")) b.vertical(-1);
      else if (matchesKey(data, "down")) b.vertical(1);
      else if (matchesKey(data, "home")) b.cursor = b.lineStart();
      else if (matchesKey(data, "end")) b.cursor = b.lineEnd();
      else if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
        const direction = matchesKey(data, "pageUp") ? -1 : 1;
        for (let i = 0; i < Math.max(1, this.panelHeight - 2); i++) b.vertical(direction);
      }
      else if (matchesKey(data, "backspace")) b.replace(b.previous(), b.cursor, "");
      else if (matchesKey(data, "delete")) b.replace(b.cursor, b.next(), "");
      else if (matchesKey(data, "return")) b.insert(state.savedText.includes("\r\n") ? "\r\n" : "\n");
      else if (matchesKey(data, "tab")) b.insert("\t");
      else if (matchesKey(data, "ctrl+z")) b.undo();
      else {
        const printable = decodeKittyPrintable(data) ?? data;
        if (printable && !/[\x00-\x1f\x7f-\x9f]/.test(printable)) b.insert(printable);
      }
    });
  }
  handleMouse(event: TuiMouseEvent) {
    const state = this.workspace;
    const entry = state.rows[state.treeTop + event.y - 1];
    const clickable = state.visible && event.x < this.leftWidth && event.y >= 1 && event.y < this.panelHeight && entry && !entry.blocked;
    // OSC 22 changes the mouse pointer, not the text insertion cursor. Unsupported
    // terminals ignore it. The extension resets it before global mouse dispatch.
    if (event.type === "move") {
      this.tui.terminal.write?.("\x1b]22;" + (clickable ? "pointer" : "default") + "\x1b\\");
      const path = clickable ? entry.path : undefined;
      const changed = state.hoveredPath !== path;
      state.hoveredPath = path;
      return { handled: true, render: changed };
    }
    if (!state.visible || event.y >= this.panelHeight + 2) {
      if (event.type === "press") state.pane = "chat";
      return super.handleMouse({ ...event, y: event.y - (state.visible ? this.panelHeight + 2 : 0) });
    }
    if (event.type === "press" && event.button === "left") {
      state.pane = event.x < this.leftWidth ? "tree" : "file";
      if (state.pane === "tree" && event.y >= 1 && event.y < this.panelHeight) {
        state.selected = Math.min(state.rows.length - 1, state.treeTop + event.y - 1);
        this.run(() => state.openSelected());
      }
      return { handled: true, focus: true };
    }
    if (event.type === "wheel") {
      if (event.x < this.leftWidth) state.selected = Math.max(0, Math.min(state.rows.length - 1, state.selected + (event.wheelDelta ?? 0)));
      else if (state.reviewPath) state.reviewTop = Math.max(0, state.reviewTop + (event.wheelDelta ?? 0));
      else for (let i = 0; i < Math.abs(event.wheelDelta ?? 0); i++) state.buffer.vertical((event.wheelDelta ?? 0) < 0 ? -1 : 1);
      return { handled: true, render: true };
    }
    return { handled: true };
  }
  render(width: number): string[] {
    const state = this.workspace;
    if (!state.visible) return super.render(width);
    const focused = this.focused;
    this.focused = focused && state.pane === "chat";
    const prompt = super.render(width);
    this.focused = focused;
    if (width < 32 || this.tui.terminal.rows < 16) {
      this.panelHeight = -1; this.leftWidth = 0;
      state.pane = "chat";
      return [fit("Vergroot terminal · F2 panelen · Esc chat", width), ...super.render(width)];
    }
    const height = Math.max(3, Math.min(20, Math.floor(this.tui.terminal.rows * 0.42)));
    this.panelHeight = height;
    const left = Math.min(36, Math.max(12, Math.floor(width * 0.27))), right = width - left - 1;
    this.leftWidth = left;
    const theme = this.ctx.ui.theme;
    const accent = (value: string) => theme.fg("accent", value);
    const title = (state.reviewPath ? "DIFF " + safeLabel(relative(state.root, state.reviewPath)) : state.document ? safeLabel(basename(state.document.path)) : "Open een tekstbestand") + (state.dirty ? " ● niet opgeslagen" : "");
    const divider = theme.fg("borderMuted", "│");
    const rows = [theme.bg("customMessageBg", pad(accent((state.pane === "tree" ? "▶ " : "") + "📁 Projects"), left)) + divider + theme.bg("selectedBg", pad(accent(" 📄 " + title), right))];
    const count = height - 1;
    const review = state.reviewPath ? changeLines(state.changes.changes.get(state.reviewPath)) : undefined;
    state.reviewTop = Math.max(0, Math.min(state.reviewTop, (review?.length ?? 1) - 1));
    state.treeTop = Math.max(0, Math.min(state.treeTop, state.selected));
    if (state.selected >= state.treeTop + count) state.treeTop = state.selected - count + 1;
    const b = state.buffer, before = b.text.slice(0, b.cursor), current = before.split("\n").length - 1;
    state.top = Math.max(0, Math.min(state.top, current));
    if (current >= state.top + count) state.top = current - count + 1;
    const lines = b.text.split(/\r?\n/);
    const display = (value: string) => safeLabel(value.replace(/\t/g, "    ").replace(/\r/g, ""));
    const path = state.document?.path ?? "";
    if (!this.highlightCache || this.highlightCache.text !== b.text || this.highlightCache.path !== path || this.highlightCache.theme !== theme) {
      this.highlightCache = { text: b.text, path, theme, lines: highlightCode(lines.map(display).join("\n"), getLanguageFromPath(path)) };
    }
    const prefix = display(before.slice(before.lastIndexOf("\n") + 1));
    const gutter = Math.min(7, String(lines.length).length + 1), contentWidth = Math.max(1, right - gutter);
    const horizontal = Math.max(0, visibleWidth(prefix) - contentWidth + 2);
    for (let i = 0; i < count; i++) {
      const entry = state.rows[state.treeTop + i];
      let tree = entry ? (state.treeTop + i === state.selected ? "›" : " ") + " ".repeat(entry.depth * 2) + (entry.link ? "↗ " : entry.directory ? (state.expanded.has(entry.path) ? "▾ 📁 " : "▸ 📁 ") : "📄 ") + safeLabel(entry.name) + (entry.blocked ? " [slot]" : "") + (state.changes.marker(entry.path) ? " " + state.changes.marker(entry.path) : "") : "";
      tree = pad(tree, left);
      tree = theme.fg(entry?.blocked ? "dim" : entry?.directory ? "accent" : "text", tree);
      if (entry && (state.treeTop + i === state.selected || entry.path === state.hoveredPath)) tree = theme.bg("selectedBg", tree);
      if (entry && entry.path === state.hoveredPath) tree = theme.bold(tree);
      if (review) {
        const line = review[state.reviewTop + i];
        const text = line ? (line.kind === "new" ? "+ " : line.kind === "old" ? "− " : "") + (line.line ? line.line + " " : "") + display(line.text) : "";
        const colored = line?.kind === "new" ? "\x1b[32m" + fit(text, right) + "\x1b[39m"
          : line?.kind === "old" ? "\x1b[31m" + fit(text, right) + "\x1b[39m" : theme.fg("dim", fit(text, right));
        rows.push(tree + divider + pad(colored, right));
        continue;
      }
      const index = state.top + i;
      const plain = display(lines[index] ?? "");
      let code = this.highlightCache.lines[index] ?? "";
      if (state.document && index === current && state.pane === "file" && focused) {
        const suffix = plain.slice(prefix.length);
        const cell = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(suffix)][0]?.segment ?? " ";
        const column = visibleWidth(prefix);
        code = sliceByColumn(code, 0, column) + CURSOR_MARKER + renderFakeCursor(cell) + sliceByColumn(code, column + visibleWidth(cell), visibleWidth(plain));
      }
      code = sliceByColumn(code, horizontal, contentWidth);
      const number = state.document && index < lines.length ? String(index + 1).padStart(gutter - 1) + " " : " ".repeat(gutter);
      rows.push(tree + divider + pad(theme.fg("dim", number) + code, right));
    }
    rows.push(fit(accent("F2: focus · F4: diff/code · Ctrl+S: opslaan · Ctrl+O: project · Esc: chat"), width));
    rows.push(fit(state.message || ("Actief: " + safeLabel(this.ctx.cwd) + " · focus: " + state.pane), width));
    return [...rows, ...prompt];
  }
}
