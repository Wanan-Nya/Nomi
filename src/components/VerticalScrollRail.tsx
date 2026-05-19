import React from "react";
import { StyleSheet, View } from "react-native";

type Props = {
  scrollY: number;
  contentHeight: number;
  layoutHeight: number;
  topOffset?: number;
  bottomOffset?: number;
  rightOffset?: number;
  width?: number;
};

export function VerticalScrollRail({
  scrollY,
  contentHeight,
  layoutHeight,
  topOffset = 0,
  bottomOffset = 0,
  rightOffset = 6,
  width = 4,
}: Props) {
  const trackHeight = Math.max(0, layoutHeight - topOffset - bottomOffset);
  const maxScroll = Math.max(0, contentHeight - layoutHeight);

  if (trackHeight <= 0 || maxScroll <= 0) {
    return null;
  }

  const thumbHeight = Math.max(24, Math.min(trackHeight, (layoutHeight / contentHeight) * trackHeight));
  const thumbTravel = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = topOffset + (scrollY / maxScroll) * thumbTravel;

  return (
    <View pointerEvents="none" style={[styles.track, { top: topOffset, bottom: bottomOffset, right: rightOffset, width }]}>
      <View style={styles.rail} />
      <View style={[styles.thumb, { height: thumbHeight, transform: [{ translateY: thumbTop - topOffset }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  rail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  thumb: {
    position: "absolute",
    left: 0,
    right: 0,
    borderRadius: 999,
    backgroundColor: "rgba(142, 178, 255, 0.82)",
  },
});
