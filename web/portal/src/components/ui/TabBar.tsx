import type { ReactNode } from "react";

export type TabItem = {
  id: string;
  label: ReactNode;
  disabled?: boolean;
};

type Props = {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
};

export function TabBar({ items, value, onChange, className = "", ariaLabel = "Вкладки" }: Props) {
  return (
    <div className={`tab-bar ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "active" : undefined}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
