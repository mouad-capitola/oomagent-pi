import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export const MAX_FILE_BYTES = 1024 * 1024;

type CsvData = { columns: string[]; rows: Record<string, string>[] };
type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";

function parseCsv(text: string): CsvData {
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

export async function readProjectFile(cwd: string, file_path: string, signal?: AbortSignal) {
      if (!file_path || isAbsolute(file_path) || win32.isAbsolute(file_path) || file_path.includes("\0") || file_path.split(/[\\/]/).includes("..")) {
        throw new Error("file_reader: file_path must be relative to the project root and must not contain '..' or null bytes.");
      }

      try {
        signal?.throwIfAborted();
        const root = await realpath(cwd);
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
          const format = extname(file_path).toLowerCase();
          if (format !== ".txt" && format !== ".csv") {
            throw new Error("file_reader: only .txt and .csv files are supported.");
          }
          if (stat.size > MAX_FILE_BYTES) {
            throw new Error("file_reader: file exceeds the 1 MiB size limit.");
          }
          // Bounded reading also catches a file growing after stat().
          const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
          let count = 0;
          while (count < buffer.length) {
            signal?.throwIfAborted();
            const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
            if (!bytesRead) break;
            count += bytesRead;
          }
          if (count > MAX_FILE_BYTES) throw new Error("file_reader: file exceeds the 1 MiB size limit.");
          const bytes = buffer.subarray(0, count);
          const encoding: TextEncoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
            : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
          let text: string;
          try {
            text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
          } catch {
            throw new Error(`file_reader: invalid ${encoding} encoding; use UTF-8 or UTF-16 with BOM.`);
          }
          if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
            throw new Error("file_reader: binary content detected; only text files are supported.");
          }
          const csv = format === ".csv" ? parseCsv(text) : undefined;
          return {
            content: [{ type: "text", text: csv ? JSON.stringify(csv, null, 2) : text }],
            details: {
              requestedPath: file_path,
              resolvedPath,
              sizeBytes: bytes.byteLength,
              format: format.slice(1),
              encoding,
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
        if (code === "ENOTDIR") throw new Error("file_reader: a parent path is not a directory.");
        if (code === "ELOOP") throw new Error("file_reader: symlink loop or changed symlink detected.");
        if (code === "EACCES" || code === "EPERM") {
          throw new Error(`file_reader: permission denied reading '${file_path}'.`);
        }
        if (error instanceof Error && error.message.startsWith("file_reader:")) throw error;
        throw new Error(`file_reader: cannot read '${file_path}': ${error instanceof Error ? error.message : String(error)}`);
      }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "file_reader",
    label: "File reader",
    description: "Read project-relative .txt or comma-delimited .csv files up to 1 MiB. Supports strict UTF-8 and BOM-marked UTF-16. CSV uses unique header names and returns columns/rows. Blocks traversal, outside-project symlinks, directories, and binary content. Project root is Pi's working directory.",
    parameters: Type.Object({
      file_path: Type.String({ minLength: 1, description: "File path relative to the project root" }),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, { file_path }, signal, _update, ctx) {
      return readProjectFile(ctx.cwd, file_path, signal);
    },
  }));
}
