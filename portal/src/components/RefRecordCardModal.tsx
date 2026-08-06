import { useEffect, useState } from "react";
import type { RashRefItem } from "../engine/rashRefs";

export type KontrCardDraft = {
  id: number | null;
  name: string;
  oldName: string;
  inn: string;
  kpp: string;
  orgType: string;
  idObdnsi: string;
  isNew?: boolean;
  dirty?: boolean;
};

export type OrgCardDraft = {
  zid: number | null;
  name: string;
  code: string;
  parentZid: number | "";
  isNew?: boolean;
};

export type OrgParentOption = { zid: number; label: string };

function orgTypeLabel(v: string): string {
  if (v === "1") return "1 ВГ";
  if (v === "2") return "2 assoc";
  if (v === "3") return "3 внешн.";
  return v || "—";
}

type ClassifierProps = {
  kind: "classifier";
  directoryTitle: string;
  item: RashRefItem;
  canEdit: boolean;
  showNewkod: boolean;
  busy?: boolean;
  onSave: (item: RashRefItem) => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void | Promise<void>;
};

type KontrProps = {
  kind: "kontr";
  item: KontrCardDraft;
  canEdit: boolean;
  busy?: boolean;
  onSave: (item: KontrCardDraft) => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void | Promise<void>;
};

type OrgProps = {
  kind: "org";
  item: OrgCardDraft;
  parentOptions: OrgParentOption[];
  canEdit: boolean;
  busy?: boolean;
  onSave: (item: OrgCardDraft) => void | Promise<void>;
  onClose: () => void;
};

type Props = ClassifierProps | KontrProps | OrgProps;

