/**
 * Optional Univer OSS host contract.
 *
 * The default UI uses the native OKO SpreadsheetFormTable (Apache-compatible,
 * no extra deps). When `@univerjs/*` packages are installed, a future host can
 * implement this interface and be selected via VITE_SPREADSHEET_BACKEND=univer.
 *
 * License note: Univer core is Apache-2.0. Avoid HyperFormula (GPLv3/commercial).
 *
 * Portal host: `portal/src/components/UniverFormHost.tsx` (VITE_SPREADSHEET_BACKEND=univer).
 */
import type { SheetModel, CellPatch, RangeSelection } from "./types.js";
import { FORMULA_WHITELIST } from "./formulaWhitelist.js";

export interface UniverHostCapabilities {
  selection: boolean;
  clipboard: boolean;
  fillHandle: boolean;
  undoRedo: boolean;
  formulaBar: boolean;
  headlessParity: boolean;
}

export interface UniverHostAdapter {
  kind: "univer";
  capabilities: UniverHostCapabilities;
  /** Mount into HTMLElement; returns disposer. */
  mount(el: HTMLElement, model: SheetModel): () => void;
  getSelection(): RangeSelection | null;
  applyPatches(patches: CellPatch[]): void;
  getModel(): SheetModel;
}

export const UNIVER_SPIKE_NOTES = {
  packages: [
    "@univerjs/presets",
    "@univerjs/preset-sheets-core",
    "@univerjs/preset-sheets-formula",
  ],
  whitelist: FORMULA_WHITELIST,
  decision:
    "Use Univer only behind SpreadsheetBackend='univer'. Default production path is native grid + @oko/spreadsheet formula engine for controlled forms.",
} as const;

/** Placeholder until Univer packages are added to portal dependencies. */
export function createUniverHostStub(): UniverHostAdapter {
  throw new Error(
    "Univer host не подключён. Используйте backend=native или установите @univerjs/presets."
  );
}
