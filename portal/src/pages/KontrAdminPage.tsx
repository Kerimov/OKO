import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addKontrAgent,
  isBackendMode,
  loadKontrAgents,
  reimportKontrAgents,
  renameKontrAgent,
  updateKontrAgent,
} from "../storage";
import { writeJsonSheetWorkbook, triggerBrowserDownload } from "../engine/excelWorkbook";
import type { KontrAgent } from "../types";
import { useAuth } from "../useAuth";

export function KontrAdminPage() {
  const backend = isBackendMode();
  const auth = useAuth();
  const admin = !auth.authRequired || auth.role === "admin";
  const [agents, setAgents] = useState<KontrAgent[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KontrAgent | null>(null);
  const [editName, setEditName] = useState("");
  const [editOldName, setEditOldName] = useState("");
  const [editInn, setEditInn] = useState("");
  const [editKpp, setEditKpp] = useState("");
  const [editOrgType, setEditOrgType] = useState<number | "">("");
  const [editIdObdnsi, setEditIdObdnsi] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await loadKontrAgents();
      setAgents(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(needle) ||
        (a.inn ?? "").includes(needle) ||
        (a.kpp ?? "").includes(needle) ||
        (a.oldName ?? "").toLowerCase().includes(needle) ||
        (a.idObdnsi ?? "").toLowerCase().includes(needle)
    );
  }, [agents, q]);

  const select = (a: KontrAgent) => {
    setSelected(a);
    setEditName(a.name);
    setEditOldName(a.oldName ?? "");
    setEditInn(a.inn ?? "");
    setEditKpp(a.kpp ?? "");
    setEditOrgType(a.orgType ?? "");
    setEditIdObdnsi(a.idObdnsi ?? "");
    setRenameTo("");
    setStatus("");
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !admin) return;
    setError("");
    try {
      const updated = await updateKontrAgent(selected.id, {
        name: editName.trim(),
        oldName: editOldName.trim() || null,
        inn: editInn.trim() || null,
        kpp: editKpp.trim() || null,
        orgType: editOrgType === "" ? null : Number(editOrgType),
        idObdnsi: editIdObdnsi.trim() || null,
      });
      setStatus(`Сохранено: ${updated.name}`);
      await load();
      select(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  };

  const handleRename = async () => {
    if (!selected || !renameTo.trim()) return;
    try {
      const updated = await renameKontrAgent(selected.id, renameTo.trim());
      setStatus(
        `Переименовано: старое имя в «Другое наименование», теперь «${updated.name}»`
      );
      await load();
      select(updated);
      setRenameTo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка переименования");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const created = await addKontrAgent({ name: newName.trim(), orgType: 3 });
      setStatus(`Создан #${created.id}`);
      setNewName("");
      await load();
      select(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    }
  };

  const handleExcel = async () => {
    const rows = filtered.map((a) => ({
      id: a.id,
      name: a.name,
      oldName: a.oldName ?? "",
      inn: a.inn ?? "",
      kpp: a.kpp ?? "",
      orgType: a.orgType ?? "",
      orgForm: a.orgForm ?? "",
      idOBDNSI: a.idObdnsi ?? "",
      country: a.country ?? "",
      city: a.city ?? "",
      ogrn: a.ogrn ?? "",
    }));
    const bytes = await writeJsonSheetWorkbook(rows, "kontr");
    triggerBrowserDownload(`oko-kontr-${new Date().toISOString().slice(0, 10)}.xlsx`, bytes);
    setStatus(`Excel: ${rows.length} строк (колонка idOBDNSI)`);
  };

  if (!backend) {
    return (
      <div className="admin-page">
        <h1>Справочник контрагентов</h1>
        <p className="hint-text">
          Нужен режим API. Локально доступен <code>kontr.json</code> и отчёт N99 в{" "}
          <Link to="/tools">Инструментах</Link>.
        </p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="admin-page">
        <h1>Справочник контрагентов</h1>
        <p className="error">Только для администратора.</p>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="page-header">
        <h1>Справочник контрагентов</h1>
        <p className="hint-text">
          Access sp_kontr + Excel с GUID ОБДНСИ (`idOBDNSI`). Переименование копирует имя в
          «Другое наименование» (N99). Корпус ограничен данными в БД / <code>kontr.json</code>.
          {agents.length > 0 && agents.length < 50 && (
            <>
              {" "}
              Сейчас загружено <strong>{agents.length}</strong> записей (выборка). Для полного
              справочника укажите production-MDB через{" "}
              <code>OKO_MDB_PATH</code> и запустите{" "}
              <code>scripts/export_rash_support_data.py</code>, затем{" "}
              <code>POST /api/kontr/reimport</code>.
            </>
          )}
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {status && <p className="success">{status}</p>}

      <div className="toolbar-actions" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="search"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: "12rem" }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
          Обновить
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExcel} disabled={filtered.length === 0}>
          Excel (+ idOBDNSI)
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void reimportKontrAgents()
              .then((n) => {
                setStatus(`Реимпорт: ${n}`);
                return load();
              })
              .catch((e) => setError(e instanceof Error ? e.message : "reimport"));
          }}
        >
          Реимпорт из JSON
        </button>
        <Link to="/tools">N99 в инструментах</Link>
      </div>

      <div className="checks-layout">
        <div className="checks-list-panel">
          <h2>Список ({filtered.length})</h2>
          {loading ? (
            <p className="hint-text">Загрузка…</p>
          ) : (
            <ul className="admin-list">
              {filtered.slice(0, 500).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={selected?.id === a.id ? "active" : ""}
                    onClick={() => select(a)}
                  >
                    <code>{a.id}</code> {a.name}
                    {a.idObdnsi ? <span className="hint-text"> · {a.idObdnsi}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="checks-edit-panel">
          <h2>Новый</h2>
          <form onSubmit={(e) => void handleCreate(e)} className="checks-form-grid">
            <label>
              Наименование
              <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
            </label>
            <button type="submit" className="btn btn-primary">
              Создать
            </button>
          </form>

          {selected && (
            <>
              <h2 style={{ marginTop: "1.5rem" }}>
                #{selected.id}
              </h2>
              <form onSubmit={(e) => void handleSave(e)} className="checks-form-grid">
                <label>
                  Наименование
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                </label>
                <label>
                  Другое наименование (oldName)
                  <input value={editOldName} onChange={(e) => setEditOldName(e.target.value)} />
                </label>
                <label>
                  ИНН
                  <input value={editInn} onChange={(e) => setEditInn(e.target.value)} />
                </label>
                <label>
                  КПП
                  <input value={editKpp} onChange={(e) => setEditKpp(e.target.value)} />
                </label>
                <label>
                  orgType (1 ВГ / 2 assoc / 3 внешн.)
                  <input
                    type="number"
                    value={editOrgType}
                    onChange={(e) =>
                      setEditOrgType(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  idOBDNSI (GUID)
                  <input value={editIdObdnsi} onChange={(e) => setEditIdObdnsi(e.target.value)} />
                </label>
                <button type="submit" className="btn btn-primary">
                  Сохранить
                </button>
              </form>

              <div style={{ marginTop: "1rem" }}>
                <h3>Переименовать (N99)</h3>
                <p className="hint-text">
                  Текущее имя уйдёт в «Другое наименование», если oldName пусто.
                </p>
                <div className="toolbar-actions" style={{ gap: "0.5rem" }}>
                  <input
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                    placeholder="Новое наименование"
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!renameTo.trim()}
                    onClick={() => void handleRename()}
                  >
                    Переименовать
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
