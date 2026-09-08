import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export type CommandItem = {
  id: string;
  label: string;
  hint?: string;
  to: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
};

export function CommandPalette({ open, onClose, items }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint?.toLowerCase().includes(q) ||
        item.to.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[active];
        if (item) {
          navigate(item.to);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, navigate, onClose]);

  if (!open) return null;

  return (
    <div
      className="command-palette-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Быстрый переход"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="command-palette">
        <input
          ref={inputRef}
          className="command-palette-input"
          type="search"
          placeholder="Перейти к разделу, форме, настройкам…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-autocomplete="list"
        />
        <ul className="command-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette-empty">Ничего не найдено</li>
          ) : (
            filtered.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`command-palette-item${idx === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => {
                    navigate(item.to);
                    onClose();
                  }}
                >
                  <span className="command-palette-item-label">{item.label}</span>
                  {item.hint && (
                    <span className="command-palette-item-hint">{item.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="command-palette-footer">
          <span>↑↓ навигация</span>
          <span>Enter открыть</span>
          <span>Esc закрыть</span>
        </div>
      </div>
    </div>
  );
}
