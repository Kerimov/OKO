import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePackage } from "../context/PackageContext";
import { useAuth } from "../context/AuthContext";

export function WelcomePage() {
  const navigate = useNavigate();
  const { setSession, userName } = usePackage();
  const { isAdmin, logout } = useAuth();
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [org, setOrg] = useState("ООО Пример");
  const [zid, setZid] = useState(1);
  const [eid, setEid] = useState(202601);
  const [periodStart, setPeriodStart] = useState("2026-01-01");
  const [periodEnd, setPeriodEnd] = useState("2026-03-31");

  if (!window.oko) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>ОКО Заполнение</h1>
          <p className="error">Ошибка запуска: не загружен модуль приложения. Переустановите программу.</p>
        </div>
      </div>
    );
  }

  const handlePickFolder = async () => {
    const picked = await window.oko.pickFolder();
    if (picked) setFolderPath(picked);
  };

  const handleOpen = async () => {
    if (!folderPath.trim()) {
      setError("Укажите путь к папке комплекта");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await window.oko.openPackage(folderPath.trim());
      if (result.instanceCount === 0) {
        await window.oko.seedPackage();
      }
      const info = await window.oko.getSessionInfo();
      if (info) setSession(info);
      else
        setSession({
          folderPath: result.folderPath,
          meta: result.meta,
          instanceCount: result.instanceCount || (await window.oko.listInstances()).length,
        });
      navigate("/package");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка открытия");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!folderPath.trim()) {
      setError("Укажите папку для нового комплекта");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await window.oko.createPackage({
        folderPath: folderPath.trim(),
        zid,
        eid,
        organization: org,
        periodStart,
        periodEnd,
        enterpriseCode: "1@1",
      });
      const info = await window.oko.getSessionInfo();
      if (info) setSession(info);
      else
        setSession({
          folderPath: result.folderPath,
          meta: result.meta,
          instanceCount: result.instanceCount,
        });
      navigate("/package");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setBusy(false);
    }
  };

  const handleImportJson = async () => {
    const jsonPath = await window.oko.pickJsonFile();
    if (!jsonPath) return;
    if (!folderPath.trim()) {
      setError("Сначала укажите папку, куда положить комплект");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await window.oko.importJson(folderPath.trim(), jsonPath);
      const info = await window.oko.getSessionInfo();
      if (info) setSession(info);
      navigate("/package");
    } catch (e) {
      await window.oko.closePackage();
      setSession(null);
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>ОКО Заполнение</h1>
        <p className="muted">Десктоп для совместного заполнения комплекта в сетевой папке</p>
        <p className="welcome-user">
          Вы вошли как <strong>{userName}</strong>
          {isAdmin && (
            <>
              {" · "}
              <Link to="/admin">Управление пользователями</Link>
            </>
          )}
          {" · "}
          <button
            type="button"
            className="btn-link"
            onClick={() => void logout().then(() => navigate("/login"))}
          >
            Выйти
          </button>
        </p>

        <label className="field">
          <span>Папка комплекта</span>
          <div className="field-row">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="\\server\oko\Romashka_2026Q2"
            />
            <button type="button" onClick={() => void handlePickFolder()}>
              Обзор…
            </button>
          </div>
        </label>

        {error && <p className="error">{error}</p>}

        <div className="welcome-actions">
          <button type="button" disabled={busy} onClick={() => void handleOpen()}>
            Открыть комплект
          </button>
          <button type="button" disabled={busy} onClick={() => setCreateMode((v) => !v)}>
            {createMode ? "Скрыть создание" : "Создать новый"}
          </button>
          <button type="button" disabled={busy} onClick={() => void handleImportJson()}>
            Импорт JSON от ЦО
          </button>
        </div>

        {createMode && (
          <div className="create-panel">
            <h2>Новый комплект</h2>
            <label className="field">
              <span>Организация</span>
              <input value={org} onChange={(e) => setOrg(e.target.value)} />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>ZID</span>
                <input
                  type="number"
                  value={zid}
                  onChange={(e) => setZid(parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <label className="field">
                <span>EID</span>
                <input
                  type="number"
                  value={eid}
                  onChange={(e) => setEid(parseInt(e.target.value, 10) || 0)}
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field">
                <span>Начало периода</span>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Конец периода</span>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void handleCreate()}>
              Создать и открыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
