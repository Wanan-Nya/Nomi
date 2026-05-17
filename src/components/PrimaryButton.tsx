import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, StyleProp, ViewStyle } from "react-native";

type Props = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ title, onPress, loading, disabled, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={[styles.button, style, (loading || disabled) && styles.disabled]}
    >
      {loading ? <ActivityIndicator color="#081120" /> : <Text style={styles.text}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#8FB4FF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  disabled: {
    opacity: 0.7,
  },
  text: {
    color: "#081120",
    fontWeight: "800",
    fontSize: 15,
  },
});
