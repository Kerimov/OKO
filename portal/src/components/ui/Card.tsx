import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
  as?: "div" | "section" | "article";
};

export function Card({ children, className = "", title, actions, as: Tag = "section" }: Props) {
  return (
    <Tag className={`ui-card tools-section ${className}`.trim()}>
      {(title || actions) && (
        <div className="ui-card-header">
          {title ? <h2 className="ui-card-title">{title}</h2> : <div />}
          {actions ? <div className="page-header-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </Tag>
  );
}
