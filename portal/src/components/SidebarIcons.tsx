import type { ReactNode } from "react";

export type SidebarIconName =
  | "catalog"
  | "forms"
  | "packages"
  | "bp"
  | "exchange"
  | "templates"
  | "checks"
  | "saldo"
  | "excel"
  | "rash"
  | "aggregation"
  | "users"
  | "audit"
  | "refs"
  | "perimeter"
  | "units"
  | "integrations"
  | "reports"
  | "explanations"
  | "help"
  | "settings";

const svgProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function Icon({ children }: { children: ReactNode }) {
  return <svg {...svgProps}>{children}</svg>;
}

const ICONS: Record<SidebarIconName, ReactNode> = {
  catalog: (
    <Icon>
      <path d="M4 6h6v6H4zM14 6h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </Icon>
  ),
  forms: (
    <Icon>
      <path d="M8 4h8a2 2 0 0 1 2 2v14l-6-3-6 3V6a2 2 0 0 1 2-2z" />
      <path d="M9 9h6M9 13h4" />
    </Icon>
  ),
  packages: (
    <Icon>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
    </Icon>
  ),
  bp: (
    <Icon>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="2.5" />
      <path d="M8.2 8.5 10.5 14M15.8 8.5 13.5 14" />
    </Icon>
  ),
  exchange: (
    <Icon>
      <path d="M7 7h11l-2.5-2.5M17 17H6l2.5 2.5" />
      <path d="M18 7v5M6 17v-5" />
    </Icon>
  ),
  templates: (
    <Icon>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </Icon>
  ),
  checks: (
    <Icon>
      <path d="M9 11.5 11 13.5 15.5 9" />
      <path d="M6 4h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    </Icon>
  ),
  saldo: (
    <Icon>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15v-4M12 15V8M16 15v-6" />
    </Icon>
  ),
  excel: (
    <Icon>
      <path d="M8 4h9a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H8l-4-4V5a1 1 0 0 1 1-1h3z" />
      <path d="M10 10h7M10 14h7M14 6v14" />
    </Icon>
  ),
  rash: (
    <Icon>
      <path d="M8 5h11v14H8z" />
      <path d="M5 8h3M5 12h3M5 16h3M11 9h5M11 13h5M11 17h3" />
    </Icon>
  ),
  aggregation: (
    <Icon>
      <path d="M4 18V10M9 18V6M14 18v-5M19 18V8" />
    </Icon>
  ),
  users: (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M15.2 19a4.2 4.2 0 0 1 5.3-3.2" />
    </Icon>
  ),
  audit: (
    <Icon>
      <path d="M12 4v10" />
      <path d="M8 8h8" />
      <circle cx="12" cy="18" r="2.5" />
    </Icon>
  ),
  refs: (
    <Icon>
      <path d="M5 6h14v3H5zM5 11h14v3H5zM5 16h10v3H5z" />
    </Icon>
  ),
  perimeter: (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </Icon>
  ),
  units: (
    <Icon>
      <path d="M4 18V8l4-3 4 3v10" />
      <path d="M12 18V9l4-3 4 3v9" />
      <path d="M4 18h16" />
    </Icon>
  ),
  integrations: (
    <Icon>
      <path d="M8 8h3v3H8zM13 13h3v3h-3z" />
      <path d="M11 9.5h2.5V13M13 14.5H10.5V11" />
    </Icon>
  ),
  reports: (
    <Icon>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 13h6M9 17h4M15 4v3h3" />
    </Icon>
  ),
  explanations: (
    <Icon>
      <path d="M6 5h12v10H9l-3 3V5z" />
      <path d="M9 9h6M9 12h4" />
    </Icon>
  ),
  help: (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.6 9.2a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.2.9-1.2 1.8" />
      <path d="M12 17h.01" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6" />
    </Icon>
  ),
};

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return <>{ICONS[name]}</>;
}
