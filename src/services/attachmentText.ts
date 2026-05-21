import JSZip from "jszip";
import { File } from "expo-file-system";
import { extractText, getDocumentProxy } from "unpdf";
import XLSX from "xlsx";

const MAX_ATTACHMENT_TEXT_LENGTH = 24_000;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "xml",
  "html",
  "htm",
  "yml",
  "yaml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "py",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "rs",
  "go",
  "php",
  "swift",
  "kt",
  "kts",
  "sh",
  "bash",
  "zsh",
  "ini",
  "toml",
  "log",
  "sql",
  "srt",
  "vtt",
  "rtf",
]);

const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "dot",
  "dotx",
  "xls",
  "xlsx",
  "xlt",
  "xltx",
  "ppt",
  "pptx",
  "pps",
  "ppsx",
  "odt",
  "ods",
  "odp",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

type AttachmentSource = {
  uri: string;
  name: string;
  mimeType: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase();
}

function getExtension(name: string) {
  const match = /\.([^.\\/:]+)$/.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function collapseWhitespace(text: string) {
  return normalizeLineEndings(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function truncateText(text: string) {
  const normalized = collapseWhitespace(text);
  if (normalized.length <= MAX_ATTACHMENT_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_ATTACHMENT_TEXT_LENGTH)}\n\n[内容已截断，原文过长]`;
}

function base64ToUint8Array(base64: string) {
  const trimmed = base64.trim();
  if (!trimmed) {
    return new Uint8Array();
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const buffer = (globalThis as { Buffer?: { from: (value: string, encoding: string) => ArrayBufferView } }).Buffer;
  if (buffer?.from) {
    const nodeBuffer = buffer.from(trimmed, "base64");
    return new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
  }

  throw new Error("无法解码附件内容。");
}

async function readFileText(uri: string) {
  try {
    return await new File(uri).text();
  } catch {
    return "";
  }
}

async function readFileBase64(uri: string) {
  try {
    return await new File(uri).base64();
  } catch {
    return "";
  }
}

function stripHtmlToText(html: string) {
  return collapseWhitespace(
    normalizeLineEndings(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|table|section|article|header|footer|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function stripRtfToText(rtf: string) {
  let text = normalizeLineEndings(rtf);
  text = text.replace(/\{\\\*?[\s\S]*?\}/g, " ");
  text = text.replace(/\\par[d]?/gi, "\n");
  text = text.replace(/\\tab/gi, "\t");
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(Number.parseInt(match.slice(2), 16)));
  text = text.replace(/\\[a-zA-Z]+\d* ?/g, " ");
  text = text.replace(/[{}]/g, " ");
  return collapseWhitespace(decodeXmlEntities(text));
}

function isTextLikeFile(name: string, mimeType: string) {
  const ext = getExtension(name);
  const mime = normalizeMimeType(mimeType);

  if (mime.startsWith("text/")) {
    return true;
  }

  if (mime === "application/json" || mime === "application/xml" || mime === "application/xhtml+xml" || mime === "application/rtf") {
    return true;
  }

  return TEXT_EXTENSIONS.has(ext);
}

function isPdfFile(name: string, mimeType: string) {
  const ext = getExtension(name);
  const mime = normalizeMimeType(mimeType);
  return PDF_EXTENSIONS.has(ext) || mime === "application/pdf";
}

function isOfficeFile(name: string, mimeType: string) {
  const ext = getExtension(name);
  const mime = normalizeMimeType(mimeType);
  if (OFFICE_EXTENSIONS.has(ext)) {
    return true;
  }

  return (
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.oasis.opendocument.text" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet" ||
    mime === "application/vnd.oasis.opendocument.presentation"
  );
}

function isZipLikeOfficeFile(name: string, mimeType: string) {
  const ext = getExtension(name);
  const mime = normalizeMimeType(mimeType);
  return ext === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed";
}

async function extractPdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const data = await extractText(pdf, {
    mergePages: true,
  });

  return truncateText(String(data?.text ?? ""));
}

function normalizeSheetText(rows: unknown[][]) {
  const lines = rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) {
            return "";
          }

          return collapseWhitespace(String(cell));
        })
        .join("\t")
        .trim()
    )
    .filter(Boolean);

  return truncateText(lines.join("\n"));
}

async function extractSpreadsheetText(bytes: Uint8Array) {
  const workbook = XLSX.read(bytes, { type: "array" });
  const chunks: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    const sheetText = normalizeSheetText(rows);
    if (sheetText) {
      chunks.push(`[${sheetName}]\n${sheetText}`);
    }
  }

  return truncateText(chunks.join("\n\n"));
}

function extractTextFromXml(xml: string) {
  return decodeXmlEntities(
    normalizeLineEndings(xml)
      .replace(/<\?xml[\s\S]*?\?>/g, " ")
      .replace(/<\/(w:p|w:tr|a:p|text:p|text:h|text:list-item|table:table-row|table:table-cell|p|tr|li|div)>/gi, "\n")
      .replace(/<w:tab\s*\/>/gi, "\t")
      .replace(/<w:br\s*\/>/gi, "\n")
      .replace(/<a:br\s*\/>/gi, "\n")
      .replace(/<text:line-break\s*\/>/gi, "\n")
      .replace(/<text:tab\s*\/>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
  );
}

function getZipEntryNames(zip: JSZip, patterns: RegExp[]) {
  return Object.keys(zip.files)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .sort((a, b) => a.localeCompare(b));
}

function extractPrintableStrings(bytes: Uint8Array) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const asciiChunks = utf8.match(/[A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af][A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af ,.;:!?'"()\-_/+=@#&%$]{3,}/g) ?? [];

  const utf16leText = (() => {
    try {
      return new TextDecoder("utf-16le", { fatal: false }).decode(new Uint8Array(bytes));
    } catch {
      return "";
    }
  })();
  const utf16Chunks = utf16leText.match(/[A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af][A-Za-z0-9\u4e00-\u9fff\u3000-\u303f\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af ,.;:!?'"()\-_/+=@#&%$]{3,}/g) ?? [];

  return truncateText([...asciiChunks, ...utf16Chunks].join("\n"));
}

async function extractZipFallback(bytes: Uint8Array, name: string, mimeType: string) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const ext = getExtension(name);
    const mime = normalizeMimeType(mimeType);
    const chunks: string[] = [];

    const officeXmlFiles = getZipEntryNames(zip, [
      /^word\/document\.xml$/i,
      /^word\/header\d+\.xml$/i,
      /^word\/footer\d+\.xml$/i,
      /^word\/footnotes\.xml$/i,
      /^word\/endnotes\.xml$/i,
      /^word\/comments\.xml$/i,
      /^ppt\/slides\/slide\d+\.xml$/i,
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/i,
      /^xl\/worksheets\/sheet\d+\.xml$/i,
      /^xl\/sharedStrings\.xml$/i,
      /^content\.xml$/i,
    ]);

    const sharedStringsFile = zip.file("xl/sharedStrings.xml");
    let sharedStrings: string[] = [];
    if (sharedStringsFile) {
      const sharedStringsXml = await sharedStringsFile.async("string");
      sharedStrings = Array.from(sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/gi)).map((match) => truncateText(extractTextFromXml(match[0])));
    }

    for (const fileName of officeXmlFiles) {
      const file = zip.file(fileName);
      if (!file) {
        continue;
      }

      const xml = await file.async("string");

      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(fileName)) {
        const rows = Array.from(xml.matchAll(/<row\b[\s\S]*?<\/row>/gi));
        const rowTexts: string[] = [];

        for (const row of rows) {
          const cellTexts: string[] = [];
          const cells = Array.from(row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi));

          for (const cell of cells) {
            const attrs = cell[1];
            const body = cell[2];
            const typeMatch = /\bt="([^"]+)"/i.exec(attrs);
            const cellType = typeMatch?.[1] ?? "";
            let value = "";

            if (cellType === "s") {
              const sharedIndexMatch = /<v>\s*([^<]+)\s*<\/v>/i.exec(body);
              const sharedIndex = sharedIndexMatch ? Number.parseInt(sharedIndexMatch[1], 10) : Number.NaN;
              value = Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "";
            } else if (cellType === "inlineStr") {
              const inlineMatch = /<is\b[\s\S]*?<\/is>/i.exec(body);
              value = inlineMatch ? extractTextFromXml(inlineMatch[0]) : "";
            } else {
              const rawValueMatch = /<v>\s*([\s\S]*?)\s*<\/v>/i.exec(body) ?? /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(body);
              value = rawValueMatch ? decodeXmlEntities(rawValueMatch[1]) : "";
            }

            const normalized = truncateText(value);
            if (normalized) {
              cellTexts.push(normalized);
            }
          }

          if (cellTexts.length) {
            rowTexts.push(cellTexts.join("\t"));
          }
        }

        if (rowTexts.length) {
          chunks.push(`[${fileName.replace(/^.*\/([^/]+)\.xml$/i, "$1")}]\n${rowTexts.join("\n")}`);
        }
        continue;
      }

      const text = truncateText(extractTextFromXml(xml));
      if (text) {
        chunks.push(text);
      }
    }

    if (chunks.length) {
      return truncateText(chunks.join("\n\n"));
    }

    if (isZipLikeOfficeFile(name, mime)) {
      return extractPrintableStrings(bytes);
    }

    return "";
  } catch {
    return "";
  }
}

export function canExtractAttachmentText(name: string, mimeType: string) {
  return isTextLikeFile(name, mimeType) || isPdfFile(name, mimeType) || isOfficeFile(name, mimeType) || isZipLikeOfficeFile(name, mimeType);
}

export async function extractAttachmentText(source: AttachmentSource) {
  const normalizedMime = normalizeMimeType(source.mimeType);
  const ext = getExtension(source.name);

  try {
    if (isTextLikeFile(source.name, source.mimeType)) {
      const rawText = await readFileText(source.uri);
      if (!rawText) {
        return "";
      }

      if (ext === "html" || ext === "htm" || normalizedMime === "application/xhtml+xml") {
        return truncateText(stripHtmlToText(rawText));
      }

      if (ext === "rtf" || normalizedMime === "application/rtf" || normalizedMime === "application/x-rtf") {
        return truncateText(stripRtfToText(rawText));
      }

      return truncateText(rawText);
    }

    const base64 = await readFileBase64(source.uri);
    if (!base64) {
      return "";
    }

    const bytes = base64ToUint8Array(base64);

    if (isPdfFile(source.name, source.mimeType)) {
      return extractPdfText(bytes);
    }

    if (ext === "xls" || ext === "xlsx" || ext === "xlt" || ext === "xltx" || ext === "ods" || normalizedMime === "application/vnd.ms-excel" || normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      try {
        const spreadsheet = await extractSpreadsheetText(bytes);
        if (spreadsheet) {
          return spreadsheet;
        }
      } catch {
        // Fall through to office parser / zip fallback.
      }
    }

    if (isOfficeFile(source.name, source.mimeType)) {
      const zipFallback = await extractZipFallback(bytes, source.name, source.mimeType);
      if (zipFallback) {
        return zipFallback;
      }
    }

    if (isZipLikeOfficeFile(source.name, source.mimeType)) {
      const zipFallback = await extractZipFallback(bytes, source.name, source.mimeType);
      if (zipFallback) {
        return zipFallback;
      }
    }

    return extractPrintableStrings(bytes);
  } catch {
    return "";
  }
}
