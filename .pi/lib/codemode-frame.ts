import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, rgbColor, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PURPLE = rgbColor(179, 136, 255);
const FRAME = Symbol("oomagent-codemode-frame");
const EMPTY: Component = { render: () => [], invalidate() {} };

// Both renderer slots share one frame, so streaming/expanded output stays inside
// the same closed box. Delegate content and folding to Pi's existing renderers.
export class CodemodeFrame implements Component {
  call?: Component;
  result?: Component;
  theme: Theme;
  constructor(theme: Theme) { this.theme = theme; }

  invalidate() {
    this.call?.invalidate();
    this.result?.invalidate();
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    const purple = (text: string) => this.theme.style(text, { fg: PURPLE, bold: true });
    if (width <= 4) return [purple(truncateToWidth("codemode", width, ""))];
    const inner = width - 4;
    const title = truncateToWidth(" codemode ", width - 2, "");
    const top = purple(`┏${title}${"━".repeat(width - 2 - visibleWidth(title))}┓`);
    const bottom = purple(`┗${"━".repeat(width - 2)}┛`);
    const content = [...(this.call?.render(inner) ?? []), ...(this.result?.render(inner) ?? [])];
    const lines = content.flatMap(line => wrapTextWithAnsi(line, inner));
    return [top, ...lines.map(line => {
      const fitted = truncateToWidth(line, inner, "");
      return purple("┃") + " " + fitted + " ".repeat(inner - visibleWidth(fitted)) + " " + purple("┃");
    }), bottom];
  }
}

export function frameCodemode(base: ToolRenderers): ToolRenderers {
  return {
    ...base,
    renderShell: "self",
    renderCall(args, theme, context) {
      const frame: CodemodeFrame = context.state[FRAME] ??= new CodemodeFrame(theme);
      frame.theme = theme;
      frame.call = base.renderCall!(args, theme, { ...context, lastComponent: frame.call });
      return frame;
    },
    renderResult(result, options, theme, context) {
      const frame: CodemodeFrame = context.state[FRAME] ??= new CodemodeFrame(theme);
      frame.theme = theme;
      frame.result = base.renderResult!(result, options, theme, { ...context, lastComponent: frame.result });
      return EMPTY;
    },
  };
}
