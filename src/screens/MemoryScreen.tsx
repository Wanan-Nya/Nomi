import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getContentUriAsync } from "expo-file-system/legacy";

import { PrimaryButton } from "@/components/PrimaryButton";
import {
  clearLongTermMemory,
  cleanupLongTermMemory,
  createMemoryItem,
  deleteMemoryItem,
  exportLongTermMemoryToFile,
  getMemorySummary,
  listAllMemoryItems,
  updateMemoryItem,
  type MemoryItem,
  type MemoryKind,
} from "@/services/longTermMemory";

type MemoryFilter = "all" | MemoryKind;

type MemoryDraftState = {
  kind: MemoryKind;
  content: string;
  importance: number;
  tagsText: string;
  source: string;
};

type Section = {
  key: string;
  title: string;
  subtitle: string;
  items: MemoryItem[];
};

type Props = {
  onClose: () => void;
};

const kindOptions: Array<{ value: MemoryKind; label: string }> = [
  { value: "preference", label: "偏好" },
  { value: "profile", label: "资料" },
  { value: "project", label: "项目" },
  { value: "fact", label: "事实" },
];

const filterOptions: Array<{ value: MemoryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "preference", label: "偏好" },
  { value: "profile", label: "资料" },
  { value: "project", label: "项目" },
  { value: "fact", label: "事实" },
];

const kindOrder: MemoryKind[] = ["preference", "profile", "project", "fact"];

