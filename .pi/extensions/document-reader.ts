import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;
const PDF_SCRIPT = `
import Foundation
import PDFKit
func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(message.utf8))
  exit(1)
}
let args = CommandLine.arguments
 guard args.count >= 2 else { fail("Missing PDF path.") }
 guard let document = PDFDocument(url: URL(fileURLWithPath: args[1])) else { fail("Invalid or unreadable PDF.") }
 guard !document.isLocked else { fail("Password-protected PDF is locked.") }
let total = document.pageCount
let count = min(total, 200)
var text = ""
var truncated = total > count
for index in 0..<count {
  let page = document.page(at: index)?.string ?? ""
  let remaining = 200000 - text.count
  if remaining <= 0 { truncated = true; break }
  text += String((page + "\\n").prefix(remaining))
  if page.count + 1 > remaining { truncated = true; break }
}
let result: [String: Any] = ["text": text, "pageCount": total, "extractionTruncated": truncated]
guard let data = try? JSONSerialization.data(withJSONObject: result) else { fail("Cannot encode PDF text.") }
FileHandle.standardOutput.write(data)
`;

type PdfResult = { text: string; pageCount: number; extractionTruncated: boolean };

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "document_reader",
    label: "Document reader",
    description: "Extract text from project-relative .docx and .pdf files on macOS, using system textutil and Swift/PDFKit (no npm packages). Maximum 20 MiB input; PDF extraction limited to 200 pages/200,000 characters. Returns text and metadata, not formatting or images. Scanned PDFs need OCR and locked PDFs are not supported. Blocks traversal and outside-project symlinks. May require installed Apple command-line developer tools for Swift.",
    parameters: Type.Object({
      file_path: Type.String({ minLength: 1, description: "Project-relative .docx or .pdf path" }),
      max_characters: Type.Optional(Type.Integer({ minimum: 100, maximum: 100000, description: "Maximum returned characters; default 20000" })),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, { file_path, max_characters = 20000 }, signal, _update, ctx) {
      try {
        signal?.throwIfAborted();
        if (!file_path || isAbsolute(file_path) || win32.isAbsolute(file_path) || file_path.includes("\0") || file_path.split(/[\\/]/).includes("..")) {
          throw new Error("Use a project-relative path without '..' or null bytes.");
        }
        if (file_path.split(/[\\/]/).some(part => part === ".git" || part === ".env" || part.startsWith(".env."))) {
          throw new Error("Reading .git or .env paths is blocked.");
        }
        const root = await realpath(ctx.cwd);
        const path = await realpath(resolve(root, file_path));
        const rel = relative(root, path);
        if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("File is outside the project directory.");
        const info = await stat(path);
        if (info.isDirectory()) throw new Error("Path is a directory, not a document.");
        if (!info.isFile()) throw new Error("Path is not a regular file.");
        if (info.size > MAX_BYTES) throw new Error("Document exceeds the 20 MiB size limit.");
        const format = extname(file_path).toLowerCase();
        if (format !== ".docx" && format !== ".pdf") throw new Error("Only .docx and .pdf documents are supported.");
        if (process.platform !== "darwin") throw new Error("This reader requires macOS system tools (textutil and PDFKit).");
        const options = { cwd: root, signal, timeout: 60000, maxBuffer: 2 * 1024 * 1024 };
        let text: string;
        let pageCount: number | undefined;
        let extractionTruncated = false;
        if (format === ".docx") {
          const result = await execFileAsync("/usr/bin/textutil", ["-convert", "txt", "-stdout", "-encoding", "UTF-8", "-noload", "-nostore", path], options);
          text = result.stdout;
        } else {
          const result = await execFileAsync("/usr/bin/swift", ["-e", PDF_SCRIPT, path], options);
          const parsed = JSON.parse(result.stdout) as PdfResult;
          if (typeof parsed.text !== "string" || typeof parsed.pageCount !== "number") throw new Error("Unexpected PDF extraction output.");
          text = parsed.text;
          pageCount = parsed.pageCount;
          extractionTruncated = parsed.extractionTruncated;
        }
        if (!text.trim()) throw new Error(format === ".pdf"
          ? "No readable text found; this PDF may be scanned and require OCR."
          : "Document has no readable text.");
        const details = {
          requestedPath: file_path, resolvedPath: path, sizeBytes: info.size,
          format: format.slice(1), encoding: "utf-8", pageCount,
          extractedCharacters: text.length,
          truncated: extractionTruncated || text.length > max_characters,
        };
        return {
          content: [{ type: "text", text: text.slice(0, max_characters) + (details.truncated ? "\n[Document text shortened.]" : "") }],
          details,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const failure = error as NodeJS.ErrnoException & { stderr?: string; killed?: boolean };
        const message = failure.code === "ENOENT" ? "File or required system tool does not exist."
          : failure.code === "EACCES" || failure.code === "EPERM" ? "Permission denied reading the document."
          : failure.killed ? "Document extraction timed out after 60 seconds."
          : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "Extracted text exceeds the 2 MiB output limit."
          : failure.stderr?.trim() || (error instanceof Error ? error.message : String(error));
        throw new Error(`document_reader: ${message}`);
      }
    },
  }));
}
