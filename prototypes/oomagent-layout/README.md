# OomAgent / CodeMode — offline layout prototype

Start in a **separate terminal window**, from the repository root:

```sh
node prototypes/oomagent-layout/preview.mjs
```

This is an opt-in UI preview, **not yet a functional Pi agent client**. It uses
Pi's existing terminal components and the actual OomAgent footer renderer. It does
not start a model, execute entered text, connect MCP servers, read credentials,
save messages, change configuration or upload anything. The footer reads local
Git status; model/context data are unavailable, **ChatGPT week ?%** is explicitly unknown, and tool/token counts are zero.
The active Pi process, session and footer remain untouched. No installation needed.

- Two equally sized, centred paper panels with closed outer borders, outer margins and a gap.
- Dark backgrounds and the existing Pi text/message-border colours; short bubbles fit their contents.
- Outer borders and solid scroll thumbs reuse the **TOKENS** cyan from the unchanged HUD.
- Uses Pi’s terminal colour detection: 256 colours for Apple Terminal, truecolour where supported; no forced RGB.
- Panel limits doubled to 168 columns × 80 rows each, constrained by terminal space.
- Left: **OomAgent**, assistant bubbles left, user bubbles right in chronological order.
- Input stays inside the OomAgent border, under the left chat only. This first preview uses single-line input.
- Right: **CodeMode**, simulated execution and persistent output/errors.
- Footer uses the existing HUD renderer and colours, compacted into one full-width row by the preview adapter.
  It shows an ellipsis if the terminal is too narrow; it never wraps. The normal Pi footer is unchanged.
- Enter: append a local test message and play a demo (never real execution).
- `/error`: simulate a failure. The error remains in the right panel.
- Click a panel (or Tab) to select chat or output. Page Up/Down: scroll the selected pane; mouse wheel also scrolls. Both panels have their own always-visible scrollbar with a solid cyan thumb on a dim track; drag the thumb to navigate. Wheel input stays in the hovered panel, even at either scroll boundary; the gutter does not scroll either panel.
- Below 80 columns, Tab switches between full-width panes. Input is only in chat.
- Ctrl+C or `/quit`: close the preview and return to the shell.

Chat and output formatting are cached at up to four width/height combinations per pane,
so typing and scrolling reuse unchanged history. Content updates and theme invalidation
clear the affected cache; resizing selects fresh dimensions. No animation delay is added.

At most 100 messages are retained in memory; inputs are capped to 8,000 characters
for display. Demo output retains recent runs (bounded to about 400 lines) for independent scrolling. No files store the messages.

Next stage, after reviewing this layout: SDK session integration, real streamed
messages/tools, approval dialogs (fail closed when unsupported), multi-line editing,
shortcuts, images and session resume. None of those are claimed by this preview.
The theme loader is a read-only Pi package helper, covered by the prototype tests.