const emptyDraft: MemoryDraftState = {
  kind: "preference",
  content: "",
  importance: 3,
  tagsText: "",
  source: "manual",
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, "")
    .replace(/[.,!?;:/\\|"'`~@#$%^&*=_+\-()[\]{}<>]/g, "");
}

function splitTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function kindLabel(kind: MemoryKind) {
  return kindOptions.find((item) => item.value === kind)?.label ?? kind;
}

function kindPalette(kind: MemoryKind) {
  switch (kind) {
    case "preference":
      return { badge: "rgba(94,133,255,0.18)", border: "rgba(94,133,255,0.36)", text: "#DDE8FF" };
    case "profile":
      return { badge: "rgba(83,199,155,0.16)", border: "rgba(83,199,155,0.34)", text: "#D8FFF0" };
    case "project":
      return { badge: "rgba(255,176,82,0.16)", border: "rgba(255,176,82,0.34)", text: "#FFE8C8" };
    default:
      return { badge: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.12)", text: "#E8EEFF" };
  }
}

function scoreMemory(item: MemoryItem, query: string) {
  const normalizedQuery = normalizeText(query);
  const searchable = normalizeText([item.kind, item.content, item.tags.join(" "), item.source].join(" "));

  if (!normalizedQuery) {
    return 0;
  }

  let score = 0;
  if (searchable.includes(normalizedQuery)) {
    score += 50;
  }

  const tokens = normalizedQuery.split(/[^a-z0-9\u4e00-\u9fa5]+/i).filter(Boolean);
  for (const token of tokens) {
    if (searchable.includes(token)) {
      score += token.length >= 3 ? 6 : 3;
    }
  }

  score += item.importance * 3;
  score += Math.max(0, 12 - Math.floor((Date.now() - item.updatedAt) / 86_400_000));
  return score;
}

function draftFromItem(item: MemoryItem): MemoryDraftState {
  return {
    kind: item.kind,
    content: item.content,
    importance: item.importance,
    tagsText: item.tags.join(", "),
    source: item.source,
  };
}

const DraftFields = memo(function DraftFields({
  draft,
  onChange,
}: {
  draft: MemoryDraftState;
  onChange: (next: MemoryDraftState) => void;
}) {
  return (
    <View style={styles.draftFields}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>类型</Text>
        <View style={styles.chipRow}>
          {kindOptions.map((item) => {
            const active = draft.kind === item.value;
            return (
              <Pressable
                key={item.value}
                onPress={() => onChange({ ...draft, kind: item.value })}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>内容</Text>
        <TextInput
          value={draft.content}
          onChangeText={(value) => onChange({ ...draft, content: value })}
          placeholder="记忆的具体内容"
          placeholderTextColor="#7E8DAF"
          multiline
          style={[styles.input, styles.multilineInput]}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>重要度</Text>
        <View style={styles.chipRow}>
          {[1, 2, 3, 4, 5].map((item) => {
            const active = draft.importance === item;
            return (
              <Pressable
                key={item}
                onPress={() => onChange({ ...draft, importance: item })}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>标签</Text>
        <TextInput
          value={draft.tagsText}
          onChangeText={(value) => onChange({ ...draft, tagsText: value })}
          placeholder="例如：工作, 偏好, 头像"
          placeholderTextColor="#7E8DAF"
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>来源</Text>
        <TextInput
          value={draft.source}
          onChangeText={(value) => onChange({ ...draft, source: value })}
          placeholder="manual / conversation"
          placeholderTextColor="#7E8DAF"
          style={styles.input}
        />
      </View>
    </View>
  );
});

export function MemoryScreen({ onClose }: Props) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [summary, setSummary] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createDraft, setCreateDraft] = useState<MemoryDraftState>(emptyDraft);
  const [editItem, setEditItem] = useState<MemoryItem | null>(null);
  const [editDraft, setEditDraft] = useState<MemoryDraftState>(emptyDraft);
  const [detailItem, setDetailItem] = useState<MemoryItem | null>(null);
  const [detailMounted, setDetailMounted] = useState(false);
  const detailBackdrop = useRef(new Animated.Value(0)).current;
  const detailSheet = useRef(new Animated.Value(0)).current;
  const deferredQuery = useDeferredValue(query);

  async function loadData(mode: "initial" | "refresh" | "silent" = "silent") {
    setError("");
    setNotice("");

    if (mode === "initial") {
      setLoading(true);
    } else if (mode === "refresh") {
      setRefreshing(true);
    }

    try {
      await cleanupLongTermMemory();
      const [summaryText, rows] = await Promise.all([getMemorySummary(), listAllMemoryItems()]);
      setSummary(summaryText);
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载记忆失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData("initial");
  }, []);

  useEffect(() => {
    if (detailItem) {
      setDetailMounted(true);
      detailBackdrop.setValue(0);
      detailSheet.setValue(0);

      Animated.parallel([
        Animated.timing(detailBackdrop, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.spring(detailSheet, {
          toValue: 1,
          useNativeDriver: true,
          friction: 10,
          tension: 86,
        }),
      ]).start();
      return;
    }

    if (!detailMounted) {
      return;
    }

    Animated.parallel([
      Animated.timing(detailBackdrop, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(detailSheet, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setDetailMounted(false);
      }
    });
  }, [detailBackdrop, detailItem, detailMounted, detailSheet]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeText(deferredQuery);

    return items
      .filter((item) => (filter === "all" ? true : item.kind === filter))
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }

        const searchable = normalizeText([item.kind, item.content, item.tags.join(" "), item.source].join(" "));
        return searchable.includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (!normalizedQuery) {
          return right.updatedAt - left.updatedAt;
        }

        const scoreDiff = scoreMemory(right, query) - scoreMemory(left, query);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return right.updatedAt - left.updatedAt;
      });
  }, [deferredQuery, filter, items]);

  const stats = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.byKind[item.kind] += 1;
        return acc;
      },
      {
        total: 0,
        byKind: {
          preference: 0,
          profile: 0,
          project: 0,
          fact: 0,
        },
      }
    );
  }, [items]);

  const sections = useMemo<Section[]>(() => {
    if (!filteredItems.length) {
      return [];
    }

    if (filter !== "all") {
      return [
        {
          key: filter,
          title: `${kindLabel(filter)}记忆`,
          subtitle: `当前筛选共 ${filteredItems.length} 条`,
          items: filteredItems,
        },
      ];
    }

    const pinned = filteredItems
      .filter((item) => item.importance >= 4)
      .sort((left, right) => right.importance - left.importance || right.updatedAt - left.updatedAt);
    const others = filteredItems.filter((item) => item.importance < 4);

    const result: Section[] = [];

    if (pinned.length) {
      result.push({
        key: "pinned",
        title: "置顶 / 重点",
        subtitle: "重要度 4-5 的记忆会优先出现在这里",
        items: pinned,
      });
    }

    for (const kind of kindOrder) {
      const kindItems = others
        .filter((item) => item.kind === kind)
        .sort((left, right) => right.updatedAt - left.updatedAt);

      if (kindItems.length) {
        result.push({
          key: kind,
          title: `${kindLabel(kind)}记忆`,
          subtitle: `共 ${kindItems.length} 条`,
          items: kindItems,
        });
      }
    }

    return result;
  }, [filter, filteredItems]);

  function resetCreateDraft() {
    setCreateDraft(emptyDraft);
  }

  function startEdit(item: MemoryItem) {
    setEditItem(item);
    setEditDraft(draftFromItem(item));
    setError("");
    setNotice("");
  }

  function closeEdit() {
    setEditItem(null);
    setEditDraft(emptyDraft);
  }

  function openDetail(item: MemoryItem) {
    setDetailItem(item);
  }

  function closeDetail() {
    setDetailItem(null);
  }

  async function handleCreate() {
    if (busy) {
      return;
    }

    const content = createDraft.content.trim();
    if (!content) {
      setError("记忆内容不能为空。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await createMemoryItem({
        kind: createDraft.kind,
        content,
        importance: createDraft.importance,
        tags: splitTags(createDraft.tagsText),
        source: createDraft.source.trim() || "manual",
      });
      resetCreateDraft();
      await loadData("silent");
      setNotice("已添加新记忆");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editItem || busy) {
      return;
    }

    const content = editDraft.content.trim();
    if (!content) {
      setError("记忆内容不能为空。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await updateMemoryItem(editItem, {
        kind: editDraft.kind,
        content,
        importance: editDraft.importance,
        tags: splitTags(editDraft.tagsText),
        source: editDraft.source.trim() || "manual",
      });
      closeEdit();
      await loadData("silent");
      setNotice("记忆已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handlePromote(item: MemoryItem) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await updateMemoryItem(item, {
        kind: item.kind,
        content: item.content,
        importance: 5,
        tags: item.tags,
        source: item.source,
      });
      closeDetail();
      await loadData("silent");
      setNotice("已置顶这条记忆");
    } catch (err) {
      setError(err instanceof Error ? err.message : "置顶失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: MemoryItem) {
    if (busy) {
      return;
    }

    Alert.alert("删除记忆", "确定要删除这条记忆吗？这个操作无法恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError("");
            setNotice("");

            try {
              await deleteMemoryItem(item.fingerprint);
              if (editItem?.fingerprint === item.fingerprint) {
                closeEdit();
              }
              if (detailItem?.fingerprint === item.fingerprint) {
                closeDetail();
              }
              await loadData("silent");
              setNotice("记忆已删除");
            } catch (err) {
              setError(err instanceof Error ? err.message : "删除失败");
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  async function handleExport() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const { uri, payload } = await exportLongTermMemoryToFile();
      const shareUri = Platform.OS === "android" ? await getContentUriAsync(uri) : uri;
      await Share.share({
        title: "导出长期记忆",
        message: `长期记忆导出文件，包含 ${payload.stats.total} 条记忆。`,
        url: shareUri,
      });
      setNotice(`已导出 ${payload.stats.total} 条记忆`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll() {
    if (busy) {
      return;
    }

    Alert.alert("清空全部记忆", "这会删除长期记忆和摘要，无法恢复。确定继续吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await clearLongTermMemory();
              closeEdit();
              closeDetail();
              resetCreateDraft();
              await loadData("silent");
              setNotice("长期记忆已清空");
            } catch (err) {
              setError(err instanceof Error ? err.message : "清空失败");
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData("refresh")} tintColor="#FFFFFF" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <View>
            <Text style={styles.pageTitle}>记忆管理</Text>
            <Text style={styles.pageSubtitle}>查看、搜索、编辑和导出聊天过程中沉淀下来的长期记忆。</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>返回</Text>
          </Pressable>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.title}>长期记忆</Text>
          <Text style={styles.subtitle}>管理聊天自动保存的偏好、资料、项目和事实。</Text>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>总条数</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.byKind.preference}</Text>
              <Text style={styles.statLabel}>偏好</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.byKind.project}</Text>
              <Text style={styles.statLabel}>项目</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>摘要</Text>
          <Text style={styles.summaryText}>{summary.trim() || "当前还没有长期摘要，继续聊天后会自动生成。"}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>快速新增</Text>
          <Text style={styles.helper}>把临时想到的重要内容手动记下来，避免下次还要重新解释。</Text>
          <DraftFields draft={createDraft} onChange={setCreateDraft} />
          <View style={styles.actionRow}>
            <PrimaryButton title="添加记忆" onPress={() => void handleCreate()} loading={busy} style={styles.actionButton} />
            <Pressable onPress={resetCreateDraft} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>重置</Text>
            </Pressable>
          </View>
        </View>

        {editItem && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>编辑记忆</Text>
            <Text style={styles.helper}>当前正在编辑这条记忆，保存后会立即写回本地数据库。</Text>
            <DraftFields draft={editDraft} onChange={setEditDraft} />
            <View style={styles.actionRow}>
              <PrimaryButton title="保存修改" onPress={() => void handleSaveEdit()} loading={busy} style={styles.actionButton} />
              <Pressable onPress={closeEdit} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>取消编辑</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>搜索与筛选</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索内容、标签、来源或类型"
            placeholderTextColor="#7E8DAF"
            style={styles.searchInput}
          />
          <View style={styles.chipRow}>
            {filterOptions.map((item) => {
              const active = filter === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setFilter(item.value)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.actionRow}>
          <PrimaryButton title="导出记忆" onPress={() => void handleExport()} loading={busy} style={styles.actionButton} />
          <PrimaryButton title="清空全部" onPress={() => void handleClearAll()} loading={busy} style={[styles.actionButton, styles.dangerButton]} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>记忆列表</Text>
          <Text style={styles.helper}>
            {filteredItems.length > 0
              ? `当前显示 ${filteredItems.length} 条记忆。点击任意条目可打开详情抽屉。`
              : "没有找到匹配的记忆。"}
          </Text>

          {loading ? <Text style={styles.emptyHint}>正在加载记忆…</Text> : null}

          {sections.length ? (
            <View style={styles.sections}>
              {sections.map((section) => (
                <View key={section.key} style={styles.sectionBlock}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionBlockTitle}>{section.title}</Text>
                      <Text style={styles.sectionBlockSubtitle}>{section.subtitle}</Text>
                    </View>
                    <Text style={styles.sectionCount}>{section.items.length}</Text>
                  </View>

                  <View style={styles.list}>
                    {section.items.map((item) => {
                      const palette = kindPalette(item.kind);
                      return (
                        <Pressable key={item.fingerprint} onPress={() => openDetail(item)} style={styles.itemCard}>
                          <View style={styles.itemHeader}>
                            <View style={[styles.kindBadge, { backgroundColor: palette.badge, borderColor: palette.border }]}>
                              <Text style={[styles.kindBadgeText, { color: palette.text }]}>{kindLabel(item.kind)}</Text>
                            </View>
                            <Text style={styles.timeText}>{formatTime(item.updatedAt)}</Text>
                          </View>

                          <Text style={styles.itemContent}>{item.content}</Text>

                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>重要度 {item.importance}</Text>
                            <Text style={styles.metaText}>{item.source || "manual"}</Text>
                          </View>

                          {item.tags.length ? (
                            <View style={styles.tagRow}>
                              {item.tags.map((tag) => (
                                <View key={`${item.fingerprint}-${tag}`} style={styles.tagPill}>
                                  <Text style={styles.tagText}>{tag}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {error ? (
          <View style={styles.messageBoxError}>
            <Text style={styles.messageTextError}>{error}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={styles.messageBoxSuccess}>
            <Text style={styles.messageTextSuccess}>{notice}</Text>
          </View>
        ) : null}
      </ScrollView>

      {detailMounted && detailItem ? (
        <View style={styles.detailOverlay} pointerEvents="box-none">
          <Animated.View style={[styles.detailBackdrop, { opacity: detailBackdrop }]} pointerEvents="auto">
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDetail} />
          </Animated.View>

          <Animated.View
            style={[
              styles.detailSheet,
              {
                transform: [
                  {
                    translateY: detailSheet.interpolate({
                      inputRange: [0, 1],
                      outputRange: [420, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View style={[styles.kindBadge, kindBadgeStyle(detailItem.kind)]}>
                <Text style={[styles.kindBadgeText, { color: kindPalette(detailItem.kind).text }]}>{kindLabel(detailItem.kind)}</Text>
              </View>
              <Text style={styles.sheetTime}>{formatTime(detailItem.updatedAt)}</Text>
            </View>

            <Text style={styles.sheetTitle}>{detailItem.content}</Text>

            <View style={styles.sheetMetaRow}>
              <Text style={styles.sheetMeta}>重要度：{detailItem.importance}</Text>
              <Text style={styles.sheetMeta}>来源：{detailItem.source || "manual"}</Text>
            </View>
            <View style={styles.sheetMetaRow}>
              <Text style={styles.sheetMeta}>创建：{formatTime(detailItem.createdAt)}</Text>
              <Text style={styles.sheetMeta}>更新：{formatTime(detailItem.updatedAt)}</Text>
            </View>

            {detailItem.tags.length ? (
              <View style={styles.tagRow}>
                {detailItem.tags.map((tag) => (
                  <View key={`detail-${detailItem.fingerprint}-${tag}`} style={styles.tagPill}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.sheetActions}>
              <PrimaryButton title="编辑" onPress={() => {
                startEdit(detailItem);
                closeDetail();
              }} style={styles.sheetButton} />
              <PrimaryButton
                title={detailItem.importance >= 5 ? "已置顶" : "置顶"}
                onPress={() => void handlePromote(detailItem)}
                loading={busy}
                disabled={detailItem.importance >= 5}
                style={[styles.sheetButton, styles.sheetPromoteButton]}
              />
            </View>
            <View style={styles.sheetActions}>
              <PrimaryButton
                title="删除"
                onPress={() => void handleDelete(detailItem)}
                loading={busy}
                style={[styles.sheetButton, styles.sheetDangerButton]}
              />
              <Pressable onPress={closeDetail} style={styles.sheetGhostButton}>
                <Text style={styles.sheetGhostButtonText}>关闭</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

function kindBadgeStyle(kind: MemoryKind) {
  const palette = kindPalette(kind);
  return {
    backgroundColor: palette.badge,
    borderColor: palette.border,
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 28,
    gap: 12,
  },
  headerCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  pageTitle: {
    color: "#F5F7FF",
    fontSize: 24,
    fontWeight: "900",
  },
  pageSubtitle: {
    marginTop: 4,
    color: "#A7B6D8",
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 240,
  },
  closeButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  closeButtonText: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "800",
  },
  heroCard: {
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  title: {
    color: "#F5F7FF",
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: "#A7B6D8",
    fontSize: 13,
    lineHeight: 19,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statItem: {
    flex: 1,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(8,16,32,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  statLabel: {
    color: "#9FB0D4",
    fontSize: 12,
    marginTop: 2,
  },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  sectionTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
  },
  helper: {
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 18,
  },
  summaryText: {
    color: "#D8E3FF",
    fontSize: 13,
    lineHeight: 19,
  },
  draftFields: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
  },
  searchInput: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    color: "#F7FAFF",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  input: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(8, 16, 32, 0.95)",
    color: "#F7FAFF",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  chipActive: {
    backgroundColor: "#5E85FF",
    borderColor: "#5E85FF",
  },
  chipText: {
    color: "#A9B7D6",
    fontSize: 12,
    fontWeight: "700",
  },
  chipTextActive: {
    color: "#FFFFFF",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
  },
  dangerButton: {
    backgroundColor: "#D96C74",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  secondaryButtonText: {
    color: "#DCE6FF",
    fontSize: 15,
    fontWeight: "800",
  },
  sections: {
    gap: 12,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionBlockTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionBlockSubtitle: {
    color: "#8FA0C4",
    fontSize: 12,
    marginTop: 3,
  },
  sectionCount: {
    color: "#8FA0C4",
    fontSize: 12,
    fontWeight: "700",
  },
  list: {
    gap: 10,
  },
  itemCard: {
    gap: 10,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(8, 16, 32, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  kindBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  kindBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  timeText: {
    color: "#8FA0C4",
    fontSize: 11,
  },
  itemContent: {
    color: "#F7FAFF",
    fontSize: 14,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metaText: {
    color: "#A9B7D6",
    fontSize: 12,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tagText: {
    color: "#DCE6FF",
    fontSize: 11,
    fontWeight: "700",
  },
  emptyHint: {
    color: "#8FA0C4",
    fontSize: 13,
    lineHeight: 19,
  },
  messageBoxError: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255, 92, 92, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 92, 0.35)",
  },
  messageTextError: {
    color: "#FFB4B4",
    fontSize: 13,
    lineHeight: 18,
  },
  messageBoxSuccess: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.3)",
  },
  messageTextSuccess: {
    color: "#B9F6CE",
    fontSize: 13,
    lineHeight: 18,
  },
  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    justifyContent: "flex-end",
  },
  detailBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3, 8, 18, 0.54)",
  },
  detailSheet: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#0E1730",
    borderTopWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.24)",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  sheetTime: {
    color: "#8FA0C4",
    fontSize: 11,
  },
  sheetTitle: {
    marginTop: 10,
    color: "#F7FAFF",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 26,
  },
  sheetMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },
  sheetMeta: {
    flex: 1,
    color: "#A9B7D6",
    fontSize: 12,
    lineHeight: 18,
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  sheetButton: {
    flex: 1,
  },
  sheetPromoteButton: {
    backgroundColor: "#5E85FF",
  },
  sheetDangerButton: {
    backgroundColor: "rgba(255, 108, 122, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(255, 108, 122, 0.38)",
  },
  sheetGhostButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  sheetGhostButtonText: {
    color: "#DCE6FF",
    fontSize: 15,
    fontWeight: "800",
  },
});
