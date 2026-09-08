import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

export type VirtualRowsState = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  offsetBottom: number;
  totalHeight: number;
  enabled: boolean;
};

const DEFAULT_OVERSCAN = 8;
const DEFAULT_THRESHOLD = 60;

/**
 * Lightweight row window for large tables (no extra deps).
 * Caller must put `scrollRef` on the overflow container and use spacer heights.
 */
export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  opts?: { overscan?: number; threshold?: number; enabled?: boolean }
): VirtualRowsState & { onScroll: () => void; scrollRowIntoView: (rowIndex: number) => void } {
  const overscan = opts?.overscan ?? DEFAULT_OVERSCAN;
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const forceEnabled = opts?.enabled;
  const enabled = forceEnabled ?? rowCount > threshold;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight || 600);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    measure();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
    };
  }, [enabled, measure, scrollRef, rowCount]);

  const totalHeight = rowCount * rowHeight;

  const windowed = useMemo(() => {
    if (!enabled || rowCount === 0) {
      return {
        startIndex: 0,
        endIndex: Math.max(0, rowCount),
        offsetTop: 0,
        offsetBottom: 0,
        totalHeight,
        enabled: false,
      };
    }
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const endIndex = Math.min(rowCount, startIndex + visible);
    return {
      startIndex,
      endIndex,
      offsetTop: startIndex * rowHeight,
      offsetBottom: Math.max(0, (rowCount - endIndex) * rowHeight),
      totalHeight,
      enabled: true,
    };
  }, [enabled, rowCount, rowHeight, scrollTop, viewportHeight, overscan, totalHeight]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, [scrollRef]);

  const scrollRowIntoView = useCallback(
    (rowIndex: number) => {
      const el = scrollRef.current;
      if (!el || !enabled) return;
      const top = rowIndex * rowHeight;
      const bottom = top + rowHeight;
      if (top < el.scrollTop) {
        el.scrollTop = top;
      } else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight;
      }
    },
    [enabled, rowHeight, scrollRef]
  );

  return { ...windowed, onScroll, scrollRowIntoView };
}
