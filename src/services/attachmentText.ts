import JSZip from "jszip";
import { File } from "expo-file-system";

const MAX_ATTACHMENT_TEXT_LENGTH = 12_000;

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

const OFFICE_XML_EXTENSIONS = new Set(["docx", "pptx", "xlsx", "odt", "odp", "ods"]);

type AttachmentSource = {
  uri: string;
  name: string;
  mimeType: string;
};

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase();
}

function getFileExtension(name: string) {
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

function extractTextNodeContent(xml: string) {
  return decodeXmlEntities(
    normalizeLineEndings(xml)
      .replace(/<\?xml[\s\S]*?\?>/g, " ")
      .replace(/<\/(w:p|w:tr|a:p|text:p|text:h|text:list-item|div|p|tr)>/gi, "\n")
      .replace(/<w:tab\s*\/>/gi, "\t")
      .replace(/<w:br\s*\/>/gi, "\n")
      .replace(/<w:cr\s*\/>/gi, "\n")
      .replace(/<a:br\s*\/>/gi, "\n")
      .replace(/<text:line-break\s*\/>/gi, "\n")
      .replace(/<text:tab\s*\/>/gi, "\t")
      .replace(/<[^>]+>/g, " ")
  );
}

function stripHtmlToText(html: string) {
  return collapseWhitespace(
    normalizeLineEndings(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|table|section|article|header|footer|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
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
  const ext = getFileExtension(name);
  const mime = normalizeMimeType(mimeType);

  if (mime.startsWith("text/")) {
    return true;
  }

  if (mime === "application/json" || mime === "application/xml" || mime === "application/xhtml+xml") {
    return true;
  }

  return TEXT_EXTENSIONS.has(ext);
}

function isOfficeXmlFile(name: string, mimeType: string) {
  const ext = getFileExtension(name);
  const mime = normalizeMimeType(mimeType);

  if (OFFICE_XML_EXTENSIONS.has(ext)) {
    return true;
  }

  return (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.oasis.opendocument.text" ||
    mime === "application/vnd.oasis.opendocument.presentation" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet"
  );
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

function getZipEntryNames(zip: JSZip, patterns: RegExp[]) {
  return Object.keys(zip.files)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .sort((a, b) => a.localeCompare(b));
}

function extractSharedStrings(xml: string) {
  const sharedStrings: string[] = [];
  const matchPattern = /<si\b[\s\S]*?<\/si>/gi;
  for (const match of xml.match(matchPattern) ?? []) {
    const value = truncateText(extractTextNodeContent(match));
    if (value) {
      sharedStrings.push(value);
    }
  }
  return sharedStrings;
}

function extractSpreadsheetText(xml: string, sharedStrings: string[]) {
  const rows: string[] = [];
  const rowPattern = /<row\b[\s\S]*?<\/row>/gi;
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;

  for (const row of xml.match(rowPattern) ?? []) {
    const cells: string[] = [];
    cellPattern.lastIndex = 0;

    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(row))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const typeMatch = /\bt="([^"]+)"/i.exec(attrs);
      const cellType = typeMatch?.[1] ?? "";
      let value = "";

      if (cellType === "s") {
        const sharedIndexMatch = /<v>\s*([^<]+)\s*<\/v>/i.exec(body);
        const sharedIndex = sharedIndexMatch ? Number.parseInt(sharedIndexMatch[1], 10) : Number.NaN;
        value = Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "";
      } else if (cellType === "inlineStr") {
        const inlineMatch = /<is\b[\s\S]*?<\/is>/i.exec(body);
        value = inlineMatch ? extractTextNodeContent(inlineMatch[0]) : "";
      } else if (cellType === "b") {
        value = /<v>\s*1\s*<\/v>/i.test(body) ? "TRUE" : "FALSE";
      } else {
        const rawValueMatch = /<v>\s*([\s\S]*?)\s*<\/v>/i.exec(body) ?? /<t\b[^>]*>([\s\S]*?)<\/t>/i.exec(body);
        value = rawValueMatch ? decodeXmlEntities(rawValueMatch[1]) : "";
      }

      const trimmed = truncateText(value);
      if (trimmed) {
        cells.push(trimmed);
      }
    }

    if (cells.length) {
      rows.push(cells.join("\t"));
    }
  }

  return truncateText(rows.join("\n"));
}

