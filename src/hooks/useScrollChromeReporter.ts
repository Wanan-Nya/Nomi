import { useCallback, useRef } from "react";

export type ScrollChromeState = {
  direction?: "up" | "down";
  atTop: boolean;
};

type Options = {
  directionThreshold?: number;
  topThreshold?: number;
};

export function useScrollChromeReporter(
  onScrollState?: (state: ScrollChromeState) => void,
  options: Options = {}
) {
  const lastOffsetY = useRef(0);
  const wasAtTop = useRef(true);
  const directionThreshold = options.directionThreshold ?? 10;
  const topThreshold = options.topThreshold ?? 2;

  return useCallback(
    (offsetY: number) => {
      const nextY = Math.max(0, offsetY);
      const atTop = nextY <= topThreshold;
      const delta = nextY - lastOffsetY.current;
      lastOffsetY.current = nextY;

      if (atTop) {
        if (!wasAtTop.current) {
          onScrollState?.({ atTop: true });
        }
        wasAtTop.current = true;
        return;
      }

      wasAtTop.current = false;

      if (Math.abs(delta) < directionThreshold) {
        return;
      }

      onScrollState?.({ atTop: false, direction: delta > 0 ? "up" : "down" });
    },
    [directionThreshold, onScrollState, topThreshold]
  );
}
