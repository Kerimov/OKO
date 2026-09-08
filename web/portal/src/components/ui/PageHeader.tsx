import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className = "" }: Props) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div>
        <h1>{title}</h1>
        {description ? <div className="page-header-desc">{description}</div> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
