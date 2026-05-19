import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import { ChatBubble } from "@/components/ChatBubble";
import { useRelaySettings } from "@/context/RelaySettingsContext";
import { composeChatSystemPrompt, getMemoryContext, refreshLongTermMemoryAfterReply, type MemoryItem } from "@/services/longTermMemory";
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

type Props = {
  onScrollDirection?: (direction: "up" | "down") => void;
};

function isTextLikeFile(name: string, mimeType: string) {
  if (mimeType.startsWith("text/")) {
    return true;
  }

  return /\.(txt|md|json|csv|xml|html|htm|yml|yaml|js|ts|tsx|jsx|css|py|java|c|cpp|log)$/i.test(name);
}

async function readFileText(uri: string) {
  try {
    return await FileSystem.readAsStringAsync(uri, {
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

async function uriToDataUri(uri: string, mimeType: string) {
  if (/^data:|^https?:/i.test(uri)) {
    return uri;
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64",
  });
  return `data:${mimeType || "application/octet-stream"};base64,${base64}`;
}

function attachmentLabel(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return attachment.name;
  }

  return attachment.text?.trim() ? `${attachment.name} · 已读取` : attachment.name;
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
          detail: "high",
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

export function ChatScreen({ onScrollDirection }: Props) {
  const { settings, setActiveChatModelId } = useRelaySettings();
  const [input, setInput] = useState("");
  const [inputHeight, setInputHeight] = useState(44);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [error, setError] = useState("");
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [touching, setTouching] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarMounted, setToolbarMounted] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const lastScrollY = useRef(0);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarAnim = useRef(new Animated.Value(0)).current;
  const scrollGestureRef = useRef(false);

  const assistantName = settings.aiName.trim() || "AI";
  const chatModels = useMemo(
    () => settings.models.filter((model) => model.id !== settings.activeImageModelId),
    [settings.activeImageModelId, settings.models]
  );
  const activeChatModel =
    chatModels.find((model) => model.id === settings.activeChatModelId) ?? chatModels[0] ?? settings.models[0];
  const canSend = useMemo(() => (input.trim().length > 0 || attachments.length > 0) && !sending, [attachments.length, input, sending]);

  useEffect(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (toolbarTimer.current) {
        clearTimeout(toolbarTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardInset(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
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

  const updateScrollDirection = useCallback(
    (offsetY: number) => {
      const delta = offsetY - lastScrollY.current;
      if (Math.abs(delta) < 12) {
        return;
      }

      lastScrollY.current = offsetY;
      onScrollDirection?.(delta > 0 ? "up" : "down");
    },
    [onScrollDirection]
  );

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
    ({ item }: { item: ChatMessage }) => (
      <ChatBubble
        message={item}
        assistantName={assistantName}
        userAvatarUri={settings.userAvatarUri}
        assistantAvatarUri={settings.aiAvatarUri}
        selected={selectedMessageIds.includes(item.id)}
        onLongPress={(message) => {
          if (multiSelectMode) {
            setSelectedMessageIds((current) =>
              current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id]
            );
            openToolbar(message.id);
            return;
          }

          openToolbar(message.id);
        }}
        onPress={(message) => {
          if (!multiSelectMode) {
            return;
          }

          setSelectedMessageIds((current) =>
            current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id]
          );
        }}
      />
    ),
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
      const memoryContext = await getMemoryContext([userMessage.content, buildAttachmentContext(userMessage.attachments ?? [])].filter(Boolean).join("\n")).catch(
        () => ({ summary: "", memories: [] as MemoryItem[] })
      );

      const systemPrompt = composeChatSystemPrompt({
        assistantName,
        persona: settings.persona,
        summary: memoryContext.summary,
        memories: memoryContext.memories,
      });

      const relayMessages = await Promise.all(
        conversation.map(async (message) => ({
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
  }

  async function handlePickFiles() {
    setError("");

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
  }

  function handleAddAttachment() {
    Alert.alert("添加附件", "选择导入类型", [
      { text: "取消", style: "cancel" },
      { text: "图片", onPress: () => void handlePickImages() },
      { text: "文件", onPress: () => void handlePickFiles() },
    ]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  const currentModelLabel = activeChatModel?.name ?? "未配置模型";

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      <View
        style={styles.surface}
        onTouchStart={handleSurfaceTouchStart}
        onTouchEnd={handleSurfaceTouchEnd}
        onTouchCancel={handleSurfaceTouchEnd}
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          onMomentumScrollEnd={handleScrollEndDrag}
          onScroll={(event) => updateScrollDirection(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          ListFooterComponent={<View style={styles.listFooter} />}
        />

        <View style={[styles.composerStack, keyboardInset > 0 && { paddingBottom: Math.max(0, keyboardInset - 16) }]}>
          <View style={styles.modelCard}>
            <Text style={styles.modelLabel}>褰撳墠妯″瀷</Text>
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
                  <Text style={styles.attachmentTitle}>宸叉坊鍔犻檮浠?</Text>
                  <Pressable onPress={() => setAttachments([])} style={styles.attachmentClearButton}>
                    <Text style={styles.attachmentClearText}>娓呯┖</Text>
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
                placeholder="杈撳叆娑堟伅銆佷笂浼犲浘鐗囨垨鏂囦欢"
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
        {toolbarMounted && focusedMessageId ? (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.actionBubbleWrap,
              {
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
      </View>

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
    </KeyboardAvoidingView>
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
    paddingBottom: 12,
    gap: 10,
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
    paddingBottom: 8,
  },
  listFooter: {
    height: 8,
  },
  composerStack: {
    gap: 10,
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
    left: 16,
    right: 16,
    bottom: 126,
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
