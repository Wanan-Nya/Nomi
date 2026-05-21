import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useScrollChromeReporter, type ScrollChromeState } from "@/hooks/useScrollChromeReporter";
import {
  cleanupTaskBoard,
  createTaskItem,
  deleteTaskItem,
  listAllTaskItems,
  setTaskItemStatus,
  updateTaskItem,
} from "@/services/taskBoard";
import { TaskItem } from "@/types";

type Filter = "all" | "open" | "done";

type DraftState = {
  title: string;
  note: string;
  dueText: string;
  tagsText: string;
  priority: number;
  status: "open" | "done";
};

type Props = {
  onClose: () => void;
  onScrollState?: (state: ScrollChromeState) => void;
};

const emptyDraft: DraftState = {
  title: "",
  note: "",
  dueText: "",
  tagsText: "",
  priority: 3,
  status: "open",
};

const filterOptions: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "open", label: "待办" },
  { value: "done", label: "已完成" },
];

function splitTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function taskStatusLabel(status: "open" | "done") {
  return status === "open" ? "待办" : "已完成";
}

function taskCardPalette(status: "open" | "done") {
  return status === "done"
    ? { badge: "rgba(83,199,155,0.16)", border: "rgba(83,199,155,0.32)", text: "#D8FFF0" }
    : { badge: "rgba(94,133,255,0.18)", border: "rgba(94,133,255,0.34)", text: "#DDE8FF" };
}

