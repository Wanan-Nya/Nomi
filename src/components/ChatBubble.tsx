import React, { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";

import { ChatMessage } from "@/types";

type Props = {
  message: ChatMessage;
  assistantName: string;
  userAvatarUri?: string;
  assistantAvatarUri?: string;
};

function Avatar({ uri, fallback, tint }: { uri?: string; fallback: string; tint: "user" | "assistant" }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.avatarImage} />;
  }

  return (
    <View style={[styles.avatarFallback, tint === "user" ? styles.avatarFallbackUser : styles.avatarFallbackAssistant]}>
      <Text style={styles.avatarFallbackText}>{fallback}</Text>
    </View>
  );
}

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (value: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
        ])
      );

    const animations = [makeLoop(dot1, 0), makeLoop(dot2, 120), makeLoop(dot3, 240)];
    animations.forEach((animation) => animation.start());

    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingRow}>
      {[dot1, dot2, dot3].map((value, index) => (
        <Animated.View
          key={`${index}`}
          style={[
            styles.typingDot,
            {
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [
                {
                  translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function ChatBubbleImpl({ message, assistantName, userAvatarUri, assistantAvatarUri }: Props) {
  const isUser = message.role === "user";
  const isTyping = Boolean(message.isTyping);
  const speaker = isUser ? "我" : assistantName || "AI";

  const entry = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(entry, {
      toValue: 1,
      useNativeDriver: true,
      friction: 10,
      tension: 90,
    }).start();
  }, [entry]);

  const animatedStyle = useMemo(
    () => ({
      opacity: entry,
      transform: [
        {
          translateY: entry.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
        {
          translateX: entry.interpolate({
            inputRange: [0, 1],
            outputRange: [isUser ? 14 : -14, 0],
          }),
        },
      ],
    }),
    [entry, isUser]
  );

  return (
    <Animated.View style={[styles.row, isUser && styles.rowUser, animatedStyle]}>
      {!isUser ? (
        <View style={styles.avatarWrap}>
          <Avatar uri={assistantAvatarUri} fallback={speaker.slice(0, 1)} tint="assistant" />
        </View>
      ) : null}

      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.role, isUser ? styles.roleUser : styles.roleAssistant]}>{speaker}</Text>
        {isTyping ? <TypingDots /> : <Text style={styles.content}>{message.content}</Text>}
      </View>

      {isUser ? (
        <View style={styles.avatarWrap}>
          <Avatar uri={userAvatarUri} fallback="我" tint="user" />
        </View>
      ) : null}
    </Animated.View>
  );
}

export const ChatBubble = memo(ChatBubbleImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  avatarWrap: {
    marginTop: 2,
  },
  avatarImage: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackUser: {
    backgroundColor: "rgba(94,133,255,0.95)",
  },
  avatarFallbackAssistant: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  avatarFallbackText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  bubble: {
    maxWidth: "76%",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  userBubble: {
    backgroundColor: "#4F7CFF",
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderBottomLeftRadius: 6,
  },
  role: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  roleUser: {
    color: "rgba(255,255,255,0.82)",
  },
  roleAssistant: {
    color: "#9CB8FF",
  },
  content: {
    color: "#F7FAFF",
    fontSize: 15,
    lineHeight: 22,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 22,
    paddingVertical: 2,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#DCE6FF",
  },
});
