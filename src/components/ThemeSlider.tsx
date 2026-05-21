import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";

type ThemeSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number) {
  if (step <= 0) {
    return value;
  }

  return Math.round(value / step) * step;
}

export function ThemeSlider({ label, value, min, max, step = 1, unit = "", onChange }: ThemeSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (!trackWidth) {
            return;
          }

          const nextValue = valueFromTouch(event.nativeEvent.locationX, trackWidth, min, max, step);
          onChangeRef.current(clamp(nextValue, min, max));
        },
        onPanResponderMove: (event) => {
          if (!trackWidth) {
            return;
          }

          const nextValue = valueFromTouch(event.nativeEvent.locationX, trackWidth, min, max, step);
          onChangeRef.current(clamp(nextValue, min, max));
        },
      }),
    [max, min, step, trackWidth]
  );

  const percentage = trackWidth > 0 ? clamp((value - min) / (max - min || 1), 0, 1) : clamp((valueRef.current - min) / (max - min || 1), 0, 1);
  const formattedValue = `${Math.round(value)}${unit}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{formattedValue}</Text>
      </View>
      <View
        {...responder.panHandlers}
        style={styles.trackWrap}
        onLayout={(event) => {
          const nextWidth = Math.max(0, Math.round(event.nativeEvent.layout.width));
          setTrackWidth(nextWidth);
        }}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${percentage * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${percentage * 100}%` }]} />
      </View>
    </View>
  );
}

function valueFromTouch(locationX: number, width: number, min: number, max: number, step: number) {
  if (width <= 0) {
    return min;
  }

  const progress = clamp(locationX / width, 0, 1);
  const rawValue = min + (max - min) * progress;
  return roundToStep(rawValue, step);
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    color: "#F5F7FF",
    fontSize: 12,
    fontWeight: "800",
  },
  value: {
    color: "#9FB0D4",
    fontSize: 11,
    fontWeight: "700",
  },
  trackWrap: {
    position: "relative",
    height: 28,
    justifyContent: "center",
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#5E85FF",
  },
  thumb: {
    position: "absolute",
    top: 6,
    width: 16,
    height: 16,
    marginLeft: -8,
    borderRadius: 999,
    backgroundColor: "#F7FAFF",
    borderWidth: 2,
    borderColor: "#5E85FF",
  },
});
