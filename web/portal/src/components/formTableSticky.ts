import type { CSSProperties } from "react";

/** Sticky-column geometry for form tables (# + frozen NUM/NAME/…). */

export const FORM_ROW_NUM_WIDTH = 44;

export type FrozenStickyStyle = {
  left: number;
  width: number;
  zIndex: number;
  isLast: boolean;
};

export function frozenColumnWidth(col: {
  key: string;
  width?: number;
}): number {
  if (col.width != null && Number.isFinite(col.width) && col.width > 0) {
    return Math.round(col.width);
  }
  const k = col.key.toLowerCase();
  if (k === "num" || k === "№" || k.endsWith("_num")) return 72;
  if (k === "name" || k.includes("name") || k === "наименование") return 280;
  return 120;
}

/** Cumulative `left` offsets for sticky frozen columns after the # column. */
export function buildFrozenStickyMap(
  columns: Array<{ key: string; frozen?: boolean; width?: number }>
): Map<string, FrozenStickyStyle> {
  const map = new Map<string, FrozenStickyStyle>();
  const frozen = columns.filter((c) => c.frozen);
  let left = FORM_ROW_NUM_WIDTH;
  frozen.forEach((col, index) => {
    const width = frozenColumnWidth(col);
    map.set(col.key, {
      left,
      width,
      // Earlier frozen columns sit above later ones if they ever overlap.
      zIndex: 6 + (frozen.length - index),
      isLast: index === frozen.length - 1,
    });
    left += width;
  });
  return map;
}

export function frozenStickyCss(
  sticky: FrozenStickyStyle | undefined
): CSSProperties | undefined {
  if (!sticky) return undefined;
  return {
    left: sticky.left,
    width: sticky.width,
    minWidth: sticky.width,
    maxWidth: sticky.width,
    zIndex: sticky.zIndex,
  };
}
