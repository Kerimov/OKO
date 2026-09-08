import { useId, useState, type ReactNode } from "react";

export type CollapsibleFiltersProps = {
  title?: string;
  /** Number of non-default filters currently applied (shown as a badge when collapsed). */
  activeCount?: number;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

/** Shared collapsible filter panel — collapsed by default across the portal. */
export function CollapsibleFilters({
  title = "Фильтры",
  activeCount = 0,
  defaultOpen = false,
  className,
  bodyClassName,
  children,
}: CollapsibleFiltersProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div
      className={[
        "collapsible-filters",
        open ? "is-open" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="collapsible-filters-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="collapsible-filters-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="collapsible-filters-title">{title}</span>
        {activeCount > 0 ? (
          <span className="collapsible-filters-badge" title="Активных фильтров">
            {activeCount}
          </span>
        ) : null}
        <span className="collapsible-filters-hint">
          {open ? "Свернуть" : "Развернуть"}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          className={["collapsible-filters-body", bodyClassName ?? ""]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Count truthy “filter is active” flags for the badge. */
export function countActiveFilters(...flags: boolean[]): number {
  return flags.reduce((n, f) => n + (f ? 1 : 0), 0);
}
