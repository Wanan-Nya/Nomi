import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { File, Paths } from "expo-file-system";

import { RelayConnectionSettings } from "@/context/RelaySettingsContext";
import { ChatMessage, TaskItem } from "@/types";
import { sendChatMessage } from "@/services/relayApi";

export type MemoryKind = "preference" | "profile" | "project" | "fact";

export type MemoryItem = {
  fingerprint: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  tags: string[];
  source: string;
  createdAt: number;
  updatedAt: number;
};

type MemoryDraft = Omit<MemoryItem, "fingerprint">;

type MemoryItemRow = {
  fingerprint: string;
  kind: string;
  content: string;
  tags: string;
  importance: number;
  source: string;
  created_at: number;
  updated_at: number;
  last_referenced_at: number;
  reference_count: number;
};

type MemoryStateRow = {
  value: string;
};

type ExtractedMemoryItem = {
  kind?: MemoryKind;
  content?: string;
  importance?: number;
  tags?: string[];
};

type MemoryContext = {
  summary: string;
  memories: MemoryItem[];
};

export type MemoryExportPayload = {
  exportedAt: number;
  summary: string;
  items: MemoryItem[];
  stats: {
    total: number;
    byKind: Record<MemoryKind, number>;
  };
};

const DB_NAME = "nomi_long_term_memory.db";
const SUMMARY_KEY = "conversation_summary";
const MEMORY_REFRESH_COUNTER_KEY = "conversation_rounds_since_memory_refresh";
const MEMORY_REFRESH_INTERVAL_ROUNDS = 10;
const MAX_MEMORY_ITEMS = 200;
const CLEANUP_KEEP_AFTER_DAYS = 90;
const CLEANUP_IMPORTANT_AFTER_DAYS = 60;
const CLEANUP_LOW_IMPORTANCE_AFTER_DAYS = 30;

let dbPromise: Promise<SQLiteDatabase> | null = null;
let schemaReady: Promise<void> | null = null;

function now() {
  return Date.now();
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, "")
    .replace(/[.,!?;:/\\|"'`~@#$%^&*=_+\-()[\]{}<>]/g, "");
}

function makeFingerprint(kind: MemoryKind, content: string) {
  return `${kind}:${normalizeText(content)}`;
}

function safeParseJson<T>(value: string): T | null {
  const trimmed = value.trim();
  const candidates = [trimmed];

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function shortenText(value: string, maxLength = 220) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function clampImportance(value: number) {
  return Math.max(1, Math.min(5, Math.round(value || 3)));
}

function normalizeMemoryContent(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[。！？!?；;，,]+$/g, "");
}

function tokenizeComparisonText(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const tokens = new Set<string>();
  const chunks = normalized.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length >= 2) {
      tokens.add(chunk);
    }
  }

  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }

  return [...tokens].slice(0, 48);
}

