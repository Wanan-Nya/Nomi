import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

type Mode = "chat" | "image";
type Page = "home" | "settings" | "memory" | "tasks";

type Props = {
  open: boolean;
  mode: Mode;
  page: Page;
  onClose: () => void;
  onOpenChat: () => void;
  onOpenSettings: () => void;
  onOpenMemory: () => void;
  onOpenTasks: () => void;
};

const DRAWER_WIDTH = 286;

export function SideDrawer({
  open,
  mode,
  page,
  onClose,
  onOpenChat,
  onOpenSettings,
  onOpenMemory,
  onOpenTasks,
}: Props) {
  const [mounted, setMounted] = useState(open);
  const slide = useRef(new Animated.Value(open ? 1 : 0)).current;
  const backdrop = useRef(new Animated.Value(open ? 1 : 0)).current;
  const itemAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  const items = useMemo(
    () => [
      {
        key: "chat",
        title: "聊天",
        desc: "进入聊天页面",
        active: page === "home" && mode === "chat",
        onPress: onOpenChat,
      },
      {
        key: "memory",
        title: "记忆",
        desc: "查看和管理长期记忆",
        active: page === "memory",
        onPress: onOpenMemory,
      },
      {
        key: "tasks",
        title: "事项簿",
        desc: "查看和管理待办事项",
        active: page === "tasks",
        onPress: onOpenTasks,
      },
      {
        key: "settings",
        title: "设置",
        desc: "API、模型、头像、背景",
        active: page === "settings",
        onPress: onOpenSettings,
      },
    ],
    [mode, onOpenChat, onOpenMemory, onOpenSettings, onOpenTasks, page]
  );

  useEffect(() => {
    if (open) {
      setMounted(true);
      slide.setValue(0);
      backdrop.setValue(0);
      itemAnims.forEach((value) => value.setValue(0));

      Animated.parallel([
        Animated.spring(slide, {
          toValue: 1,
          useNativeDriver: true,
          friction: 10,
          tension: 78,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();

      Animated.stagger(
        42,
        itemAnims.map((value) =>
          Animated.spring(value, {
            toValue: 1,
            useNativeDriver: true,
            friction: 8,
            tension: 90,
          })
        )
      ).start();
      return;
    }

    if (!mounted) {
      return;
    }

    Animated.parallel([
      Animated.timing(slide, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [backdrop, itemAnims, mounted, open, slide]);

  if (!mounted) {
    return null;
  }

  function handleNavigate(action: () => void) {
    action();
    onClose();
  }

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]} pointerEvents="auto">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-DRAWER_WIDTH, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={styles.title}>菜单</Text>
        <Text style={styles.subtitle}>从这里切换聊天、事项簿、记忆和设置。</Text>

        <View style={styles.itemList}>
          {items.map((item, index) => {
            const translateX = itemAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [-16, 0],
            });
            const opacity = itemAnims[index];

            return (
              <Animated.View
                key={item.key}
                style={{
                  opacity,
                  transform: [{ translateX }],
                }}
              >
                <Pressable
                  onPress={() => handleNavigate(item.onPress)}
                  style={({ pressed }) => [styles.item, item.active && styles.itemActive, pressed && styles.itemPressed]}
                >
                  <Text style={[styles.itemTitle, item.active && styles.itemTitleActive]}>{item.title}</Text>
                  <Text style={[styles.itemDesc, item.active && styles.itemDescActive]}>{item.desc}</Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    flexDirection: "row",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  drawer: {
    width: DRAWER_WIDTH,
    height: "100%",
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 16,
    backgroundColor: "#0E1730",
    borderRightWidth: 1,
    borderRightColor: "rgba(146, 171, 255, 0.12)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 8, height: 0 },
    elevation: 16,
  },
  title: {
    color: "#F5F7FF",
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 6,
    color: "#9BA9C7",
    fontSize: 13,
    lineHeight: 18,
  },
  itemList: {
    marginTop: 14,
    gap: 12,
  },
  item: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.12)",
  },
  itemActive: {
    backgroundColor: "rgba(94,133,255,0.22)",
    borderColor: "rgba(94,133,255,0.55)",
  },
  itemPressed: {
    opacity: 0.86,
  },
  itemTitle: {
    color: "#F5F7FF",
    fontSize: 16,
    fontWeight: "700",
  },
  itemTitleActive: {
    color: "#FFFFFF",
  },
  itemDesc: {
    marginTop: 4,
    color: "#A9B7C7",
    fontSize: 12,
    lineHeight: 18,
  },
  itemDescActive: {
    color: "#D9E4FF",
  },
});

