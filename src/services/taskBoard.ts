import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { RelayConnectionSettings } from "@/context/RelaySettingsContext";
import { sendChatMessage } from "@/services/relayApi";
import { ChatMessage, TaskItem } from "@/types";

type TaskItemRow = {
  fingerprint: string;
  title: string;
  note: string;
  due_text: string;
  priority: number;
  status: string;
  source: string;
  tags: string;
  created_at: number;
  updated_at: number;
  completed_at: number;
};

type TaskStateRow = {
  value: string;
};

type ExtractedTaskItem = {
  title?: string;
  note?: string;
  dueText?: string;
  priority?: number;
  tags?: string[];
};

type TaskDraftCandidate = {
  title: string;
  note: string;
  dueText?: string;
  priority: number;
  tags: string[];
};

export type TaskContext = {
  summary: string;
  tasks: TaskItem[];
};

const DB_NAME = "nomi_task_board.db";
const SUMMARY_KEY = "task_board_summary";
const MAX_TASK_ITEMS = 160;

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

function shortenText(value: string, maxLength = 180) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function clampPriority(value: number) {
  return Math.max(1, Math.min(5, Math.round(value || 3)));
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

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
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

function splitTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildTaskFingerprint(title: string, note: string, dueText?: string) {
  return `task:${normalizeText([title, note, dueText ?? ""].join("|"))}`;
}

function toTaskItem(row: TaskItemRow): TaskItem {
  return {
    id: row.fingerprint,
    title: row.title,
    note: row.note,
    dueText: row.due_text.trim() || undefined,
    priority: row.priority,
    status: row.status === "done" ? "done" : "open",
    source: row.source,
    tags: parseTags(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
}

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync(DB_NAME);
  }

  const db = await dbPromise;
  if (!schemaReady) {
    schemaReady = db.execAsync(`
      CREATE TABLE IF NOT EXISTS task_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_items (
        fingerprint TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        note TEXT NOT NULL,
        due_text TEXT NOT NULL,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        tags TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS task_items_status_idx
        ON task_items(status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS task_items_updated_at_idx
        ON task_items(updated_at DESC);
    `);
  }

  await schemaReady;
  return db;
}

async function getSummary() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TaskStateRow>(
    "SELECT value FROM task_state WHERE key = ? LIMIT 1",
    [SUMMARY_KEY]
  );
  return row?.value?.trim() ?? "";
}