function similarityScore(left: string, right: string) {
  const normalizedLeft = normalizeMemoryContent(left);
  const normalizedRight = normalizeMemoryContent(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.92;
  }

  const leftTokens = new Set(tokenizeComparisonText(normalizedLeft));
  const rightTokens = new Set(tokenizeComparisonText(normalizedRight));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function chooseMergedMemoryContent(left: string, right: string) {
  const normalizedLeft = normalizeMemoryContent(left);
  const normalizedRight = normalizeMemoryContent(right);

  if (!normalizedLeft) {
    return normalizedRight;
  }

  if (!normalizedRight) {
    return normalizedLeft;
  }

  if (normalizedLeft.includes(normalizedRight)) {
    return normalizedLeft.length >= normalizedRight.length ? normalizedLeft : normalizedRight;
  }

  if (normalizedRight.includes(normalizedLeft)) {
    return normalizedRight.length >= normalizedLeft.length ? normalizedRight : normalizedLeft;
  }

  return normalizedLeft.length >= normalizedRight.length ? normalizedLeft : normalizedRight;
}

function mergeMemoryDrafts(base: MemoryDraft, next: MemoryDraft): MemoryDraft {
  return {
    kind: base.kind,
    content: chooseMergedMemoryContent(base.content, next.content),
    importance: Math.max(clampImportance(base.importance), clampImportance(next.importance)),
    tags: Array.from(new Set([...base.tags, ...next.tags])).slice(0, 6),
    source: base.source || next.source,
    createdAt: Math.min(base.createdAt || now(), next.createdAt || now()),
    updatedAt: now(),
  };
}

function isSimilarMemoryDraft(left: MemoryDraft, right: MemoryDraft) {
  return left.kind === right.kind && similarityScore(left.content, right.content) >= 0.5;
}

function isEphemeralMemoryContent(content: string) {
  const normalized = normalizeMemoryContent(content);
  if (normalized.length < 4 || normalized.length > 120) {
    return true;
  }

  const patterns = [
    /https?:\/\//i,
    /www\./i,
    /@[a-z0-9._-]+\.[a-z]{2,}/i,
    /\b\d{6,}\b/,
    /\b\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,4}\b/,
    /\b\d{1,2}:\d{2}\b/,
    /(?:今天|明天|后天|昨天|刚刚|现在|今晚|本周|下周|本月|临时|暂时)/,
    /(?:待办|todo|任务|事项|提醒|日程|清单)/i,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function dedupeMemoryItems(items: MemoryDraft[]) {
  const result: MemoryDraft[] = [];

  for (const item of items) {
    const content = normalizeMemoryContent(item.content);
    if (!content || isEphemeralMemoryContent(content)) {
      continue;
    }

    const normalizedItem: MemoryDraft = {
      ...item,
      content,
      importance: clampImportance(item.importance),
      tags: Array.from(new Set(item.tags)).slice(0, 6),
    };

    const existingIndex = result.findIndex((candidate) => isSimilarMemoryDraft(candidate, normalizedItem));
    if (existingIndex >= 0) {
      result[existingIndex] = mergeMemoryDrafts(result[existingIndex], normalizedItem);
      continue;
    }

    result.push(normalizedItem);
  }

  return result;
}

function buildMemoryStats(items: MemoryItem[]) {
  const byKind: Record<MemoryKind, number> = {
    preference: 0,
    profile: 0,
    project: 0,
    fact: 0,
  };

  for (const item of items) {
    byKind[item.kind] += 1;
  }

  return {
    total: items.length,
    byKind,
  };
}

function buildRetentionCutoff(days: number) {
  return now() - days * 86_400_000;
}

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync(DB_NAME);
  }

  const db = await dbPromise;
  if (!schemaReady) {
    schemaReady = db.execAsync(`
      CREATE TABLE IF NOT EXISTS memory_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_items (
        fingerprint TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        importance INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_referenced_at INTEGER NOT NULL DEFAULT 0,
        reference_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS memory_items_updated_at_idx
        ON memory_items(updated_at DESC);
    `);
  }

  await schemaReady;
  return db;
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Ignore invalid JSON.
  }

  return [];
}

function toMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    fingerprint: row.fingerprint,
    kind: row.kind as MemoryKind,
    content: row.content,
    importance: row.importance,
    tags: parseTags(row.tags),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeSearchTokens(query: string) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return [];
  }

  const tokens = new Set<string>();
  const chunks = normalized.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter(Boolean);
  for (const chunk of chunks) {
    if (chunk.length >= 2) {
      tokens.add(chunk);
    }
  }

  if (normalized.length >= 2) {
    for (let index = 0; index < normalized.length - 1; index += 1) {
      tokens.add(normalized.slice(index, index + 2));
    }
  }

  if (normalized.length >= 3) {
    for (let index = 0; index < normalized.length - 2; index += 1) {
      tokens.add(normalized.slice(index, index + 3));
    }
  }

  return [...tokens].slice(0, 60);
}

