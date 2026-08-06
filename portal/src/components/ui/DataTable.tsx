import type { ReactNode, TableHTMLAttributes } from "react";

type Props = TableHTMLAttributes<HTMLTableElement> & {
  children: ReactNode;
  wrapClassName?: string;
  dense?: boolean;
};

export function DataTable({ children, className = "", wrapClassName = "", dense, ...rest }: Props) {
  return (
    <div className={`table-wrap ${wrapClassName}`.trim()}>
      <table className={`data-table form-table ${dense ? "table-dense" : ""} ${className}`.trim()} {...rest}>
        {children}
      </table>
    </div>
  );
}
