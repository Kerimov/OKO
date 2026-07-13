import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KontrAgent } from "../types";
import { searchKontrAgents } from "../storage";
import { findKontrAgent } from "../engine/rashEngine";

const LARGE_LIST_THRESHOLD = 400;

interface KontrInputProps {
  value: string;
  onChange: (value: string) => void;
  onPick?: (agent: KontrAgent) => void;
  agents: KontrAgent[];
  listId: string;
  orgTypes?: number[];
  placeholder?: string;
  readOnly?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
}

export function useKontrListMode(agents: KontrAgent[]): "datalist" | "search" {
  return agents.length > LARGE_LIST_THRESHOLD ? "search" : "datalist";
}

export function KontrInput({
  value,
  onChange,
  onPick,
  agents,
  listId,
  orgTypes,
  placeholder = "Контрагент…",
  readOnly = false,
  onFocus,
  onBlur,
  className,
}: KontrInputProps) {
  const mode = useKontrListMode(agents);
  const [suggestions, setSuggestions] = useState<KontrAgent[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const datalistAgents = useMemo(() => agents, [agents]);

  const runSearch = useCallback(
    async (q: string) => {
      if (mode !== "search") return;
      const found = await searchKontrAgents(q, orgTypes, 80);
      setSuggestions(found);
      setOpen(found.length > 0);
    },
    [mode, orgTypes]
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (readOnly) return <>{value}</>;

  if (mode === "datalist") {
    return (
      <>
        <datalist id={listId}>
          {datalistAgents.map((k) => (
            <option key={k.id} value={k.name} label={k.inn ? `ИНН ${k.inn}` : undefined} />
          ))}
        </datalist>
        <input
          type="text"
          list={listId}
          className={className}
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
            const agent = findKontrAgent(agents, v);
            if (agent && onPick) onPick(agent);
          }}
        />
      </>
    );
  }

  return (
    <div className="kontr-search-wrap">
      <input
        type="text"
        className={className}
        value={value}
        placeholder={placeholder}
        onFocus={() => {
          onFocus?.();
          if (value.trim()) void runSearch(value);
        }}
        onBlur={() => {
          onBlur?.();
          setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void runSearch(v), 200);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="kontr-search-suggestions" role="listbox">
          {suggestions.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className="kontr-search-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(k.name);
                  onPick?.(k);
                  setOpen(false);
                }}
              >
                <span>{k.name}</span>
                {k.inn && <span className="kontr-search-inn">ИНН {k.inn}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