function scoreMemoryItem(query: string, item: MemoryItem) {
  const queryText = normalizeText(query);
  const searchable = normalizeText([item.kind, item.content, item.tags.join(" "), item.source].join(" "));

  let score = item.importance * 10;
  if (queryText && searchable.includes(queryText)) {
    score += 40;
  }

  for (const token of makeSearchTokens(query)) {
    if (searchable.includes(token)) {
      score += token.length >= 3 ? 4 : 2;
    }
  }

  const recencyDays = Math.max(0, Math.floor((now() - item.updatedAt) / 86_400_000));
  score += Math.max(0, 20 - recencyDays);
  return score;
}

async function getSummary() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MemoryStateRow>(
    "SELECT value FROM memory_state WHERE key = ? LIMIT 1",
    [SUMMARY_KEY]
  );
  return row?.value?.trim() ?? "";
}

async function setSummary(summary: string) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT INTO memory_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [SUMMARY_KEY, summary.trim(), now()]
  );
}

async function getMemoryRefreshRounds() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MemoryStateRow>(
    "SELECT value FROM memory_state WHERE key = ? LIMIT 1",
    [MEMORY_REFRESH_COUNTER_KEY]
  );
  return Math.max(0, Number(row?.value ?? 0) || 0);
}

async function setMemoryRefreshRounds(value: number) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT INTO memory_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [MEMORY_REFRESH_COUNTER_KEY, String(Math.max(0, value)), now()]
  );
}

