import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { ChatBubble } from "@/components/ChatBubble";
import { useRelaySettings } from "@/context/RelaySettingsContext";
import { useScrollChromeReporter, type ScrollChromeState } from "@/hooks/useScrollChromeReporter";
import {
  composeChatSystemPrompt,
  getMemoryContext,
  refreshLongTermMemoryAfterReply,
  type MemoryItem,
} from "@/services/longTermMemory";
import { getTaskContext, refreshTaskBoardAfterReply } from "@/services/taskBoard";
import { sendChatMessage } from "@/services/relayApi";
import { ChatAttachment, ChatMessage, RelayChatContentPart } from "@/types";

function now() {
  return Date.now();
}

const starterMessages: ChatMessage[] = [
  {
    id: "assistant-0",
    role: "assistant",
    content: "你可以直接发消息、上传图片或文件，我会结合上下文回答。",
    createdAt: now(),
  },
];

const CHAT_HISTORY_KEY = "@nomi-mobile/chat-history-v1";
const MEMORY_REFRESH_INTERVAL_ROUNDS = 10;
const SIX_MINUTES = 6 * 60 * 1000;

type Props = {
  visible?: boolean;
  onScrollState?: (state: ScrollChromeState) => void;
};

function isTextLikeFile(name: string, mimeType: string) {
  if (mimeType.startsWith("text/")) {
    return true;
  }

  return /\.(txt|md|json|csv|xml|html|htm|yml|yaml|js|ts|tsx|jsx|css|py|java|c|cpp|log)$/i.test(name);
}

async function readFileText(uri: string) {
  try {
    return await new File(uri).text();
  } catch {
    return "";
  }
}

async function uriToDataUri(uri: string, mimeType: string) {
  if (/^data:|^https?:/i.test(uri)) {
    return uri;
  }

  try {
    const base64 = await new File(uri).base64();
    return `data:${mimeType || "application/octet-stream"};base64,${base64}`;
  } catch {
    throw new Error("无法读取附件文件。");
  }
}

function attachmentLabel(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return attachment.name;
  }

  return attachment.text?.trim() ? `${attachment.name}（已读取）` : attachment.name;
}

function buildAttachmentContext(attachments: ChatAttachment[]) {
  return attachments
    .map((attachment) => {
      if (attachment.kind === "image") {
        return `[图片] ${attachment.name}`;
      }

      if (attachment.text?.trim()) {
        return `[文件] ${attachment.name}\n${attachment.text.trim()}`;
      }

      return `[文件] ${attachment.name} (${attachment.mimeType})`;
    })
    .join("\n\n");
}