function TaskCard({
  item,
  selected,
  onLongPress,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: TaskItem;
  selected: boolean;
  onLongPress: (item: TaskItem) => void;
  onToggle: (item: TaskItem) => void;
  onEdit: (item: TaskItem) => void;
  onDelete: (item: TaskItem) => void;
}) {
  const palette = taskCardPalette(item.status);

  return (
    <Pressable onLongPress={() => onLongPress(item)} style={[styles.taskCard, selected && styles.taskCardSelected]}>
      <View style={styles.taskRow}>
        <View style={styles.taskTitleWrap}>
          <View style={[styles.statusPill, { backgroundColor: palette.badge, borderColor: palette.border }]}>
            <Text style={[styles.statusPillText, { color: palette.text }]}>{taskStatusLabel(item.status)}</Text>
          </View>
          <Text style={styles.taskTitle}>{item.title}</Text>
        </View>
        <Text style={styles.priorityText}>优先级 {item.priority}</Text>
      </View>

      {item.note ? <Text style={styles.taskNote}>{item.note}</Text> : null}

      <View style={styles.metaRow}>
        {item.dueText ? (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>截止 {item.dueText}</Text>
          </View>
        ) : null}
        {item.tags.length ? (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>{item.tags.join(" · ")}</Text>
          </View>
        ) : null}
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>来源 {item.source}</Text>
        </View>
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>创建 {formatTime(item.createdAt)}</Text>
        <Text style={styles.timeText}>更新 {formatTime(item.updatedAt)}</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={() => onToggle(item)} style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}>
          <Text style={styles.actionButtonText}>{item.status === "open" ? "完成" : "恢复"}</Text>
        </Pressable>
        <Pressable onPress={() => onEdit(item)} style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed]}>
          <Text style={styles.actionButtonText}>编辑</Text>
        </Pressable>
        <Pressable onPress={() => onDelete(item)} style={({ pressed }) => [styles.actionButtonDanger, pressed && styles.actionPressed]}>
          <Text style={styles.actionButtonDangerText}>删除</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function TaskBoardScreen({ onScrollState }: Props) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [editingItem, setEditingItem] = useState<TaskItem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMounted, setBulkMounted] = useState(false);
  const bulkBackdrop = useRef(new Animated.Value(0)).current;
  const bulkSheet = useRef(new Animated.Value(0)).current;
  const reportScrollState = useScrollChromeReporter(onScrollState);

  async function loadData(mode: "initial" | "refresh" | "silent" = "silent") {
    setError("");
    setNotice("");

    if (mode === "initial") {
      setLoading(true);
    } else if (mode === "refresh") {
      setRefreshing(true);
    }

    try {
      await cleanupTaskBoard();
      const rows = await listAllTaskItems();
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载事项失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData("initial");
  }, []);

  useEffect(() => {
    if (selectionMode && selectedIds.length) {
      setBulkMounted(true);
      bulkBackdrop.setValue(0);
      bulkSheet.setValue(0);
      Animated.parallel([
        Animated.timing(bulkBackdrop, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.spring(bulkSheet, {
          toValue: 1,
          useNativeDriver: true,
          friction: 10,
          tension: 86,
        }),
      ]).start();
      return;
    }

    if (!bulkMounted) {
      return;
    }

    Animated.parallel([
      Animated.timing(bulkBackdrop, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(bulkSheet, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setBulkMounted(false);
      }
    });
  }, [bulkBackdrop, bulkMounted, bulkSheet, selectedIds.length, selectionMode]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      if (filter !== "all" && item.status !== filter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchable = [item.title, item.note, item.dueText ?? "", item.tags.join(" "), item.source].join(" ").toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [filter, items, query]);

  const stats = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc.open += item.status === "open" ? 1 : 0;
        acc.done += item.status === "done" ? 1 : 0;
        return acc;
      },
      { total: 0, open: 0, done: 0 }
    );
  }, [items]);

  function resetDraft() {
    setDraft(emptyDraft);
    setEditingItem(null);
  }

  function resetSelectionMode() {
    setSelectionMode(false);
    setSelectedIds([]);
    setBulkMounted(false);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function startBulkSelection(item: TaskItem) {
    setSelectionMode(true);
    setSelectedIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
  }

  function startEdit(item: TaskItem) {
    setEditingItem(item);
    setDraft({
      title: item.title,
      note: item.note,
      dueText: item.dueText ?? "",
      tagsText: item.tags.join(", "),
      priority: item.priority,
      status: item.status,
    });
    setError("");
    setNotice("");
  }

  async function handleSave() {
    if (busy) {
      return;
    }

    const title = draft.title.trim();
    if (!title) {
      setError("任务标题不能为空。");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const payload = {
        title,
        note: draft.note.trim(),
        dueText: draft.dueText.trim(),
        priority: draft.priority,
        tags: splitTags(draft.tagsText),
        source: editingItem?.source ?? "manual",
      };

      if (editingItem) {
        await updateTaskItem(editingItem, {
          ...payload,
          status: draft.status,
        });
        setNotice("事项已保存");
      } else {
        await createTaskItem({
          ...payload,
          status: draft.status,
        });
        setNotice("已添加新事项");
      }

      resetDraft();
      await loadData("silent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(item: TaskItem) {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await setTaskItemStatus(item, item.status === "open" ? "done" : "open");
      await loadData("silent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: TaskItem) {
    if (busy) {
      return;
    }

    Alert.alert("删除事项", `确认删除「${item.title}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError("");
          setNotice("");

          try {
            await deleteTaskItem(item.id);
            await loadData("silent");
            if (editingItem?.id === item.id) {
              resetDraft();
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : "删除失败");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function handleBulkDone() {
    if (!selectedIds.length || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      for (const item of selected) {
        await setTaskItemStatus(item, "done");
      }
      resetSelectionMode();
      await loadData("silent");
      setNotice(`已完成 ${selected.length} 项任务`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量完成失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkRestore() {
    if (!selectedIds.length || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const selected = items.filter((item) => selectedIds.includes(item.id));
      for (const item of selected) {
        await setTaskItemStatus(item, "open");
      }
      resetSelectionMode();
      await loadData("silent");
      setNotice(`已恢复 ${selected.length} 项任务`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量恢复失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (!selectedIds.length || busy) {
      return;
    }

    Alert.alert("批量删除", `确定删除选中的 ${selectedIds.length} 项任务吗？`, [
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
              for (const id of selectedIds) {
                await deleteTaskItem(id);
              }
              resetSelectionMode();
              await loadData("silent");
              setNotice(`已删除 ${selectedIds.length} 项任务`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "批量删除失败");
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
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData("refresh")} />}
        onScroll={(event) => {
          reportScrollState(event.nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={16}
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>总数</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.open}</Text>
            <Text style={styles.statLabel}>待办</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.done}</Text>
            <Text style={styles.statLabel}>完成</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.alertBox}>
            <Text style={styles.alertText}>{error}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{editingItem ? "编辑事项" : "新增事项"}</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
              value={draft.title}
              onChangeText={(value) => setDraft((current) => ({ ...current, title: value }))}
              placeholder="例如：周五前提交报告"
              placeholderTextColor="#7486A8"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>备注</Text>
            <TextInput
              value={draft.note}
              onChangeText={(value) => setDraft((current) => ({ ...current, note: value }))}
              placeholder="补充说明、上下文或要求"
              placeholderTextColor="#7486A8"
              multiline
              style={[styles.input, styles.multilineInput]}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>截止时间</Text>
            <TextInput
              value={draft.dueText}
              onChangeText={(value) => setDraft((current) => ({ ...current, dueText: value }))}
              placeholder="例如：明天 18:00 / 2026-05-20 18:00"
              placeholderTextColor="#7486A8"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>标签</Text>
            <TextInput
              value={draft.tagsText}
              onChangeText={(value) => setDraft((current) => ({ ...current, tagsText: value }))}
              placeholder="例如：工作, 个人, 紧急"
              placeholderTextColor="#7486A8"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>优先级</Text>
            <View style={styles.chipRow}>
              {[1, 2, 3, 4, 5].map((value) => {
                const active = draft.priority === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setDraft((current) => ({ ...current, priority: value }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>状态</Text>
            <View style={styles.chipRow}>
              {(["open", "done"] as const).map((value) => {
                const active = draft.status === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setDraft((current) => ({ ...current, status: value }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{taskStatusLabel(value)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.formActions}>
            <PrimaryButton title={editingItem ? "保存事项" : "添加事项"} onPress={() => void handleSave()} loading={busy} />
            {(editingItem || draft.title || draft.note || draft.dueText || draft.tagsText) ? (
              <Pressable onPress={resetDraft} style={({ pressed }) => [styles.ghostButton, pressed && styles.actionPressed]}>
                <Text style={styles.ghostButtonText}>清空</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.searchCard}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索标题、备注、标签或来源"
            placeholderTextColor="#7486A8"
            style={styles.searchInput}
          />
          <View style={styles.filterRow}>
            {filterOptions.map((item) => {
              const active = filter === item.value;
              return (
                <Pressable key={item.value} onPress={() => setFilter(item.value)} style={[styles.filterChip, active && styles.filterChipActive]}>
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {selectionMode ? (
          <View style={styles.selectionBanner}>
            <Text style={styles.selectionBannerText}>已选择 {selectedIds.length} 项，可继续长按更多事项。</Text>
            <Pressable onPress={resetSelectionMode} style={styles.selectionBannerButton}>
              <Text style={styles.selectionBannerButtonText}>取消选择</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>事项列表</Text>
          <Text style={styles.sectionHelper}>{selectedIds.length ? `已选 ${selectedIds.length} 项` : `${filteredItems.length} 项`}</Text>
        </View>

        <View style={styles.list}>
          {filteredItems.map((item) => (
            <TaskCard
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              onLongPress={startBulkSelection}
              onToggle={handleToggle}
              onEdit={startEdit}
              onDelete={handleDelete}
            />
          ))}
        </View>
      </ScrollView>

      {bulkMounted ? (
        <View style={styles.bulkOverlay} pointerEvents="box-none">
          <Animated.View style={[styles.bulkBackdrop, { opacity: bulkBackdrop }]} pointerEvents="none" />
          <Animated.View
            style={[
              styles.bulkSheet,
              {
                transform: [
                  {
                    translateY: bulkSheet.interpolate({
                      inputRange: [0, 1],
                      outputRange: [420, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.bulkTitle}>批量编辑事项</Text>
            <Text style={styles.bulkSubtitle}>已选择 {selectedIds.length} 项事项。</Text>
            <View style={styles.bulkActions}>
              <PrimaryButton title="批量完成" onPress={() => void handleBulkDone()} loading={busy} style={styles.sheetButton} />
              <PrimaryButton title="批量恢复" onPress={() => void handleBulkRestore()} loading={busy} style={styles.sheetButton} />
            </View>
            <View style={styles.bulkActions}>
              <PrimaryButton title="批量删除" onPress={() => void handleBulkDelete()} loading={busy} style={[styles.sheetButton, styles.sheetDangerButton]} />
              <Pressable onPress={resetSelectionMode} style={styles.bulkGhostButton}>
                <Text style={styles.bulkGhostButtonText}>退出多选</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 140,
    gap: 12,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
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
    borderColor: "rgba(146,171,255,0.12)",
  },
  sectionTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionHelper: {
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 18,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
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
    borderColor: "rgba(146,171,255,0.12)",
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
  formActions: {
    flexDirection: "row",
    gap: 10,
  },
  ghostButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  ghostButtonText: {
    color: "#DCE6FF",
    fontSize: 15,
    fontWeight: "800",
  },
  searchCard: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
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
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  filterChipActive: {
    backgroundColor: "#5E85FF",
    borderColor: "#5E85FF",
  },
  filterChipText: {
    color: "#A9B7D6",
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  selectionBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(94,133,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(94,133,255,0.28)",
  },
  selectionBannerText: {
    flex: 1,
    color: "#DCE6FF",
    fontSize: 12,
    lineHeight: 17,
  },
  selectionBannerButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  selectionBannerButtonText: {
    color: "#F7FAFF",
    fontSize: 11,
    fontWeight: "800",
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
  },
  list: {
    gap: 10,
  },
  taskCard: {
    gap: 10,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(8, 16, 32, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  taskCardSelected: {
    borderColor: "rgba(94,133,255,0.72)",
    backgroundColor: "rgba(94,133,255,0.16)",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  taskTitleWrap: {
    flex: 1,
    gap: 6,
  },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  taskTitle: {
    color: "#F7FAFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
  },
  priorityText: {
    color: "#9FB0D4",
    fontSize: 12,
    fontWeight: "700",
  },
  taskNote: {
    color: "#D8E3FF",
    fontSize: 13,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  metaChipText: {
    color: "#DCE6FF",
    fontSize: 11,
    fontWeight: "700",
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  timeText: {
    color: "#8FA0C4",
    fontSize: 11,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  actionButtonText: {
    color: "#F7FAFF",
    fontSize: 12,
    fontWeight: "800",
  },
  actionButtonDanger: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 108, 122, 0.2)",
  },
  actionButtonDangerText: {
    color: "#F7FAFF",
    fontSize: 12,
    fontWeight: "800",
  },
  actionPressed: {
    opacity: 0.88,
  },
  alertBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255, 92, 92, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 92, 0.35)",
  },
  alertText: {
    color: "#FFB4B4",
    fontSize: 13,
    lineHeight: 18,
  },
  noticeBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(74, 222, 128, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(74, 222, 128, 0.3)",
  },
  noticeText: {
    color: "#B9F6CE",
    fontSize: 13,
    lineHeight: 18,
  },
  bulkOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
    justifyContent: "flex-end",
  },
  bulkBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  bulkSheet: {
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
  bulkTitle: {
    color: "#F7FAFF",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  bulkSubtitle: {
    color: "#8FA0C4",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  bulkActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  sheetButton: {
    flex: 1,
  },
  sheetDangerButton: {
    backgroundColor: "rgba(255, 108, 122, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(255, 108, 122, 0.38)",
  },
  bulkGhostButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  bulkGhostButtonText: {
    color: "#DCE6FF",
    fontSize: 15,
    fontWeight: "800",
  },
});
