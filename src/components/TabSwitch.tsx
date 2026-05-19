import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  value: "chat" | "image";
  onChange: (value: "chat" | "image") => void;
};

export function TabSwitch({ value, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => onChange("chat")} style={[styles.tab, value === "chat" && styles.activeTab]}>
        <Text style={[styles.label, value === "chat" && styles.activeLabel]}>聊天</Text>
      </Pressable>
      <Pressable onPress={() => onChange("image")} style={[styles.tab, value === "image" && styles.activeTab]}>
        <Text style={[styles.label, value === "image" && styles.activeLabel]}>作图</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  tab: {
    flex: 1,
    borderRadius: 12,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  activeTab: {
    backgroundColor: "#5E85FF",
  },
  label: {
    color: "#9BA9C7",
    fontSize: 14,
    fontWeight: "700",
  },
  activeLabel: {
    color: "#FFFFFF",
  },
});
