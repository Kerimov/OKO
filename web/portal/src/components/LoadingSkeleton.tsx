type Props = {
  variant?: "cards" | "rows" | "form";
  count?: number;
  label?: string;
};

export function LoadingSkeleton({
  variant = "rows",
  count = 6,
  label = "Загрузка…",
}: Props) {
  if (variant === "cards") {
    return (
      <div className="skeleton-block" aria-busy="true" aria-label={label}>
        <div className="skeleton-hero" />
        <div className="skeleton-grid">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div className="skeleton-block" aria-busy="true" aria-label={label}>
        <div className="skeleton-toolbar" />
        <div className="skeleton-table">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="skeleton-block" aria-busy="true" aria-label={label}>
      <div className="skeleton-hero skeleton-hero-compact" />
      <div className="skeleton-table">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    </div>
  );
}
