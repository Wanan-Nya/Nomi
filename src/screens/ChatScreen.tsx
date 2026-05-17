import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ChatBubble } from "@/components/ChatBubble";
import { useRelaySettings } from "@/context/RelaySettingsContext";
import {
  composeChatSystemPrompt,
  getMemoryContext,
  refreshLongTermMemoryAfterReply,
  type MemoryItem,
} from "@/services/longTermMemory";
import { sendChatMessage } from "@/services/relayApi";
import { ChatMessage } from "@/types";

const starterMessages: ChatMessage[] = [
  {
    id: "assistant-0",
    role: "assistant",
    content: "你可以直接输入问题，我会用中文回答。",
  },
];

export function ChatScreen() {
  const { settings } = useRelaySettings();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [error, setError] = useState("");
  const listRef = useRef<FlatList<ChatMessage> | null>(null);

  const assistantName = settings.aiName.trim() || "AI";
  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatBubble
        message={item}
        assistantName={assistantName}
        userAvatarUri={settings.userAvatarUri}
        assistantAvatarUri={settings.aiAvatarUri}
      />
    ),
    [assistantName, settings.aiAvatarUri, settings.userAvatarUri]
  );

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    setError("");
    setInput("");
    setSending(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };
    const typingId = `typing-${Date.now()}`;
    const typingMessage: ChatMessage = {
      id: typingId,
      role: "assistant",
      content: "",
      isTyping: true,
    };

    const history = [...messages, userMessage];
    setMessages([...history, typingMessage]);

    try {
      let memoryContext: { summary: string; memories: MemoryItem[] } = { summary: "", memories: [] };
      try {
        memoryContext = await getMemoryContext(text);
      } catch {
        memoryContext = { summary: "", memories: [] };
      }

      const systemPrompt = composeChatSystemPrompt({
        assistantName,
        persona: settings.persona,
        summary: memoryContext.summary,
        memories: memoryContext.memories,
      });

      const reply = await sendChatMessage(settings.chat, [
        { role: "system", content: systemPrompt },
        ...history.map((item) => ({
          role: item.role,
          content: item.content,
        })),
      ]);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: reply,
      };

      setMessages((current) => current.map((item) => (item.id === typingId ? assistantMessage : item)));

      void refreshLongTermMemoryAfterReply(settings.chat, assistantName, settings.persona, [...history, assistantMessage]).catch(
        () => {
          // Ignore background memory refresh failures.
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "发送失败";
      setError(message);
      setMessages((current) => current.filter((item) => item.id !== typingId));
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={styles.surface}>
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
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={<View style={styles.listFooter} />}
        />

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入消息..."
            placeholderTextColor="#8294BA"
            style={styles.input}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
            editable={!sending}
          />
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
          >
            <Text style={styles.sendButtonText}>{sending ? "..." : "发送"}</Text>
          </Pressable>
        </View>
      </View>
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
    paddingTop: 56,
    paddingBottom: 16,
    gap: 12,
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
  },
  listFooter: {
    height: 8,
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 24,
    backgroundColor: "rgba(6, 12, 24, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 88,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "#F7FAFF",
    fontSize: 15,
  },
  sendButton: {
    width: 62,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5E85FF",
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
});