async function setSummary(summary: string) {
  const db = await getDatabase();
  await db.runAsync(
    `
      INSERT INTO task_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [SUMMARY_KEY, summary.trim(), now()]
  );
}

async function listTaskItems(limit = 200) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TaskItemRow>(
    `
      SELECT
        fingerprint,
        title,
        note,
        due_text,
        priority,
        status,
        source,
        tags,
        created_at,
        updated_at,
        completed_at
      FROM task_items
      ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END,
        priority DESC,
        updated_at DESC
      LIMIT ?
    `,
    [limit]
  );

  return rows.map(toTaskItem);
}

async function upsertTaskItems(items: Array<{
  title: string;
  note: string;
  dueText?: string;
  priority: number;
  status: "open" | "done";
  source: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}>) {
  if (!items.length) {
    return;
  }

  const db = await getDatabase();

  for (const item of items) {
    const title = item.title.trim();
    if (!title) {
      continue;
    }

    const note = item.note.trim();
    const dueText = item.dueText?.trim() || "";
    const fingerprint = buildTaskFingerprint(title, note, dueText);

    await db.runAsync(
      `
        INSERT INTO task_items (
          fingerprint,
          title,
          note,
          due_text,
          priority,
          status,
          source,
          tags,
          created_at,
          updated_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          title = excluded.title,
          note = excluded.note,
          due_text = excluded.due_text,
          priority = MAX(task_items.priority, excluded.priority),
          status = excluded.status,
          source = excluded.source,
          tags = excluded.tags,
          updated_at = excluded.updated_at,
          completed_at = CASE
            WHEN excluded.status = 'done' THEN excluded.completed_at
            ELSE 0
          END
      `,
      [
        fingerprint,
        title,
        note,
        dueText,
        clampPriority(item.priority),
        item.status,
        item.source.trim() || "manual",
        JSON.stringify(item.tags.filter((tag) => tag.trim().length > 0).slice(0, 8)),
        item.createdAt,
        item.updatedAt,
        item.completedAt ?? 0,
      ]
    );
  }

  await cleanupTaskBoard();
}

async function searchRelevantTasks(query: string, limit = 4) {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const items = await listTaskItems(200);
  const normalizedQuery = normalizeText(trimmed);

  return items
    .map((item) => {
      const searchable = normalizeText([item.title, item.note, item.dueText ?? "", item.tags.join(" "), item.source].join(" "));
      let score = item.status === "open" ? 20 : 5;

      if (searchable.includes(normalizedQuery)) {
        score += 35;
      }

      for (const token of normalizedQuery.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter(Boolean)) {
        if (searchable.includes(token)) {
          score += token.length >= 3 ? 5 : 2;
        }
      }

      if (item.dueText) {
        score += 2;
      }

      score += item.priority * 4;
      score += Math.max(0, 12 - Math.floor((now() - item.updatedAt) / 86_400_000));

      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

function buildTaskSummary(tasks: TaskItem[]) {
  const openCount = tasks.filter((item) => item.status === "open").length;
  const doneCount = tasks.length - openCount;

  if (!tasks.length) {
    return "当前没有事项。";
  }

  const parts = [`当前共有 ${openCount} 项待办，${doneCount} 项已完成。`];
  const dueSoon = tasks.find((item) => item.status === "open" && item.dueText);
  if (dueSoon?.dueText) {
    parts.push(`最近一项带截止时间的是：${dueSoon.title}（${dueSoon.dueText}）。`);
  }

  return parts.join(" ");
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

export function shouldCaptureTaskRequest(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const requestPattern = /(?:帮我|请|麻烦|记下|记录|添加|新增|加入|安排|设定|设为|创建|建立|提醒我|帮我提醒|帮我记|帮我加|帮我列)/i;
  const taskPattern = /(?:待办|todo|任务|事项|清单|日程|备忘|提醒)/i;
  return requestPattern.test(trimmed) && taskPattern.test(trimmed);
}

function parseDueText(value?: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

function dedupeTaskItems(items: TaskDraftCandidate[]) {
  const seen = new Set<string>();
  const result: TaskDraftCandidate[] = [];

  for (const item of items) {
    const key = buildTaskFingerprint(item.title, item.note, item.dueText);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildHeuristicTaskDrafts(text: string) {
  const normalized = text.trim();
  if (!shouldCaptureTaskRequest(normalized)) {
    return [];
  }

  const cleaned = normalized
    .replace(/^(帮我|请|麻烦|记下|记录|添加|新增|加入|安排|设定|设为|创建|建立|帮我提醒|提醒我|帮我记|帮我加|帮我列)+/i, "")
    .replace(/^(一个|一条|一个待办|一条待办|一个任务|一条任务|一个事项|一条事项|一条提醒)/i, "")
    .replace(/^(待办|todo|任务|事项|清单|日程|备忘|提醒)([:：\s-]*)/i, "")
    .replace(/^[，,。.!！?？\s-]+/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2) {
    return [];
  }

  return [
    {
      title: shortenText(cleaned, 48),
      note: "",
      priority: 3,
      tags: [],
    },
  ];
}

function sanitizeExtractedTaskItem(item: ExtractedTaskItem): TaskDraftCandidate | null {
  const title = shortenText((item.title ?? "").trim(), 64);
  const note = shortenText((item.note ?? "").trim(), 180);
  const dueText = parseDueText(item.dueText);
  const priority = clampPriority(item.priority ?? 3);
  const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6) : [];

  if (!title || title.length < 2) {
    return null;
  }

  if (title.length > 64) {
    return null;
  }

  const draft: TaskDraftCandidate = {
    title,
    note,
    priority,
    tags,
  };

  if (dueText) {
    draft.dueText = dueText;
  }

  return draft;
}

export async function listAllTaskItems() {
  return listTaskItems(200);
}

export async function getTaskContext(query: string): Promise<TaskContext> {
  const [tasks, summary] = await Promise.all([searchRelevantTasks(query, 4), getSummary()]);
  return {
    summary: summary.trim() || buildTaskSummary(tasks),
    tasks,
  };
}

export async function createTaskItem(next: {
  title: string;
  note: string;
  dueText?: string;
  priority: number;
  tags: string[];
  source: string;
  status?: "open" | "done";
}) {
  const title = next.title.trim();
  if (!title) {
    throw new Error("事项标题不能为空。");
  }

  await upsertTaskItems([
    {
      title,
      note: next.note.trim(),
      dueText: next.dueText?.trim() || "",
      priority: next.priority,
      tags: next.tags,
      source: next.source.trim() || "manual",
      status: next.status ?? "open",
      createdAt: now(),
      updatedAt: now(),
      completedAt: next.status === "done" ? now() : undefined,
    },
  ]);
}

export async function updateTaskItem(
  original: TaskItem,
  next: {
    title: string;
    note: string;
    dueText?: string;
    priority: number;
    tags: string[];
    source: string;
    status: "open" | "done";
  }
) {
  const title = next.title.trim();
  if (!title) {
    throw new Error("事项标题不能为空。");
  }

  const db = await getDatabase();
  const fingerprint = buildTaskFingerprint(title, next.note.trim(), next.dueText?.trim() || "");
  if (fingerprint !== original.id) {
    await db.runAsync("DELETE FROM task_items WHERE fingerprint = ?", [original.id]);
  }

  await upsertTaskItems([
    {
      title,
      note: next.note.trim(),
      dueText: next.dueText?.trim() || "",
      priority: next.priority,
      tags: next.tags,
      source: next.source.trim() || "manual",
      status: next.status,
      createdAt: original.createdAt,
      updatedAt: now(),
      completedAt: next.status === "done" ? original.completedAt ?? now() : undefined,
    },
  ]);
}

export async function setTaskItemStatus(task: TaskItem, status: "open" | "done") {
  await updateTaskItem(task, {
    title: task.title,
    note: task.note,
    dueText: task.dueText ?? "",
    priority: task.priority,
    tags: task.tags,
    source: task.source,
    status,
  });
}

export async function deleteTaskItem(id: string) {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM task_items WHERE fingerprint = ?", [id]);
}

export async function cleanupTaskBoard() {
  const db = await getDatabase();
  const rowsBefore = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM task_items LIMIT 1");
  const countBefore = rowsBefore?.count ?? 0;

  if (countBefore <= MAX_TASK_ITEMS) {
    return {
      deleted: 0,
      remaining: countBefore,
    };
  }

  const excess = countBefore - MAX_TASK_ITEMS;
  const rows = await db.getAllAsync<{ fingerprint: string }>(
    `
      SELECT fingerprint
      FROM task_items
      ORDER BY CASE WHEN status = 'done' THEN 0 ELSE 1 END,
        updated_at ASC,
        created_at ASC
      LIMIT ?
    `,
    [excess]
  );

  let deleted = 0;
  if (rows.length) {
    const result = await db.runAsync(
      `DELETE FROM task_items WHERE fingerprint IN (${buildPlaceholders(rows.length)})`,
      rows.map((row) => row.fingerprint)
    );
    deleted += result.changes ?? 0;
  }

  const rowsAfter = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM task_items LIMIT 1");
  return {
    deleted,
    remaining: rowsAfter?.count ?? 0,
  };
}

export async function clearTaskBoard() {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM task_items");
  await db.runAsync("DELETE FROM task_state WHERE key = ?", [SUMMARY_KEY]);
}

export async function extractTaskCandidates(
  config: RelayConnectionSettings,
  assistantName: string,
  persona: string,
  messages: ChatMessage[]
) {
  const recentDialogue = buildConversationWindow(messages, 8);
  if (!recentDialogue.trim()) {
    return [];
  }

  const content = await sendChatMessage(config, [
    {
      role: "system",
      content:
        "You are a task extractor. Only extract tasks when the user explicitly asks to add, record, remember, schedule, or remind. Ignore casual mentions and generic chat. Output JSON only.",
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
        'Return JSON like: {"items":[{"title":"...","note":"...","dueText":"...","priority":3,"tags":["..."]}]}',
      ].join("\n"),
    },
  ]);

  const parsed = safeParseJson<{ items?: ExtractedTaskItem[] }>(content);
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];

  const sanitizedItems = rawItems
    .map(sanitizeExtractedTaskItem)
    .filter(
      (
        item
      ): item is {
        title: string;
        note: string;
        dueText?: string;
        priority: number;
        tags: string[];
      } => Boolean(item)
    )
    .slice(0, 4);

  return dedupeTaskItems(sanitizedItems);
}

function shouldCaptureTaskRequestSmart(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const requestPattern = /(?:帮我|麻烦|请|顺手|顺便|记一下|记录一下|添加|新增|加入|安排|设为|设成|提醒|帮忙)/i;
  const taskPattern = /(?:待办|todo|任务|事项|清单|日程|备忘|提醒|事项簿)/i;
  return requestPattern.test(trimmed) && taskPattern.test(trimmed);
}

function buildHeuristicTaskDraftsSmart(text: string) {
  const normalized = text.trim();
  if (!shouldCaptureTaskRequestSmart(normalized)) {
    return [];
  }

  const lastUserLine =
    normalized
      .split(/\r?\n/)
      .reverse()
      .find((line) => /^User:\s*/i.test(line)) ?? normalized;
  const source = lastUserLine.replace(/^User:\s*/i, "").trim();

  const cleaned = source
    .replace(/^(帮我|麻烦|请|顺手|顺便|记一下|记录一下|添加|新增|加入|安排|设为|设成|提醒|帮忙)([:：\s-]*)/i, "")
    .replace(/^(待办|todo|任务|事项|清单|日程|备忘|提醒|事项簿)([:：\s-]*)/i, "")
    .replace(/^[，。！？、\s-]+/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2) {
    return [];
  }

  return [
    {
      title: shortenText(cleaned, 48),
      note: "",
      priority: 3,
      tags: [],
    },
  ];
}

export async function extractTaskCandidatesSmart(
  config: RelayConnectionSettings,
  assistantName: string,
  persona: string,
  messages: ChatMessage[]
) {
  const recentDialogue = buildConversationWindow(messages, 8);
  const candidates = await extractTaskCandidates(config, assistantName, persona, messages).catch(() => []);
  return dedupeTaskItems([...candidates, ...buildHeuristicTaskDraftsSmart(recentDialogue)]);
}

export async function refreshTaskBoardAfterReply(
  config: RelayConnectionSettings,
  assistantName: string,
  persona: string,
  messages: ChatMessage[]
) {
  const recentUserMessages = messages.filter((message) => message.role === "user");
  const triggerText = recentUserMessages.length ? recentUserMessages[recentUserMessages.length - 1].content : "";
  if (!shouldCaptureTaskRequestSmart(triggerText)) {
    return;
  }

  const candidates = await extractTaskCandidatesSmart(config, assistantName, persona, messages).catch(() => []);
  if (!candidates.length) {
    return;
  }

  for (const candidate of candidates) {
    await createTaskItem({
      title: candidate.title,
      note: candidate.note ?? "",
      dueText: candidate.dueText,
      priority: candidate.priority ?? 3,
      tags: candidate.tags ?? [],
      source: "conversation",
    });
  }
}
