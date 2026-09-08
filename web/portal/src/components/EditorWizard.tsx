import type { ReactNode } from "react";

/** Shared methodology-editor chrome (same pattern as расшифровки). */

export function EditorWizardSteps({
  steps,
  value,
  onChange,
  ariaLabel = "Шаги конструктора",
}: {
  steps: string[];
  value: number;
  onChange: (step: number) => void;
  ariaLabel?: string;
}) {
  return (
    <nav className="rash-wizard-steps" aria-label={ariaLabel}>
      {steps.map((label, index) => {
        const step = index + 1;
        return (
          <button
            key={label}
            type="button"
            className={`btn ${value === step ? "btn-primary" : "btn-secondary"}`}
            onClick={() => onChange(step)}
          >
            <span>{step}</span> {label}
          </button>
        );
      })}
    </nav>
  );
}

export function EditorWizardNav({
  step,
  maxStep,
  onBack,
  onNext,
  nextDisabled,
  children,
}: {
  step: number;
  maxStep: number;
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="rash-constructor-navigation">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={step <= 1}
          onClick={onBack}
        >
          ← Назад
        </button>
        {step < maxStep && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={nextDisabled}
            onClick={onNext}
          >
            Далее →
          </button>
        )}
      </div>
      {children ? (
        <div className="rash-constructor-savebar">{children}</div>
      ) : null}
    </>
  );
}
