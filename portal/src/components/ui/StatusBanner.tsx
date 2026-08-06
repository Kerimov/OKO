import type { ReactNode } from "react";

export type BannerTone = "success" | "error" | "warning" | "info";

type Props = {
  tone?: BannerTone;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
};

const TONE_CLASS: Record<BannerTone, string> = {
  success: "",
  error: "status-bar-error",
  warning: "status-bar-warning",
  info: "status-bar-info",
};

export function StatusBanner({ tone = "success", children, className = "", role }: Props) {
  const classes = ["status-bar", TONE_CLASS[tone], className].filter(Boolean).join(" ");
  return (
    <div className={classes} role={role ?? (tone === "error" ? "alert" : "status")}>
      {children}
    </div>
  );
}
