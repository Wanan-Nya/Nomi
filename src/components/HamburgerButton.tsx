import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

type Props = {
  onPress: () => void;
};

export function HamburgerButton({ onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.button} accessibilityRole="button" accessibilityLabel="打开菜单">
      <View style={styles.line} />
      <View style={styles.line} />
      <View style={styles.line} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(146, 171, 255, 0.14)",
    gap: 3,
  },
  line: {
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: "#F5F7FF",
  },
});