function sanitizeStoredMessage(message: ChatMessage): ChatMessage | null {
  if (!message || message.isTyping) {
    return null;
  }

  if (message.role !== "system" && message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  return {
    id: typeof message.id === "string" && message.id.trim() ? message.id : `message-${now()}`,
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
    createdAt: typeof message.createdAt === "number" ? message.createdAt : now(),
    attachments: Array.isArray(message.attachments)
      ? message.attachments.filter((attachment) => Boolean(attachment?.id && attachment?.uri && attachment?.name))
      : undefined,
  };
}

function normalizeHistory(messages: ChatMessage[]) {
  return messages.map(sanitizeStoredMessage).filter((message): message is ChatMessage => Boolean(message));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatTimelineLabel(timestamp: number) {
  const date = new Date(timestamp);
  const timeText = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const dayDiff = Math.floor((startOfLocalDay(now()) - startOfLocalDay(timestamp)) / 86_400_000);

  if (dayDiff <= 0) {
    return timeText;
  }

  if (dayDiff === 1) {
    return `昨天 ${timeText}`;
  }

  if (dayDiff === 2) {
    return `前天 ${timeText}`;
  }

  return `${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日 ${timeText}`;
}

function buildTimelineItems(messages: ChatMessage[]) {
  const items: Array<
    | {
        kind: "timestamp";
        id: string;
        label: string;
      }
    | {
        kind: "message";
        id: string;
        message: ChatMessage;
      }
  > = [];

  let previousTimestamp: number | null = null;
  for (const message of messages) {
    const timestamp = typeof message.createdAt === "number" ? message.createdAt : now();
    if (previousTimestamp !== null && timestamp - previousTimestamp >= SIX_MINUTES) {
      items.push({
        kind: "timestamp",
        id: `timestamp-${message.id}`,
        label: formatTimelineLabel(timestamp),
      });
    }

    items.push({
      kind: "message",
      id: message.id,
      message,
    });
    previousTimestamp = timestamp;
  }

  return items;
}

function buildCurrentTimeLabel() {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )}`;
}

async function convertMessageToContent(message: ChatMessage): Promise<string | RelayChatContentPart[]> {
  const attachments = message.attachments ?? [];
  if (!attachments.length) {
    return message.content;
  }

  const parts: RelayChatContentPart[] = [];
  parts.push({
    type: "text",
    text: message.content.trim() || "请结合附件回答。",
  });

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: {
          url: await uriToDataUri(attachment.uri, attachment.mimeType),
          detail: "auto",
        },
      });
      continue;
    }

    parts.push({
      type: "text",
      text: attachment.text?.trim()
        ? `[文件 ${attachment.name}]\n${attachment.text.trim()}`
        : `[文件 ${attachment.name}，类型 ${attachment.mimeType}]`,
    });
  }

  return parts;
}

export function ChatScreen({ visible = true, onScrollState }: Props) {
  const { settings, setActiveChatModelId } = useRelaySettings();
  const [input, setInput] = useState("");
  const [inputHeight, setInputHeight] = useState(44);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [touching, setTouching] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarMounted, setToolbarMounted] = useState(false);
  const [composerHeight, setComposerHeight] = useState(232);
  const listRef = useRef<FlatList<any> | null>(null);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarAnim = useRef(new Animated.Value(0)).current;
  const keyboardAnim = useRef(new Animated.Value(0)).current;
  const scrollGestureRef = useRef(false);

  const assistantName = settings.aiName.trim() || "AI";
  const chatModels = useMemo(
    () => settings.models.filter((model) => model.id !== settings.activeImageModelId),
    [settings.activeImageModelId, settings.models]
  );
  const activeChatModel =
    chatModels.find((model) => model.id === settings.activeChatModelId) ?? chatModels[0] ?? settings.models[0];
  const canSend = useMemo(() => (input.trim().length > 0 || attachments.length > 0) && !sending, [attachments.length, input, sending]);
  const reportScrollState = useScrollChromeReporter(onScrollState);
  const timelineItems = useMemo(() => buildTimelineItems(messages), [messages]);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(CHAT_HISTORY_KEY)
      .then((raw) => {
        if (cancelled) {
          return;
        }

        if (!raw) {
          setMessages(starterMessages);
          return;
        }

        try {
          const parsed = JSON.parse(raw) as ChatMessage[];
          const restored = Array.isArray(parsed) ? normalizeHistory(parsed) : [];
          setMessages(restored.length ? restored : starterMessages);
        } catch {
          setMessages(starterMessages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages(starterMessages);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(normalizeHistory(messages))).catch(() => {
      // Ignore local chat persistence failures.
    });
  }, [historyLoaded, messages]);

  useEffect(() => {
    if (!historyLoaded || !visible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [historyLoaded, messages.length, visible]);

  useEffect(() => {
    const animateKeyboard = (nextHeight: number, duration?: number) => {
      Animated.timing(keyboardAnim, {
        toValue: nextHeight,
        duration: duration ?? 220,
        useNativeDriver: true,
      }).start();
    };

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = Math.max(0, Math.round(event.endCoordinates.height));
      animateKeyboard(nextHeight, event.duration);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      animateKeyboard(0, event.duration);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardAnim]);

  useEffect(() => {
    return () => {
      if (toolbarTimer.current) {
        clearTimeout(toolbarTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (focusedMessageId && !touching) {
      setShowToolbar(true);
      return;
    }

    setShowToolbar(false);
  }, [focusedMessageId, touching]);

  useEffect(() => {
    if (showToolbar) {
      setToolbarMounted(true);
      toolbarAnim.setValue(0);
      Animated.spring(toolbarAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 10,
        tension: 90,
      }).start();
      return;
    }

    Animated.timing(toolbarAnim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setToolbarMounted(false);
      }
    });
  }, [showToolbar, toolbarAnim]);

  const openToolbar = useCallback((messageId: string) => {
    if (toolbarTimer.current) {
      clearTimeout(toolbarTimer.current);
    }

    setFocusedMessageId(messageId);
    setShowToolbar(false);
    toolbarTimer.current = setTimeout(() => {
      setShowToolbar(true);
    }, 120);
  }, []);

  const handleSurfaceTouchStart = useCallback(() => {
    setTouching(true);
    setShowToolbar(false);
  }, []);

  const handleSurfaceTouchEnd = useCallback(() => {
    if (scrollGestureRef.current) {
      setTouching(false);
      setShowToolbar(Boolean(focusedMessageId) || selectedMessageIds.length > 0);
      scrollGestureRef.current = false;
      return;
    }

    setTouching(false);
    setFocusedMessageId(null);
    setShowToolbar(false);
  }, [focusedMessageId, selectedMessageIds.length]);

  const handleScrollBeginDrag = useCallback(() => {
    scrollGestureRef.current = true;
    setTouching(true);
    setShowToolbar(false);
  }, []);

  const handleScrollEndDrag = useCallback(() => {
    if (!scrollGestureRef.current) {
      return;
    }

    setTouching(false);
    setShowToolbar(Boolean(focusedMessageId) || selectedMessageIds.length > 0);
    scrollGestureRef.current = false;
  }, [focusedMessageId, selectedMessageIds.length]);

  const renderMessage = useCallback(
    ({
      item,
    }: {
      item:
        | {
            kind: "timestamp";
            id: string;
            label: string;
          }
        | {
            kind: "message";
            id: string;
            message: ChatMessage;
          };
    }) => {
      if (item.kind === "timestamp") {
        return (
          <View style={styles.timestampRow}>
            <Text style={styles.timestampText}>{item.label}</Text>
          </View>
        );
      }

      const message = item.message;
      return (
        <ChatBubble
          message={message}
          assistantName={assistantName}
          userAvatarUri={settings.userAvatarUri}
          assistantAvatarUri={settings.aiAvatarUri}
          selected={selectedMessageIds.includes(message.id)}
          onLongPress={(nextMessage) => {
            if (multiSelectMode) {
              setSelectedMessageIds((current) =>
                current.includes(nextMessage.id) ? current.filter((id) => id !== nextMessage.id) : [...current, nextMessage.id]
              );
              openToolbar(nextMessage.id);
              return;
            }

            openToolbar(nextMessage.id);
          }}
          onPress={(nextMessage) => {
            if (!multiSelectMode) {
              return;
            }

            setSelectedMessageIds((current) =>
              current.includes(nextMessage.id) ? current.filter((id) => id !== nextMessage.id) : [...current, nextMessage.id]
            );
          }}
        />
      );
    },
    [assistantName, multiSelectMode, openToolbar, selectedMessageIds, settings.aiAvatarUri, settings.userAvatarUri]
  );

  function buildReplayAnchor(messageId: string) {
    const index = messages.findIndex((item) => item.id === messageId);
    if (index < 0) {
      return null;
    }

    const target = messages[index];
    if (target.role === "user") {
      return {
        baseMessages: messages.slice(0, index),
        replayMessage: target,
      };
    }

    let userIndex = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === "user") {
        userIndex = cursor;
        break;
      }
    }

    if (userIndex < 0) {
      return null;
    }

    return {
      baseMessages: messages.slice(0, userIndex),
      replayMessage: messages[userIndex],
    };
  }

  async function submitConversation(baseMessages: ChatMessage[], userMessage: ChatMessage) {
    setError("");
    setSending(true);

    const typingId = `typing-${now()}`;
    const typingMessage: ChatMessage = {
      id: typingId,
      role: "assistant",
      content: "",
      isTyping: true,
      createdAt: now(),
    };

    const conversation = [...baseMessages, userMessage];
    setMessages([...conversation, typingMessage]);
    setInput("");
    setInputHeight(44);
    setAttachments([]);
    setFocusedMessageId(null);
    setShowToolbar(false);

    try {
      const conversationQuery = [userMessage.content, buildAttachmentContext(userMessage.attachments ?? [])].filter(Boolean).join("\n");
      const currentTimeLabel = buildCurrentTimeLabel();

      const [memoryContext, taskContext] = await Promise.all([
        getMemoryContext(conversationQuery).catch(() => ({ summary: "", memories: [] as MemoryItem[] })),
        getTaskContext(conversationQuery).catch(() => ({ summary: "", tasks: [] })),
      ]);

      const systemPrompt = composeChatSystemPrompt({
        assistantName,
        persona: settings.persona,
        currentTime: currentTimeLabel,
        summary: memoryContext.summary,
        memories: memoryContext.memories,
        taskSummary: taskContext.summary,
        tasks: taskContext.tasks,
      });

      const relayConversation = conversation.slice(-18);
      const relayMessages = await Promise.all(
        relayConversation.map(async (message) => ({
          role: message.role,
          content: await convertMessageToContent(message),
        }))
      );

      const reply = await sendChatMessage(settings.chat, [{ role: "system", content: systemPrompt }, ...relayMessages]);

      const assistantMessage: ChatMessage = {
        id: `assistant-${now()}`,
        role: "assistant",
        content: reply,
        createdAt: now(),
      };

      setMessages((current) => current.map((item) => (item.id === typingId ? assistantMessage : item)));
      void refreshLongTermMemoryAfterReply(settings.chat, assistantName, settings.persona, [...conversation, assistantMessage]).catch(() => {
        // Ignore background memory refresh failures.
      });
      void refreshTaskBoardAfterReply(settings.chat, assistantName, settings.persona, [...conversation, assistantMessage]).catch(() => {
        // Ignore task extraction failures.
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      setMessages((current) => current.filter((item) => item.id !== typingId));
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && !attachments.length) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${now()}`,
      role: "user",
      content: text || "请结合附件回答。",
      attachments: attachments.length ? attachments : undefined,
      createdAt: now(),
    };

    await submitConversation(messages, userMessage);
  }

  async function handleReplaySelected() {
    if (!focusedMessageId) {
      return;
    }

    const anchor = buildReplayAnchor(focusedMessageId);
    if (!anchor) {
      return;
    }

    await submitConversation(anchor.baseMessages, anchor.replayMessage);
  }

  function handleDeleteSelected() {
    if (!focusedMessageId) {
      return;
    }

    setMessages((current) => current.filter((item) => item.id !== focusedMessageId));
    setFocusedMessageId(null);
    setShowToolbar(false);
  }

  function handleToggleMultiSelect() {
    if (!focusedMessageId) {
      return;
    }

    setMultiSelectMode(true);
    setSelectedMessageIds((current) => (current.includes(focusedMessageId) ? current : [...current, focusedMessageId]));
    setShowToolbar(false);
  }

  function handleFinishMultiSelect() {
    setMultiSelectMode(false);
    setSelectedMessageIds([]);
    setShowToolbar(false);
    setFocusedMessageId(null);
  }

  function handleBatchDelete() {
    if (!selectedMessageIds.length) {
      return;
    }

    setMessages((current) => current.filter((item) => !selectedMessageIds.includes(item.id)));
    handleFinishMultiSelect();
  }

  async function handlePickImages() {
    setError("");

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("需要相册权限才能选择图片。");
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: 4,
        base64: false,
      });

      if (picked.canceled || !picked.assets?.length) {
        return;
      }

      const nextAttachments: ChatAttachment[] = picked.assets.map((asset, index) => ({
        id: `image-${now()}-${index}`,
        kind: "image",
        uri: asset.uri,
        name: asset.fileName ?? `image-${index + 1}.jpg`,
        mimeType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? undefined,
      }));

      setAttachments((current) => [...current, ...nextAttachments]);
      setImportMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择图片失败");
    }
  }

  async function handlePickFiles() {
    setError("");

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets?.length) {
        return;
      }

      const nextAttachments: ChatAttachment[] = [];

      for (const asset of picked.assets) {
        const mimeType = asset.mimeType ?? "application/octet-stream";
        const kind: ChatAttachment["kind"] = mimeType.startsWith("image/") ? "image" : "file";
        const attachment: ChatAttachment = {
          id: `file-${now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          uri: asset.uri,
          name: asset.name ?? "未命名文件",
          mimeType,
          size: asset.size ?? undefined,
        };

        if (kind === "file" && isTextLikeFile(attachment.name, mimeType)) {
          attachment.text = await readFileText(asset.uri);
        }

        nextAttachments.push(attachment);
      }

      setAttachments((current) => [...current, ...nextAttachments]);
      setImportMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择文件失败");
    }
  }

  function handleAddAttachment() {
    setImportMenuOpen(true);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  const currentModelLabel = activeChatModel?.name ?? "未配置模型";
  const contentOffset = Animated.multiply(keyboardAnim, -1);

  return (
    <View style={styles.container}>
      <View
        style={styles.surface}
        onTouchStart={handleSurfaceTouchStart}
        onTouchEnd={handleSurfaceTouchEnd}
        onTouchCancel={handleSurfaceTouchEnd}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.contentLayer,
            {
              transform: [{ translateY: contentOffset }],
            },
          ]}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.chatBody}>
            <FlatList
              ref={listRef}
              data={timelineItems}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              style={styles.messageList}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              onMomentumScrollEnd={handleScrollEndDrag}
              onScroll={(event) => reportScrollState(event.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              ListFooterComponent={<View style={styles.listFooter} />}
            />

            {toolbarMounted && focusedMessageId ? (
              <Animated.View
                pointerEvents="box-none"
                style={[
                  styles.actionBubbleWrap,
                  {
                    bottom: composerHeight + 12,
                    opacity: toolbarAnim,
                    transform: [
                      {
                        translateY: toolbarAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [18, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.actionBubble}>
                  {multiSelectMode ? (
                    <>
                      <Text style={styles.actionBubbleHint}>已选 {selectedMessageIds.length} 条</Text>
                      <View style={styles.actionBubbleRow}>
                        <Pressable onPress={handleFinishMultiSelect} style={styles.actionBubbleButton}>
                          <Text style={styles.actionBubbleButtonText}>完成</Text>
                        </Pressable>
                        <Pressable onPress={handleBatchDelete} style={[styles.actionBubbleButton, styles.actionBubbleButtonDanger]}>
                          <Text style={styles.actionBubbleButtonText}>删除</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <View style={styles.actionBubbleRow}>
                      <Pressable onPress={() => void handleReplaySelected()} style={styles.actionBubbleButton}>
                        <Text style={styles.actionBubbleButtonText}>重新回复</Text>
                      </Pressable>
                      <Pressable onPress={handleToggleMultiSelect} style={styles.actionBubbleButton}>
                        <Text style={styles.actionBubbleButtonText}>多选</Text>
                      </Pressable>
                      <Pressable onPress={handleDeleteSelected} style={[styles.actionBubbleButton, styles.actionBubbleButtonDanger]}>
                        <Text style={styles.actionBubbleButtonText}>删除</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              </Animated.View>
            ) : null}

            <View
              style={styles.composerStack}
              onLayout={(event) => {
                const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                if (nextHeight > 0 && nextHeight !== composerHeight) {
                  setComposerHeight(nextHeight);
                }
              }}
            >
              <View style={styles.modelCard}>
                <Text style={styles.modelLabel}>聊天模型</Text>
                <Pressable onPress={() => setModelMenuOpen(true)} style={styles.modelButton}>
                  <Text style={styles.modelButtonText} numberOfLines={1}>
                    {currentModelLabel}
                  </Text>
                  <Text style={styles.modelButtonChevron}>▾</Text>
                </Pressable>
              </View>

              <View style={styles.inputCard}>
                {attachments.length ? (
                  <View style={styles.attachmentStrip}>
                    <View style={styles.attachmentHeader}>
                      <Text style={styles.attachmentTitle}>已选择的附件</Text>
                      <Pressable onPress={() => setAttachments([])} style={styles.attachmentClearButton}>
                        <Text style={styles.attachmentClearText}>清除</Text>
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentList}>
                      {attachments.map((attachment) => (
                        <View key={attachment.id} style={styles.attachmentChip}>
                          {attachment.kind === "image" ? <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} /> : null}
                          <Text style={styles.attachmentChipText} numberOfLines={1}>
                            {attachmentLabel(attachment)}
                          </Text>
                          <Pressable onPress={() => removeAttachment(attachment.id)} hitSlop={8}>
                            <Text style={styles.attachmentRemove}>×</Text>
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <View style={styles.composerRow}>
                  <Pressable onPress={handleAddAttachment} style={styles.attachButton}>
                    <Text style={styles.attachButtonText}>＋</Text>
                  </Pressable>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    onContentSizeChange={(event) => {
                      const nextHeight = Math.min(112, Math.max(44, event.nativeEvent.contentSize.height));
                      setInputHeight(nextHeight);
                    }}
                    placeholder="输入消息，或添加图片 / 文件"
                    placeholderTextColor="#8294BA"
                    style={[styles.input, { height: inputHeight }]}
                    multiline
                    scrollEnabled={inputHeight >= 112}
                    returnKeyType="send"
                    submitBehavior="submit"
                    onSubmitEditing={() => void handleSend()}
                    blurOnSubmit={false}
                    editable={!sending}
                  />
                  <Pressable
                    onPress={() => void handleSend()}
                    disabled={!canSend}
                    style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed, !canSend && styles.sendButtonDisabled]}
                  >
                    <Text style={styles.sendButtonText}>{sending ? "..." : "发送"}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>

      <Modal visible={importMenuOpen} transparent animationType="fade" onRequestClose={() => setImportMenuOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setImportMenuOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            <Text style={styles.modalTitle}>添加附件</Text>
            <Text style={styles.modalSubtitle}>选择图片或文件导入到当前对话</Text>
            <View style={styles.importActions}>
              <Pressable onPress={() => void handlePickImages()} style={[styles.modalItem, styles.importActionButton]}>
                <Text style={styles.modalItemText}>图片</Text>
                <Text style={styles.modalItemSubtext}>从相册选择</Text>
              </Pressable>
              <Pressable onPress={() => void handlePickFiles()} style={[styles.modalItem, styles.importActionButton]}>
                <Text style={styles.modalItemText}>文件</Text>
                <Text style={styles.modalItemSubtext}>导入文档或文本</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setImportMenuOpen(false)} style={styles.importCancelButton}>
              <Text style={styles.importCancelText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={modelMenuOpen} transparent animationType="fade" onRequestClose={() => setModelMenuOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModelMenuOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            <Text style={styles.modalTitle}>选择聊天模型</Text>
            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent}>
              {chatModels.map((model) => {
                const active = model.id === settings.activeChatModelId;
                return (
                  <Pressable
                    key={model.id}
                    onPress={() => {
                      setActiveChatModelId(model.id);
                      setModelMenuOpen(false);
                    }}
                    style={[styles.modalItem, active && styles.modalItemActive]}
                  >
                    <Text style={[styles.modalItemText, active && styles.modalItemTextActive]} numberOfLines={1}>
                      {model.name}
                    </Text>
                    <Text style={[styles.modalItemSubtext, active && styles.modalItemSubtextActive]} numberOfLines={1}>
                      {model.chatModel}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
          </Pressable>
        </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  surface: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 0,
  },
  errorBox: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255, 92, 92, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 92, 92, 0.35)",
  },
  errorText: {
    color: "#FFB4B4",
    fontSize: 13,
    lineHeight: 18,
  },
  listContent: {
    flexGrow: 1,
    paddingVertical: 4,
    paddingBottom: 12,
  },
  listFooter: {
    height: 8,
  },
  timestampRow: {
    alignItems: "center",
    marginVertical: 14,
  },
  timestampText: {
    color: "#90A2C8",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.10)",
  },
  composerStack: {
    gap: 10,
    paddingHorizontal: 8,
  },
  contentLayer: {
    flex: 1,
  },
  chatBody: {
    flex: 1,
    position: "relative",
  },
  messageList: {
    flex: 1,
  },
  modelCard: {
    gap: 6,
    padding: 10,
    borderRadius: 22,
    backgroundColor: "rgba(10, 18, 36, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(130, 150, 220, 0.18)",
  },
  inputCard: {
    gap: 10,
    padding: 10,
    borderRadius: 24,
    backgroundColor: "rgba(6, 12, 24, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  composer: {
    gap: 10,
    padding: 10,
    borderRadius: 24,
    backgroundColor: "rgba(6, 12, 24, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  attachmentStrip: {
    gap: 8,
  },
  attachmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  attachmentTitle: {
    color: "#DCE6FF",
    fontSize: 12,
    fontWeight: "800",
  },
  attachmentClearButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  attachmentClearText: {
    color: "#DCE6FF",
    fontSize: 11,
    fontWeight: "700",
  },
  attachmentList: {
    gap: 8,
    paddingRight: 4,
  },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
    maxWidth: 180,
  },
  attachmentThumb: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  attachmentChipText: {
    flex: 1,
    color: "#F7FAFF",
    fontSize: 12,
  },
  attachmentRemove: {
    color: "#F7FAFF",
    fontSize: 18,
    lineHeight: 18,
    fontWeight: "800",
  },
  modelRow: {
    gap: 6,
  },
  modelLabel: {
    color: "#9FB0D4",
    fontSize: 11,
    fontWeight: "700",
  },
  modelButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  modelButtonText: {
    flex: 1,
    color: "#F7FAFF",
    fontSize: 12,
    fontWeight: "800",
  },
  modelButtonChevron: {
    color: "#DCE6FF",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 8,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  attachButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  attachButtonText: {
    color: "#F7FAFF",
    fontSize: 22,
    fontWeight: "700",
    marginTop: -2,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "#F7FAFF",
    fontSize: 15,
    textAlignVertical: "top",
  },
  sendButton: {
    minWidth: 66,
    minHeight: 46,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5E85FF",
  },
  sendButtonDisabled: {
    opacity: 0.58,
  },
  sendButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  actionBubbleWrap: {
    position: "absolute",
    left: 24,
    right: 24,
    alignItems: "center",
  },
  actionBubble: {
    maxWidth: "100%",
    padding: 10,
    borderRadius: 20,
    backgroundColor: "rgba(9, 15, 28, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.18)",
  },
  actionBubbleHint: {
    color: "#9FB0D4",
    fontSize: 11,
    marginBottom: 8,
  },
  actionBubbleRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBubbleButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  actionBubbleButtonDanger: {
    backgroundColor: "rgba(255, 108, 122, 0.2)",
  },
  actionBubbleButtonText: {
    color: "#F7FAFF",
    fontSize: 12,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "72%",
    padding: 14,
    borderRadius: 22,
    backgroundColor: "#0E1730",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.14)",
  },
  modalTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  modalSubtitle: {
    color: "#98A9CF",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 14,
  },
  importActions: {
    gap: 10,
    marginBottom: 12,
  },
  importActionButton: {
    alignItems: "flex-start",
  },
  importCancelButton: {
    minHeight: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  importCancelText: {
    color: "#F7FAFF",
    fontSize: 13,
    fontWeight: "800",
  },
  modalList: {
    maxHeight: 420,
  },
  modalListContent: {
    gap: 8,
  },
  modalItem: {
    gap: 4,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146,171,255,0.12)",
  },
  modalItemActive: {
    backgroundColor: "rgba(94,133,255,0.24)",
    borderColor: "rgba(94,133,255,0.58)",
  },
  modalItemText: {
    color: "#F7FAFF",
    fontSize: 13,
    fontWeight: "800",
  },
  modalItemTextActive: {
    color: "#FFFFFF",
  },
  modalItemSubtext: {
    color: "#8FA0C4",
    fontSize: 11,
  },
  modalItemSubtextActive: {
    color: "#DCE6FF",
  },
});




