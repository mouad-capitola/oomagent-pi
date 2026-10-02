import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function parseCsv(text: string) {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let started = false;

  function finishRow() {
    if (started || row.length || field.length) records.push([...row, field]);
    row = [];
    field = "";
    closed = false;
    started = false;
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
      continue;
    }
    if (closed && char !== "," && char !== "\r" && char !== "\n") {
      throw new Error("file_reader: invalid CSV: unexpected character after closing quote.");
    }
    if (char === '"') {
      if (field.length) throw new Error("file_reader: invalid CSV: quote inside an unquoted field.");
      quoted = true;
      started = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
      started = true;
    } else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += char;
      started = true;
    }
  }
  if (quoted) throw new Error("file_reader: invalid CSV: unclosed quoted field.");
  finishRow();
  const columns = records.shift();
  if (!columns || columns.some(column => !column.trim())) {
    throw new Error("file_reader: CSV must have a header row with nonempty column names.");
  }
  if (new Set(columns).size !== columns.length) {
    throw new Error("file_reader: CSV column names must be unique.");
  }
  const rows = records.map((values, index) => {
    if (values.length !== columns.length) {
      throw new Error(`file_reader: CSV data row ${index + 1} has ${values.length} fields; expected ${columns.length}.`);
    }
    return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
  });
  return { columns, rows };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "file_reader",
    label: "File reader",
    description: "Read .txt as UTF-8 text or comma-delimited .csv as JSON with columns and rows. CSV uses the first row as unique column names; values remain strings and blank lines are skipped. Paths are relative to Pi's working directory; outside-project paths are blocked.",
    parameters: Type.Object({
      file_path: Type.String({ description: "File path relative to the current project root", minLength: 1 }),
    }, { additionalProperties: false }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_toolCallId, { file_path }, signal, _onUpdate, ctx) {
      if (isAbsolute(file_path) || file_path.includes("\0") || file_path.split(/[\\/]/).includes("..")) {
        throw new Error("file_reader: file_path must be relative to the project root and must not contain '..' or null bytes.");
      }

      const format = extname(file_path).toLowerCase();
      if (format !== ".txt" && format !== ".csv") {
        throw new Error("file_reader: only .txt and .csv files are supported.");
      }

      try {
        signal?.throwIfAborted();
        const root = await realpath(ctx.cwd);
        const candidate = resolve(root, file_path);
        if (!isWithin(root, candidate)) {
          throw new Error("file_reader: path is outside the project directory.");
        }
        const resolvedPath = await realpath(candidate);
        if (!isWithin(root, resolvedPath)) {
          throw new Error("file_reader: symlink target is outside the project directory.");
        }

        // Refuse a final-component symlink introduced after realpath().
        const handle = await open(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const stat = await handle.stat();
          if (stat.isDirectory()) {
            throw new Error(`file_reader: '${file_path}' is a directory, not a file.`);
          }
          if (!stat.isFile()) {
            throw new Error(`file_reader: '${file_path}' is not a regular text file.`);
          }
          const bytes = await handle.readFile({ signal });
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            throw new Error(`file_reader: '${file_path}' is not valid UTF-8 text.`);
          }
          const csv = format === ".csv" ? parseCsv(text) : undefined;
          return {
            content: [{ type: "text", text: csv ? JSON.stringify(csv, null, 2) : text }],
            details: {
              requestedPath: file_path,
              resolvedPath,
              sizeBytes: bytes.byteLength,
              format: format.slice(1),
              ...(csv ? { columns: csv.columns, rows: csv.rows, rowCount: csv.rows.length } : {}),
            },
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          throw new Error(`file_reader: file '${file_path}' does not exist.`);
        }
        if (code === "EACCES" || code === "EPERM") {
          throw new Error(`file_reader: permission denied reading '${file_path}'.`);
        }
        if (error instanceof Error && error.message.startsWith("file_reader:")) throw error;
        throw new Error(`file_reader: cannot read '${file_path}': ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  }));
}
