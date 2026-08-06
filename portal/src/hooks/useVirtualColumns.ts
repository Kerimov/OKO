import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

export type VirtualColumnsState = {
  /** Absolute indices into the full column list (including frozen). */
  startIndex: number;
  endIndex: number;
  offsetLeft: number;
  offsetRight: number;
  totalWidth: number;
  enabled: boolean;
  /** Frozen columns always rendered (prefix of columns). */
  frozenCount: number;
};

const DEFAULT_OVERSCAN = 4;
const DEFAULT_THRESHOLD = 24;
const DEFAULT_COL_WIDTH = 100;

/**
 * Horizontal column window for very wide tables.
 * Frozen columns (first `frozenCount`) stay mounted; the rest are windowed.
 */
export function useVirtualColumns(
  scrollRef: RefObject<HTMLElement | null>,
  columnCount: number,
  opts?: {
    overscan?: number;
    threshold?: number;
    enabled?: boolean;
    frozenCount?: number;
    columnWidth?: number | ((index: number) => number);
  }
): VirtualColumnsState & {
  onScroll: () => void;
  scrollColumnIntoView: (colIndex: number) => void;
} {
  const overscan = opts?.overscan ?? DEFAULT_OVERSCAN;
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const frozenCount = Math.max(0, Math.min(columnCount, opts?.frozenCount ?? 0));
  const forceEnabled = opts?.enabled;
  const enabled = forceEnabled ?? columnCount - frozenCount > threshold;
  const colWidthOpt = opts?.columnWidth;
  const widthAt = useCallback(
    (index: number): number => {
      if (typeof colWidthOpt === "function") return colWidthOpt(index);
      return colWidthOpt ?? DEFAULT_COL_WIDTH;
    },
    [colWidthOpt]
  );

  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(800);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollLeft(el.scrollLeft);
    setViewportWidth(el.clientWidth || 800);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    measure();
    const onScroll = () => setScrollLeft(el.scrollLeft);
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
  }, [enabled, measure, scrollRef, columnCount]);

  const widths = useMemo(() => {
    const w: number[] = [];
    for (let i = 0; i < columnCount; i++) w.push(widthAt(i));
    return w;
  }, [columnCount, widthAt]);

  const prefix: number[] = useMemo(() => {
    const p = [0];
    for (let i = 0; i < columnCount; i++) p.push(p[i] + widths[i]);
    return p;
  }, [columnCount, widths]);

  const totalWidth = prefix[columnCount] ?? 0;
  const scrollableStart = frozenCount;

  const windowed = useMemo(() => {
    if (!enabled || columnCount <= frozenCount) {
      return {
        startIndex: 0,
        endIndex: columnCount,
        offsetLeft: 0,
        offsetRight: 0,
        totalWidth,
        enabled: false,
        frozenCount,
      };
    }
    // scrollLeft applies to full table including frozen sticky cols — approximate
    // window over non-frozen range.
    const frozenWidth = prefix[frozenCount] ?? 0;
    const rel = Math.max(0, scrollLeft);
    let start = scrollableStart;
    while (start < columnCount && prefix[start + 1] - frozenWidth < rel) start++;
    start = Math.max(scrollableStart, start - overscan);
    let end = start;
    const rightEdge = rel + viewportWidth + frozenWidth;
    while (end < columnCount && prefix[end] < rightEdge) end++;
    end = Math.min(columnCount, end + overscan);
    return {
      startIndex: start,
      endIndex: end,
      offsetLeft: Math.max(0, (prefix[start] ?? 0) - frozenWidth),
      offsetRight: Math.max(0, totalWidth - (prefix[end] ?? totalWidth)),
      totalWidth,
      enabled: true,
      frozenCount,
    };
  }, [
    enabled,
    columnCount,
    frozenCount,
    scrollableStart,
    scrollLeft,
    viewportWidth,
    overscan,
    prefix,
    totalWidth,
  ]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollLeft(el.scrollLeft);
  }, [scrollRef]);

  const scrollColumnIntoView = useCallback(
    (colIndex: number) => {
      const el = scrollRef.current;
      if (!el || !enabled) return;
      if (colIndex < frozenCount) return;
      const left = prefix[colIndex] ?? 0;
      const right = prefix[colIndex + 1] ?? left;
      const frozenWidth = prefix[frozenCount] ?? 0;
      const viewLeft = el.scrollLeft + frozenWidth;
      const viewRight = el.scrollLeft + el.clientWidth;
      if (left < viewLeft) {
        el.scrollLeft = Math.max(0, left - frozenWidth);
      } else if (right > viewRight) {
        el.scrollLeft = Math.max(0, right - el.clientWidth);
      }
    },
    [enabled, frozenCount, prefix, scrollRef]
  );

  return { ...windowed, onScroll, scrollColumnIntoView };
}
