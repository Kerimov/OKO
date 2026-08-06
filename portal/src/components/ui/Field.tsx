import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type FieldBase = {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  htmlFor?: string;
};

type InputProps = FieldBase & {
  as?: "input";
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

type SelectProps = FieldBase & {
  as: "select";
  selectProps?: SelectHTMLAttributes<HTMLSelectElement>;
  children: ReactNode;
};

type Props = InputProps | SelectProps;

export function Field(props: Props) {
  const { label, hint, className = "", htmlFor } = props;
  return (
    <label className={`ui-field ${className}`.trim()} htmlFor={htmlFor}>
      <span>{label}</span>
      {props.as === "select" ? (
        <select className="ui-select" id={htmlFor} {...props.selectProps}>
          {props.children}
        </select>
      ) : (
        <input className="ui-input" id={htmlFor} {...props.inputProps} />
      )}
      {hint ? <small className="ui-field-hint">{hint}</small> : null}
    </label>
  );
}
