import { useState } from "react";

interface Props {
  open: boolean;
  title: string;
  requirePin: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean | void>;
}

export function CoordinatorPinModal({ open, title, requirePin, onClose, onSubmit }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (requirePin && !pin.trim()) {
      setError("Введите ПИН");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ok = await onSubmit(pin);
      if (ok === false) {
        setError("Неверный ПИН");
        return;
      }
      setPin("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>{title}</h2>
        <label className="field">
          <span>ПИН координатора</span>
          <input
            type="password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? "…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SetPinProps {
  open: boolean;
  hasExistingPin: boolean;
  onClose: () => void;
  onSave: (pin: string, oldPin?: string) => Promise<void>;
}

export function SetCoordinatorPinModal({ open, hasExistingPin, onClose, onSave }: SetPinProps) {
  const [pin, setPin] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(pin, hasExistingPin ? oldPin : undefined);
      setPin("");
      setOldPin("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>{hasExistingPin ? "Сменить ПИН координатора" : "Задать ПИН координатора"}</h2>
        {hasExistingPin && (
          <label className="field">
            <span>Текущий ПИН</span>
            <input
              type="password"
              value={oldPin}
              onChange={(e) => setOldPin(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          <span>{hasExistingPin ? "Новый ПИН" : "ПИН"}</span>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
        </label>
        <p className="muted modal-hint">Минимум 4 символа. Нужен для экспорта и разблокировки ячеек.</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void handleSave()}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
