/** Выбор графы: из списка колонок формы или произвольный ключ (B, C, AA…). */

const CUSTOM = "__custom__";

export function normalizeColKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function ColumnKeyInput({
  value,
  columns,
  onChange,
  allowEmpty = false,
  emptyLabel = "—",
  id,
}: {
  value: string;
  columns: Array<{ key: string; label?: string }>;
  onChange: (next: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
}) {
  const normalized = normalizeColKey(value);
  const known = new Set(columns.map((c) => c.key.toUpperCase()));
  const isCustom = normalized !== "" && !known.has(normalized);
  const selectValue = !normalized
    ? ""
    : isCustom
      ? CUSTOM
      : columns.find((c) => c.key.toUpperCase() === normalized)?.key ?? CUSTOM;

  return (
    <div className="rash-col-key-input">
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            onChange(normalized && !known.has(normalized) ? normalized : "");
            return;
          }
          onChange(v);
        }}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
            {c.label ? ` — ${c.label}` : ""}
          </option>
        ))}
        <option value={CUSTOM}>Своя графа…</option>
      </select>
      {(selectValue === CUSTOM || isCustom) && (
        <input
          value={value}
          placeholder="напр. K или AA"
          aria-label="Произвольная графа"
          onChange={(e) => onChange(normalizeColKey(e.target.value))}
          style={{ maxWidth: "6rem" }}
        />
      )}
    </div>
  );
}