export function RefRecordCardModal(props: Props) {
  const [draft, setDraft] = useState(props.item);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = Boolean(props.busy || localBusy);

  useEffect(() => {
    setDraft(props.item);
  }, [props.item]);

  const title =
    props.kind === "kontr"
      ? (draft as KontrCardDraft).id != null
        ? `Контрагент #${(draft as KontrCardDraft).id}`
        : "Новый контрагент"
      : props.kind === "org"
        ? (draft as OrgCardDraft).zid != null
          ? `Организация ZID ${(draft as OrgCardDraft).zid}`
          : "Новая организация"
        : `Запись · ${props.directoryTitle}`;

  const patchDraft = (patch: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, ...patch }) as typeof prev);
  };

  const handleSave = async () => {
    if (!props.canEdit || busy) return;
    setLocalBusy(true);
    try {
      if (props.kind === "kontr") {
        await props.onSave(draft as KontrCardDraft);
      } else if (props.kind === "org") {
        await props.onSave(draft as OrgCardDraft);
      } else {
        await props.onSave(draft as RashRefItem);
      }
    } finally {
      setLocalBusy(false);
    }
  };

  const handleDelete = async () => {
    if (props.kind === "org" || !("onDelete" in props) || !props.onDelete || busy) {
      return;
    }
    setLocalBusy(true);
    try {
      await props.onDelete();
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div
      className="refs-card-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) props.onClose();
      }}
    >
      <div
        className="refs-card-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="refs-card-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="refs-card-modal-header">
          <div>
            <h2 id="refs-card-modal-title">{title}</h2>
            <p className="refs-card-modal-sub">Карточка записи справочника</p>
          </div>
          <button
            type="button"
            className="btn-icon"
            aria-label="Закрыть"
            disabled={busy}
            onClick={props.onClose}
          >
            ×
          </button>
        </header>

        <div className="refs-card-modal-body">
          {props.kind === "classifier" ? (
            <>
              <label className="refs-entry-field">
                <span>Код</span>
                {props.canEdit ? (
                  <input
                    autoFocus
                    value={(draft as RashRefItem).kod}
                    disabled={busy}
                    onChange={(e) => patchDraft({ kod: e.target.value })}
                  />
                ) : (
                  <strong>{(draft as RashRefItem).kod || "—"}</strong>
                )}
              </label>
              <label className="refs-entry-field">
                <span>Значение</span>
                {props.canEdit ? (
                  <input
                    value={(draft as RashRefItem).value}
                    disabled={busy}
                    onChange={(e) => patchDraft({ value: e.target.value })}
                  />
                ) : (
                  <strong>{(draft as RashRefItem).value || "—"}</strong>
                )}
              </label>
              <label className="refs-entry-field">
                <span>Примечание</span>
                {props.canEdit ? (
                  <input
                    value={(draft as RashRefItem).note ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({ note: e.target.value || null })
                    }
                  />
                ) : (
                  <span>{(draft as RashRefItem).note ?? "—"}</span>
                )}
              </label>
              {props.showNewkod && (
                <label className="refs-entry-field">
                  <span>newkod</span>
                  {props.canEdit ? (
                    <input
                      value={(draft as RashRefItem).newkod ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        patchDraft({ newkod: e.target.value || null })
                      }
                    />
                  ) : (
                    <span>{(draft as RashRefItem).newkod ?? "—"}</span>
                  )}
                </label>
              )}
            </>
          ) : props.kind === "org" ? (
            <>
              <label className="refs-entry-field">
                <span>Наименование</span>
                {props.canEdit ? (
                  <input
                    autoFocus
                    value={(draft as OrgCardDraft).name}
                    disabled={busy}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                  />
                ) : (
                  <strong>{(draft as OrgCardDraft).name || "—"}</strong>
                )}
              </label>
              <div className="refs-entry-card-grid">
                <label className="refs-entry-field">
                  <span>Код</span>
                  {props.canEdit ? (
                    <input
                      value={(draft as OrgCardDraft).code}
                      disabled={busy}
                      onChange={(e) => patchDraft({ code: e.target.value })}
                    />
                  ) : (
                    <span>{(draft as OrgCardDraft).code || "—"}</span>
                  )}
                </label>
                <label className="refs-entry-field">
                  <span>ZID</span>
                  <strong>
                    {(draft as OrgCardDraft).zid != null
                      ? (draft as OrgCardDraft).zid
                      : "назначится при сохранении"}
                  </strong>
                </label>
              </div>
              <label className="refs-entry-field">
                <span>Головная организация</span>
                {props.canEdit ? (
                  <select
                    value={
                      (draft as OrgCardDraft).parentZid === ""
                        ? ""
                        : String((draft as OrgCardDraft).parentZid)
                    }
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({
                        parentZid:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">— нет (корневая) —</option>
                    {props.parentOptions
                      .filter(
                        (o) =>
                          (draft as OrgCardDraft).zid == null ||
                          o.zid !== (draft as OrgCardDraft).zid
                      )
                      .map((o) => (
                        <option key={o.zid} value={o.zid}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                ) : (
                  <span>
                    {(() => {
                      const pid = (draft as OrgCardDraft).parentZid;
                      if (pid === "" || pid == null) return "— нет —";
                      return (
                        props.parentOptions.find((o) => o.zid === pid)?.label ??
                        `ZID ${pid}`
                      );
                    })()}
                  </span>
                )}
              </label>
            </>
          ) : (
            <>
              <label className="refs-entry-field">
                <span>Наименование</span>
                {props.canEdit ? (
                  <input
                    autoFocus
                    value={(draft as KontrCardDraft).name}
                    disabled={busy}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                  />
                ) : (
                  <strong>{(draft as KontrCardDraft).name || "—"}</strong>
                )}
              </label>
              <label className="refs-entry-field">
                <span>Другое наименование</span>
                {props.canEdit ? (
                  <input
                    value={(draft as KontrCardDraft).oldName}
                    disabled={busy}
                    onChange={(e) => patchDraft({ oldName: e.target.value })}
                  />
                ) : (
                  <span>{(draft as KontrCardDraft).oldName || "—"}</span>
                )}
              </label>
              <div className="refs-entry-card-grid">
                <label className="refs-entry-field">
                  <span>ИНН</span>
                  {props.canEdit ? (
                    <input
                      value={(draft as KontrCardDraft).inn}
                      inputMode="numeric"
                      disabled={busy}
                      onChange={(e) => patchDraft({ inn: e.target.value })}
                    />
                  ) : (
                    <span>{(draft as KontrCardDraft).inn || "—"}</span>
                  )}
                </label>
                <label className="refs-entry-field">
                  <span>КПП</span>
                  {props.canEdit ? (
                    <input
                      value={(draft as KontrCardDraft).kpp}
                      inputMode="numeric"
                      disabled={busy}
                      onChange={(e) => patchDraft({ kpp: e.target.value })}
                    />
                  ) : (
                    <span>{(draft as KontrCardDraft).kpp || "—"}</span>
                  )}
                </label>
                <label className="refs-entry-field">
                  <span>Тип</span>
                  {props.canEdit ? (
                    <select
                      value={(draft as KontrCardDraft).orgType}
                      disabled={busy}
                      onChange={(e) => patchDraft({ orgType: e.target.value })}
                    >
                      <option value="">—</option>
                      <option value="1">1 ВГ</option>
                      <option value="2">2 assoc</option>
                      <option value="3">3 внешн.</option>
                    </select>
                  ) : (
                    <span>{orgTypeLabel((draft as KontrCardDraft).orgType)}</span>
                  )}
                </label>
                <label className="refs-entry-field">
                  <span>idOBDNSI</span>
                  {props.canEdit ? (
                    <input
                      value={(draft as KontrCardDraft).idObdnsi}
                      disabled={busy}
                      onChange={(e) => patchDraft({ idObdnsi: e.target.value })}
                    />
                  ) : (
                    <span>{(draft as KontrCardDraft).idObdnsi || "—"}</span>
                  )}
                </label>
              </div>
              {(draft as KontrCardDraft).id != null && (
                <p className="tools-hint">ID: {(draft as KontrCardDraft).id}</p>
              )}
            </>
          )}
        </div>

        <footer className="refs-card-modal-footer">
          {props.canEdit && props.kind !== "org" && "onDelete" in props && props.onDelete && (
            <button
              type="button"
              className="btn btn-danger-outline btn-sm"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              Удалить
            </button>
          )}
          <div className="refs-card-modal-footer-spacer" />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={props.onClose}
          >
            Отмена
          </button>
          {props.canEdit && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