async function extractXmlFilesFromZip(zip: JSZip, patterns: RegExp[]) {
  const fileNames = getZipEntryNames(zip, patterns);
  const chunks: string[] = [];

  for (const fileName of fileNames) {
    const file = zip.file(fileName);
    if (!file) {
      continue;
    }

    const xml = await file.async("string");
    const text = truncateText(extractTextNodeContent(xml));
    if (text) {
      chunks.push(text);
    }
  }

  return truncateText(chunks.join("\n\n"));
}

async function extractOfficeText(uri: string, name: string, mimeType: string) {
  const base64 = await readFileBase64(uri);
  if (!base64) {
    return "";
  }

  const zip = await JSZip.loadAsync(base64, { base64: true });
  const ext = getFileExtension(name);
  const normalizedMime = normalizeMimeType(mimeType);

  if (ext === "xlsx" || normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "ods") {
    const sharedStringsFile =
      zip.file("xl/sharedStrings.xml") ??
      zip.file("content.xml");
    const sharedStrings = sharedStringsFile ? extractSharedStrings(await sharedStringsFile.async("string")) : [];
    const sheetFiles = getZipEntryNames(zip, [/^xl\/worksheets\/sheet\d+\.xml$/i, /^content\.xml$/i]);
    const sheetChunks: string[] = [];

    for (const fileName of sheetFiles) {
      const file = zip.file(fileName);
      if (!file) {
        continue;
      }

      const xml = await file.async("string");
      if (fileName.toLowerCase().endsWith("content.xml")) {
        const text = truncateText(extractTextNodeContent(xml));
        if (text) {
          sheetChunks.push(text);
        }
        continue;
      }

      const text = extractSpreadsheetText(xml, sharedStrings);
      if (text) {
        sheetChunks.push(text);
      }
    }

    return truncateText(sheetChunks.join("\n\n"));
  }

  if (ext === "pptx" || normalizedMime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || ext === "odp") {
    return extractXmlFilesFromZip(zip, [/^ppt\/slides\/slide\d+\.xml$/i, /^ppt\/notesSlides\/notesSlide\d+\.xml$/i, /^content\.xml$/i]);
  }

  if (ext === "docx" || normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "odt") {
    return extractXmlFilesFromZip(zip, [
      /^word\/document\.xml$/i,
      /^word\/header\d+\.xml$/i,
      /^word\/footer\d+\.xml$/i,
      /^word\/footnotes\.xml$/i,
      /^word\/endnotes\.xml$/i,
      /^word\/comments\.xml$/i,
      /^content\.xml$/i,
    ]);
  }

  return "";
}

export function canExtractAttachmentText(name: string, mimeType: string) {
  return isTextLikeFile(name, mimeType) || isOfficeXmlFile(name, mimeType);
}

export async function extractAttachmentText(source: AttachmentSource) {
  const normalizedMime = normalizeMimeType(source.mimeType);
  const ext = getFileExtension(source.name);

  try {
    if (isTextLikeFile(source.name, source.mimeType)) {
      const rawText = await readFileText(source.uri);
      if (!rawText) {
        return "";
      }

      if (ext === "html" || ext === "htm") {
        return truncateText(stripHtmlToText(rawText));
      }

      if (ext === "rtf" || normalizedMime === "application/rtf" || normalizedMime === "application/x-rtf") {
        return truncateText(stripRtfToText(rawText));
      }

      return truncateText(rawText);
    }

    if (isOfficeXmlFile(source.name, source.mimeType)) {
      return await extractOfficeText(source.uri, source.name, source.mimeType);
    }

    return "";
  } catch {
    return "";
  }
}