async function listMemoryItems(limit = 200) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MemoryItemRow>(
    `
      SELECT
        fingerprint,
        kind,
        content,
        tags,
        importance,
        source,
        created_at,
        updated_at,
        last_referenced_at,
        reference_count
      FROM memory_items
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    [limit]
  );

  return rows.map(toMemoryItem);
}

async function markMemoryItemsReferenced(fingerprints: string[]) {
  if (!fingerprints.length) {
    return;
  }

  const db = await getDatabase();
  const timestamp = now();
  await db.runAsync(
    `
      UPDATE memory_items
      SET last_referenced_at = ?,
          reference_count = reference_count + 1,
          updated_at = ?
      WHERE fingerprint IN (${buildPlaceholders(fingerprints.length)})
    `,
    [timestamp, timestamp, ...fingerprints]
  );
}

async function deleteMemoryItemsByFingerprints(fingerprints: string[]) {
  if (!fingerprints.length) {
    return;
  }

  const db = await getDatabase();
  await db.runAsync(`DELETE FROM memory_items WHERE fingerprint IN (${buildPlaceholders(fingerprints.length)})`, fingerprints);
}

async function mergeMemoryDraftWithStored(item: MemoryDraft) {
  const existing = await listMemoryItems(MAX_MEMORY_ITEMS);
  const matches = existing
    .filter((candidate) => candidate.kind === item.kind)
    .filter((candidate) => isSimilarMemoryDraft(candidate, item));

  if (!matches.length) {
    return item;
  }

  const merged = matches.reduce<MemoryDraft>(
    (accumulator, candidate) =>
      mergeMemoryDrafts(accumulator, {
        kind: candidate.kind,
        content: candidate.content,
        importance: candidate.importance,
        tags: candidate.tags,
        source: candidate.source,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      }),
    item
  );

  await deleteMemoryItemsByFingerprints(matches.map((candidate) => candidate.fingerprint));
  return merged;
}

async function upsertMemoryItems(items: MemoryDraft[]) {
  if (!items.length) {
    return;
  }

  const db = await getDatabase();
  const timestamp = now();

  for (const item of items) {
    const content = item.content.trim();
    if (!content) {
      continue;
    }

    const mergedDraft = await mergeMemoryDraftWithStored({
      ...item,
      content,
    });
    const fingerprint = makeFingerprint(mergedDraft.kind, mergedDraft.content);
    await db.runAsync(
      `
        INSERT INTO memory_items (
          fingerprint,
          kind,
          content,
          tags,
          importance,
          source,
          created_at,
          updated_at,
          last_referenced_at,
          reference_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          kind = excluded.kind,
          content = excluded.content,
          tags = excluded.tags,
          importance = MAX(memory_items.importance, excluded.importance),
          source = excluded.source,
          updated_at = excluded.updated_at
      `,
      [
        fingerprint,
        mergedDraft.kind,
        mergedDraft.content,
        JSON.stringify(mergedDraft.tags.slice(0, 6)),
        clampImportance(mergedDraft.importance),
        mergedDraft.source,
        mergedDraft.createdAt || timestamp,
        timestamp,
        mergedDraft.updatedAt || timestamp,
        0,
      ]
    );
  }

  await cleanupLongTermMemory();
}

async function searchRelevantMemories(query: string, limit = 5) {
  if (!query.trim()) {
    return [];
  }

  const items = await listMemoryItems(200);
  return items
    .map((item) => ({
      item,
      score: scoreMemoryItem(query, item),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

function buildConversationWindow(messages: ChatMessage[], maxLines = 8) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const attachmentText = message.attachments?.length
        ? `\n${message.attachments
            .map((attachment) => {
              if (attachment.kind === "image") {
                return `[图片] ${attachment.name}`;
              }

              return attachment.text?.trim() ? `[文件] ${attachment.name}\n${attachment.text.trim()}` : `[文件] ${attachment.name}`;
            })
            .join("\n")}`
        : "";

      return `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}${attachmentText}`;
    })
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines)
    .join("\n");
}

function buildMemoryPrompt(summary: string, memories: MemoryItem[]) {
  const parts: string[] = [];

  if (summary.trim()) {
    parts.push(`Long-term summary:\n${summary.trim()}`);
  }

  if (memories.length) {
    parts.push(
      [
        "Relevant memories:",
        ...memories.map((item, index) => {
          const tags = item.tags.length ? ` (tags: ${item.tags.join(", ")})` : "";
          return `${index + 1}. [${item.kind}] ${shortenText(item.content)}${tags}`;
        }),
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}

function buildTaskPrompt(summary: string, tasks: TaskItem[]) {
  const parts: string[] = [];

  if (summary.trim()) {
    parts.push(`Task board summary:\n${summary.trim()}`);
  }

  if (tasks.length) {
    parts.push(
      [
        "Relevant tasks:",
        ...tasks.map((item, index) => {
          const dueText = item.dueText ? ` · ${item.dueText}` : "";
          const note = item.note.trim() ? ` · ${shortenText(item.note, 80)}` : "";
          return `${index + 1}. [${item.status}] ${shortenText(item.title, 60)}${dueText}${note}`;
        }),
      ].join("\n")
    );
  }

  return parts.join("\n\n");
}

export function composeChatSystemPrompt(params: {
  assistantName: string;
  persona: string;
  currentTime: string;
  summary: string;
  memories: MemoryItem[];
  taskSummary: string;
  tasks: TaskItem[];
}) {
  const parts = [
    `You are ${params.assistantName}.`,
    "Always answer in Chinese. Keep the tone natural, clear, and concise.",
    `Current time: ${params.currentTime}`,
    params.persona.trim() ? `Persona: ${params.persona.trim()}` : "",
    buildTaskPrompt(params.taskSummary, params.tasks),
    buildMemoryPrompt(params.summary, params.memories),
    "Only use long-term memory when it is relevant to the current request.",
    "Do not invent details from memory. If memory is unclear, answer based on the current context.",
  ];

  return parts.filter((item) => item.trim().length > 0).join("\n");
}

async function summarizeConversation(
  config: RelayConnectionSettings,
  messages: ChatMessage[],
  currentSummary: string
) {
  const recentDialogue = buildConversationWindow(messages, 20);
  if (!recentDialogue.trim()) {
    return currentSummary.trim();
  }

  const content = await sendChatMessage(config, [
    {
      role: "system",
      content:
        "You are a conversation summarizer. Compress the latest dialogue into a short Chinese summary that can be used later as long-term memory. Keep only stable user preferences, project background, and important facts. Merge repeated or overlapping points into one concise statement. Do not store API keys, passwords, verification codes, or other sensitive data. Output JSON only.",
    },
    {
      role: "user",
      content: [
        `Existing summary: ${currentSummary.trim() || "none"}`,
        "",
        "Recent dialogue:",
        recentDialogue,
        "",
        'Return JSON like: {"summary":"..."}',
      ].join("\n"),
    },
  ]);

  const parsed = safeParseJson<{ summary?: string }>(content);
  const nextSummary = parsed?.summary?.trim();
  return nextSummary ? shortenText(nextSummary, 320) : currentSummary.trim();
}

async function extractMemoryCandidates(
  config: RelayConnectionSettings,
  assistantName: string,
  persona: string,
  messages: ChatMessage[]
) {
  const recentDialogue = buildConversationWindow(messages, 20);
  if (!recentDialogue.trim()) {
    return [];
  }

  const content = await sendChatMessage(config, [
    {
      role: "system",
      content:
        "You are a long-term memory extractor. Extract only stable, reusable information from the latest dialogue. Merge near-duplicate ideas into one item instead of splitting them. Do not store API keys, passwords, verification codes, temporary links, or one-time content. Output JSON only.",
    },
    {
      role: "user",
      content: [
        `AI name: ${assistantName}`,
        `AI persona: ${persona.trim() || "none"}`,
        "",
        "Recent dialogue:",
        recentDialogue,
        "",
        'Return JSON like: {"items":[{"kind":"preference|profile|project|fact","content":"...","importance":1,"tags":["..."]}]}',
      ].join("\n"),
    },
  ]);

  const parsed = safeParseJson<{ items?: ExtractedMemoryItem[] }>(content);
  const items = parsed?.items ?? [];

  return dedupeMemoryItems(
    items
      .filter((item): item is Required<Pick<ExtractedMemoryItem, "kind" | "content">> & ExtractedMemoryItem => {
        return Boolean(item.kind && item.content && item.content.trim().length >= 4);
      })
      .map((item) => ({
        kind: item.kind!,
        content: shortenText(normalizeMemoryContent(item.content!), 180),
        importance: Math.max(1, Math.min(5, Math.round(item.importance || 3))),
        tags: Array.isArray(item.tags)
          ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6)
          : [],
        source: "conversation",
        createdAt: now(),
        updatedAt: now(),
      }))
  );
}

export async function getMemoryContext(query: string) {
  const [memories, summary] = await Promise.all([searchRelevantMemories(query, 5), getSummary()]);
  await markMemoryItemsReferenced(memories.map((item) => item.fingerprint));
  return { summary, memories } satisfies MemoryContext;
}

export async function listAllMemoryItems() {
  return listMemoryItems(200);
}

export async function getMemorySummary() {
  return getSummary();
}

export async function updateMemoryItem(
  original: MemoryItem,
  next: {
    kind: MemoryKind;
    content: string;
    importance: number;
    tags: string[];
    source: string;
  }
) {
  const db = await getDatabase();
  const normalizedContent = next.content.trim();
  if (!normalizedContent) {
    throw new Error("记忆内容不能为空。");
  }

  const draft: MemoryDraft = {
    kind: next.kind,
    content: normalizedContent,
    importance: clampImportance(next.importance),
    tags: next.tags.filter((tag) => tag.trim().length > 0).slice(0, 10),
    source: next.source.trim() || "manual",
    createdAt: original.createdAt,
    updatedAt: now(),
  };

  const fingerprint = makeFingerprint(draft.kind, draft.content);
  if (fingerprint !== original.fingerprint) {
    await db.runAsync("DELETE FROM memory_items WHERE fingerprint = ?", [original.fingerprint]);
  }

  await upsertMemoryItems([draft]);
}

export async function createMemoryItem(next: {
  kind: MemoryKind;
  content: string;
  importance: number;
  tags: string[];
  source: string;
}) {
  const normalizedContent = next.content.trim();
  if (!normalizedContent) {
    throw new Error("记忆内容不能为空。");
  }

  await upsertMemoryItems([
    {
      kind: next.kind,
      content: normalizedContent,
      importance: clampImportance(next.importance),
      tags: next.tags.filter((tag) => tag.trim().length > 0).slice(0, 10),
      source: next.source.trim() || "manual",
      createdAt: now(),
      updatedAt: now(),
    },
  ]);
}

export async function deleteMemoryItem(fingerprint: string) {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM memory_items WHERE fingerprint = ?", [fingerprint]);
}

export async function cleanupLongTermMemory() {
  const db = await getDatabase();
  let deleted = 0;

  const steps = [
    {
      importanceMax: 1,
      cutoff: buildRetentionCutoff(CLEANUP_KEEP_AFTER_DAYS),
    },
    {
      importanceMax: 2,
      cutoff: buildRetentionCutoff(CLEANUP_IMPORTANT_AFTER_DAYS),
    },
    {
      importanceMax: 3,
      cutoff: buildRetentionCutoff(CLEANUP_LOW_IMPORTANCE_AFTER_DAYS),
    },
  ];

  for (const step of steps) {
    const result = await db.runAsync(
      `
        DELETE FROM memory_items
        WHERE importance <= ?
          AND COALESCE(NULLIF(last_referenced_at, 0), updated_at, created_at) < ?
      `,
      [step.importanceMax, step.cutoff]
    );
    deleted += result.changes ?? 0;
  }

  const countRowBeforeTrim = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM memory_items LIMIT 1");
  const countBeforeTrim = countRowBeforeTrim?.count ?? 0;
  if (countBeforeTrim > MAX_MEMORY_ITEMS) {
    const excess = countBeforeTrim - MAX_MEMORY_ITEMS;
    const rows = await db.getAllAsync<{ fingerprint: string }>(
      `
        SELECT fingerprint
        FROM memory_items
        ORDER BY importance ASC,
          COALESCE(NULLIF(last_referenced_at, 0), updated_at, created_at) ASC,
          updated_at ASC
        LIMIT ?
      `,
      [excess]
    );

    if (rows.length) {
      const result = await db.runAsync(
        `DELETE FROM memory_items WHERE fingerprint IN (${buildPlaceholders(rows.length)})`,
        rows.map((row) => row.fingerprint)
      );
      deleted += result.changes ?? 0;
    }
  }

  const remainingRow = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM memory_items LIMIT 1");
  return {
    deleted,
    remaining: remainingRow?.count ?? 0,
  };
}

export async function exportLongTermMemorySnapshot(): Promise<MemoryExportPayload> {
  const [summary, items] = await Promise.all([getSummary(), listMemoryItems(200)]);
  return {
    exportedAt: now(),
    summary,
    items,
    stats: buildMemoryStats(items),
  };
}

export async function exportLongTermMemoryToFile() {
  const payload = await exportLongTermMemorySnapshot();
  const file = new File(Paths.cache, `nomi-memory-export-${payload.exportedAt}.json`);
  file.write(JSON.stringify(payload, null, 2));
  return {
    uri: file.uri,
    payload,
  };
}

export async function refreshLongTermMemoryAfterReply(
  config: RelayConnectionSettings,
  assistantName: string,
  persona: string,
  messages: ChatMessage[]
) {
  const nextRounds = (await getMemoryRefreshRounds()) + 1;
  if (nextRounds < MEMORY_REFRESH_INTERVAL_ROUNDS) {
    await setMemoryRefreshRounds(nextRounds);
    return;
  }

  try {
    const currentSummary = await getSummary();
    const nextSummary = await summarizeConversation(config, messages, currentSummary);
    if (nextSummary.trim() && nextSummary.trim() !== currentSummary.trim()) {
      await setSummary(nextSummary);
    }
    const items = await extractMemoryCandidates(config, assistantName, persona, messages);
    await upsertMemoryItems(items);
    await cleanupLongTermMemory();
    await setMemoryRefreshRounds(0);
  } catch {
    await setMemoryRefreshRounds(MEMORY_REFRESH_INTERVAL_ROUNDS - 1);
  }
}

export async function clearLongTermMemory() {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM memory_items");
  await db.runAsync("DELETE FROM memory_state WHERE key = ?", [SUMMARY_KEY]);
  await db.runAsync("DELETE FROM memory_state WHERE key = ?", [MEMORY_REFRESH_COUNTER_KEY]);
}
