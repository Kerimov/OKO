export type StatusTone =
  | "draft"
  | "submitted"
  | "returned"
  | "corrected"
  | "accepted"
  | "collecting"
  | "pending"
  | "pending_curator_approval"
  | "curator_approved"
  | "completed"
  | "blocked"
  | "error"
  | "warning"
  | "imported"
  | "exported"
  | "not_started"
  | "neutral";

const TONE_ALIASES: Record<string, StatusTone> = {
  draft: "draft",
  submitted: "submitted",
  returned: "returned",
  corrected: "corrected",
  accepted: "accepted",
  collecting: "collecting",
  pending: "pending_curator_approval",
  pending_curator_approval: "pending_curator_approval",
  curator_approved: "curator_approved",
  completed: "completed",
  blocked: "blocked",
  error: "error",
  warning: "warning",
  imported: "imported",
  exported: "exported",
  not_started: "not_started",
  neutral: "neutral",
};

type Props = {
  status?: string | null;
  tone?: StatusTone;
  label: string;
  className?: string;
  title?: string;
};

export function normalizeStatusTone(status?: string | null): StatusTone {
  if (!status) return "neutral";
  const key = status.trim().toLowerCase().replace(/\s+/g, "_");
  return TONE_ALIASES[key] ?? "neutral";
}

export function StatusBadge({ status, tone, label, className = "", title }: Props) {
  const resolved = normalizeStatusTone(tone ?? status);
  return (
    <span className={`status-badge ${resolved} ${className}`.trim()} title={title}>
      {label}
    </span>
  );
}
