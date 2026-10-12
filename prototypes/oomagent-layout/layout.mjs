import { footerPalette } from "../../.pi/extensions/oomagent-ui.ts";
import {
  HStack, VStack, ScrollView, Input, Text, matchesKey,
  visibleWidth, truncateToWidth, wrapTextWithAnsi, stripTerminalSequences, rgbColor,
} from "@earendil-works/pi-tui";

// User/tool text is data, never terminal control sequences or executable code.
export const cleanText = value => stripTerminalSequences(String(value))
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
  .slice(0, 8000);
const pad = (text, width) => {
  const clipped = truncateToWidth(text, Math.max(0, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

const PAPER = rgbColor(16, 18, 20);
const INK = rgbColor(255, 255, 255);
// Nested bubble/Input styles close with 39/49: restore the paper, not the
// terminal wallpaper, for the remaining padding on that same line.
const paper = (theme, text) => {
  // Obtain the matching opening sequences from the theme: never mix 24-bit
  // restores into a 256-colour frame (Apple Terminal ignores those sequences).
  const style = { fg: INK, bg: PAPER };
  const opening = theme.style("", style).replace(/\x1b\[(?:39|49)m/g, "");
  return theme.style(text.replace(/\x1b\[(?:39|49)m/g, opening), style);
};

export function bubbleLines(message, width, theme) {
  if (width < 8) return wrapTextWithAnsi(cleanText(message.text), Math.max(1, width));
  const user = message.role === "user";
  const limit = Math.max(8, Math.floor(width * 0.85));
  const body = wrapTextWithAnsi(cleanText(message.text), limit - 4);
  const bubbleWidth = Math.min(limit, Math.max(user ? 9 : 14, ...body.map(line => visibleWidth(line) + 4)));
  const background = PAPER;
  const lines = [
    `╭${pad(` ${user ? "Jij" : "OomAgent"} `, bubbleWidth - 2).replace(/ +$/, s => "─".repeat(s.length))}╮`,
    ...body.map(line => `│ ${pad(line, bubbleWidth - 4)} │`),
    `╰${"─".repeat(bubbleWidth - 2)}╯`,
  ];
  const offset = user ? width - bubbleWidth : 0;
  return lines.map((line, i) => " ".repeat(offset) + theme.style(line, {
    fg: i === 0 || i === lines.length - 1 ? (user ? "borderMuted" : "borderAccent") : "text", bg: background,
  }));
}

export function createLayout({ theme, footer, redraw, quit, onBegin = () => {}, onFinish = () => {}, onPaneChange = () => {}, width = 120, height = 30 }) {
  const messages = [
    { role: "assistant", text: "Welkom! Dit is de offline indeling. Links praten we; rechts verschijnt alleen demo-uitvoer." },
    { role: "user", text: "Mijn berichten rechts, jouw antwoorden links." },
    { role: "assistant", text: "Precies. Typ iets om de indeling te proberen. Er wordt niets naar een model gestuurd." },
  ];
  const output = ["OFFLINE DEMO — geen echte tools", "", "Wacht op je testbericht…"];
  let pane = "chat";
  let timer;
  let disposed = false;
  const remember = (role, text) => {
    messages.push({ role, text: cleanText(text) });
    if (messages.length > 100) messages.shift();
    chat.invalidate();
  };
  let cardHeight = 20;
  const surface = (lines, width, rows) => [...lines, ...Array(Math.max(0, rows - lines.length)).fill("")]
    .map(line => paper(theme, pad(line, width)));
  // Native stacks measure at multiple widths before painting. Retain a small,
  // bounded cache so typing/scrolling does not re-wrap unchanged history.
  const cachedSurface = (getLines, reservedRows) => {
    const cache = new Map();
    return {
      invalidate() { cache.clear(); },
      render(width) {
        const key = `${width}:${cardHeight}`;
        if (!cache.has(key)) {
          const lines = surface(getLines(width), width, cardHeight - reservedRows);
          if (cache.size >= 4) cache.delete(cache.keys().next().value);
          cache.set(key, lines);
        }
        return cache.get(key);
      },
    };
  };
  const chat = cachedSurface(width => messages.flatMap(message => [...bubbleLines(message, width, theme), ""]), 4);
  const code = cachedSurface(width => output.flatMap(line => wrapTextWithAnsi(cleanText(line), Math.max(1, width))), 2);
  const scrollOptions = {
    follow: "end", scrollbar: "always", overscroll: "contain",
    scrollbarTrackStyle: () => theme.style("░", { fg: rgbColor(80, 90, 100), bg: PAPER }),
    scrollbarThumbStyle: () => theme.style("█", { fg: footerPalette(theme).cyan, bg: PAPER, bold: true }),
  };
  const chatScroll = new ScrollView(chat, { ...scrollOptions, primary: true });
  const codeScroll = new ScrollView(code, scrollOptions);
  const input = new Input({ prompt: "› ", placeholder: "Typ je bericht…" });
  const renderInput = input.render.bind(input);
  input.render = width => renderInput(width).map(line => paper(theme, pad(line, width)));
  const border = text => theme.style(text, { fg: footerPalette(theme).cyan, bg: PAPER });
  const paintedRow = (getText, frame = false) => ({
    invalidate() {},
    render(width) { return [frame ? border(pad(getText(width), width)) : paper(theme, pad(getText(width), width))]; },
  });
  const fill = text => ({
    invalidate() {},
    render(width) { return Array(cardHeight).fill(border(pad(text, width))); },
  });
  const selectPane = name => { pane = name; onPaneChange(name); redraw(); };
  const nativeInputMouse = input.handleMouse.bind(input);
  input.handleMouse = event => {
    if (event.button === "left" && (event.type === "press" || event.type === "click")) selectPane("chat");
    return nativeInputMouse(event);
  };
  const card = (title, name, content) => {
    const panel = new VStack([
    { component: paintedRow(width => {
      const label = ` ${pane === name ? "●" : "○"} ${title} `;
      return `╭${pad(label, Math.max(0, width - 2)).replace(/ +$/, s => "─".repeat(s.length))}╮`;
    }, true), basis: 1, shrink: 0 },
    { component: new HStack([
      { component: fill("│ "), basis: 2, shrink: 0 },
      { component: content, basis: 0, grow: 1 },
      { component: fill(" │"), basis: 2, shrink: 0 },
    ]), basis: 0, grow: 1 },
    { component: paintedRow(width => `╰${"─".repeat(Math.max(0, width - 2))}╯`, true), basis: 1, shrink: 0 },
    ]);
    panel.handleMouse = event => {
      if (event.type === "wheel") {
        // Consume even at the boundary: native routeWheel otherwise falls
        // back to the primary (chat) viewport despite overscroll=contain.
        (name === "chat" ? chatScroll : codeScroll).scrollBy(event.wheelDelta ?? 0);
        return { handled: true, render: true };
      }
      if (event.button === "left" && (event.type === "press" || event.type === "click")) selectPane(name);
      return undefined; // Keep native selection and scrollbar dragging.
    };
    return panel;
  };
  const left = card("OomAgent", "chat", new VStack([
    { component: chatScroll, basis: 0, grow: 1 },
    { component: paintedRow(width => "─".repeat(width)), basis: 1, shrink: 0 },
    { component: input, basis: 1, shrink: 0 },
  ]));
  const right = card("CodeMode", "code", codeScroll);
  const root = new VStack();
  // Scrolling in the gutter/footer must not silently move the primary chat.
  root.handleMouse = event => event.type === "wheel" ? { handled: true, render: false } : undefined;
  const blank = () => new Text("", 0, 0);
  let viewport = { width, height };
  function resize(width, height) {
    viewport = { width, height };
    const dual = width >= 80;
    const count = dual ? 2 : 1;
    const gap = dual ? 4 : 0;
    const cardWidth = Math.max(6, Math.min(168, Math.floor((width - 4 - gap) / count)));
    const outer = Math.max(0, width - cardWidth * count - gap);
    const available = Math.max(0, height - footer.render(width).length - 1);
    cardHeight = Math.max(4, Math.min(80, available - 4));
    const top = Math.max(0, Math.floor((available - cardHeight) / 2));
    const panels = new HStack([
      { component: blank(), basis: Math.floor(outer / 2), shrink: 0 },
      ...(dual || pane === "chat" ? [{ component: left, basis: cardWidth, shrink: 0 }] : []),
      ...(dual ? [{ component: blank(), basis: gap, shrink: 0 }] : []),
      ...(dual || pane === "code" ? [{ component: right, basis: cardWidth, shrink: 0 }] : []),
      { component: blank(), basis: Math.ceil(outer / 2), shrink: 0 },
    ]);
    root.clear();
    root.addChild(new Text("OFFLINE · Tab: paneel · PgUp/PgDn: scroll · /error: demofout · Ctrl+C: sluiten", 0, 0), { basis: 1 });
    root.addChild(new VStack([
      { component: blank(), basis: top },
      { component: panels, basis: cardHeight },
      { component: blank(), basis: 0, grow: 1 },
    ]), { basis: 0, grow: 1 });
    root.addChild(footer, { shrink: 0 });
  }
  resize(width, height);
  const finish = () => {
    clearInterval(timer);
    timer = undefined;
    onFinish();
  };
  function submit(value) {
    if (disposed || !value.trim()) return;
    if (value.trim() === "/quit") { quit(); return; }
    if (timer) return; // Preserve the draft while the demo is busy.
    input.setValue("");
    remember("user", value);
    remember("assistant", "[Demo] Ik laat rechts een voorbeeld uitvoeren. Je tekst wordt niet uitgevoerd.");
    output.push("", "OFFLINE CodeMode · voorbeeld gestart", "", "const result = 2 + 2;", "text(result);");
    if (output.length > 400) output.splice(0, output.length - 400);
    code.invalidate();
    chatScroll.scrollToEnd();
    codeScroll.scrollToEnd();
    onBegin();
    const failure = value.trim() === "/error";
    let step = 0;
    timer = setInterval(() => {
      step++;
      if (step === 1) output.push("", "[Demo] Uitvoering bezig…");
      else {
        output.push(failure ? "[Demo] FOUT — bewust gesimuleerd; er is niets uitgevoerd." : "[Demo] Resultaat: 4 — geen echte code uitgevoerd.");
        remember("assistant", failure ? "[Demo] De fout blijft rechts zichtbaar. Probeer gerust opnieuw." : "[Demo] Klaar! Chat en uitvoer blijven naast elkaar staan.");
        finish();
      }
      code.invalidate();
      redraw();
    }, 450);
    redraw();
  }
  input.onSubmit = submit;
  return {
    root, input, chatScroll, codeScroll, leftCard: left, rightCard: right, resize,
    submit,
    get pane() { return pane; },
    get busy() { return Boolean(timer); },
    handleShortcut(data) {
      if (matchesKey(data, "ctrl+c")) { quit(); return true; }
      if (matchesKey(data, "tab")) { selectPane(pane === "chat" ? "code" : "chat"); resize(viewport.width, viewport.height); redraw(); return true; }
      const scroll = pane === "chat" ? chatScroll : codeScroll;
      if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
        scroll.scrollBy((matchesKey(data, "pageUp") ? -1 : 1) * Math.max(1, scroll.viewportHeight - 1));
        redraw(); return true;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) finish();
    },
  };
}
