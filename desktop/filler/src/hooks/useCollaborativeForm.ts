import { useCallback, useEffect, useRef, useState } from "react";
import type { RowData } from "@portal/types";
import { applyCellChanges } from "../collab/cellMerge";
import { findRowIndexByRowNo } from "../collab/rowIndex";
import type { CellFocusInfo, CellBlurInfo, CellEditInfo } from "@portal/components/FormTable";

export type SyncStatus = "synced" | "syncing" | "offline" | "locked" | "error";

interface Options {
  instanceId: string | undefined;
  userName: string;
  rows: RowData[];
  setRows: (rows: RowData[]) => void;
  disabled?: boolean;
}

export function useCollaborativeForm({
  instanceId,
  userName,
  rows,
  setRows,
  disabled,
}: Options) {
  const [occupiedCells, setOccupiedCells] = useState<Map<string, string>>(new Map());
  const [presenceUsers, setPresenceUsers] = useState<string[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [lockMessage, setLockMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set());

  const settingsRef = useRef({ heartbeatIntervalSec: 5, syncPollIntervalSec: 3 });
  const clientIdRef = useRef<string | null>(null);
  const lastSyncAtRef = useRef(new Date(0).toISOString());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const focusedRef = useRef<CellFocusInfo | null>(null);
  const dirtyKeysRef = useRef(new Set<string>());
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEditRef = useRef<CellEditInfo | null>(null);

  const cellKey = (rowNo: number, columnKey: string) => `${rowNo}:${columnKey}`;

  const isRemoteChange = useCallback(
    (change: { updatedClientId: string | null; updatedBy: string | null }) => {
      const myId = clientIdRef.current;
      if (myId && change.updatedClientId) {
        return change.updatedClientId !== myId;
      }
      return change.updatedBy !== userName;
    },
    [userName]
  );

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!instanceId || disabled) return;
    setSyncStatus("syncing");
    try {
      const [presence, changes] = await Promise.all([
        window.oko.listInstancePresence(instanceId),
        window.oko.listCellChanges(instanceId, lastSyncAtRef.current),
      ]);

      const occ = new Map<string, string>();
      const users = new Set<string>();
      for (const p of presence) {
        occ.set(`${p.rowNo}:${p.columnKey}`, p.userName);
        users.add(p.userName);
      }
      setOccupiedCells(occ);
      setPresenceUsers([...users]);

      if (changes.length > 0) {
        const maxAt = changes.reduce(
          (m, c) => (c.updatedAt > m ? c.updatedAt : m),
          lastSyncAtRef.current
        );
        lastSyncAtRef.current = maxAt;

        const skip = new Set<string>(dirtyKeysRef.current);
        const focused = focusedRef.current;
        if (focused) {
          skip.add(cellKey(focused.rowNo, focused.editColumnKey));
        }

        const remote = changes.filter(isRemoteChange);
        if (remote.length > 0) {
          const flashes = new Set<string>();
          let conflictBy: string | null = null;
          const current = rowsRef.current;

          for (const ch of remote) {
            const key = `${ch.rowNo}:${ch.columnKey}`;
            if (skip.has(key)) continue;
            const idx = findRowIndexByRowNo(current, ch.rowNo);
            if (idx < 0) continue;
            const prev = current[idx][ch.columnKey];
            if (
              prev !== undefined &&
              prev !== ch.value &&
              String(prev ?? "") !== String(ch.value ?? "")
            ) {
              flashes.add(key);
              conflictBy = ch.updatedBy ?? conflictBy;
            }
          }

          setRows(applyCellChanges(current, remote, skip));

          if (flashes.size > 0) {
            setHighlightedCells(flashes);
            setConflictMessage(
              conflictBy
                ? `Значение обновлено пользователем ${conflictBy}`
                : "Значение обновлено другим пользователем"
            );
            setTimeout(() => {
              setHighlightedCells(new Set());
              setConflictMessage("");
            }, 3000);
          }
        }
      }

      setSyncStatus("synced");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("BUSY") || msg.includes("занят")) setSyncStatus("locked");
      else if (msg.includes("не открыт") || msg.includes("ENOENT")) setSyncStatus("offline");
      else setSyncStatus("error");
    }
  }, [instanceId, disabled, setRows, isRemoteChange]);

  useEffect(() => {
    void window.oko.getClientId().then((id) => {
      clientIdRef.current = id;
    });
  }, []);

  useEffect(() => {
    if (!instanceId || disabled) return;
    void window.oko.getCollaborationSettings().then((s) => {
      settingsRef.current = s;
    });
    lastSyncAtRef.current = new Date().toISOString();
    void poll();
    pollTimerRef.current = setInterval(() => void poll(), 3000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      clearHeartbeat();
      void window.oko.releasePresence();
    };
  }, [instanceId, disabled, poll, clearHeartbeat]);

  useEffect(() => {
    if (!pollTimerRef.current || !instanceId || disabled) return;
    const sec = settingsRef.current.syncPollIntervalSec * 1000;
    clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => void poll(), sec);
  }, [instanceId, disabled, poll]);

  const persistCell = useCallback(
    async (info: { rowIndex: number; rowNo: number; saveColumnKey: string; value: string }) => {
      if (!instanceId || disabled) return;
      const row = rowsRef.current[info.rowIndex];
      const rowName = row ? String(row.name ?? "") || null : null;
      try {
        const { updatedAt } = await window.oko.saveCell({
          instanceId,
          rowNo: info.rowNo,
          rowName,
          columnKey: info.saveColumnKey,
          value: info.value,
          userName,
        });
        dirtyKeysRef.current.delete(cellKey(info.rowNo, info.saveColumnKey));
        if (updatedAt > lastSyncAtRef.current) {
          lastSyncAtRef.current = updatedAt;
        }
      } catch {
        dirtyKeysRef.current.add(cellKey(info.rowNo, info.saveColumnKey));
      }
    },
    [instanceId, disabled, userName]
  );

  const flushPendingCellSave = useCallback(async () => {
    const info = pendingEditRef.current;
    if (!info) return;
    pendingEditRef.current = null;
    await persistCell(info);
  }, [persistCell]);

  const handleCellEdit = useCallback(
    (info: CellEditInfo) => {
      if (!instanceId || disabled) return;
      pendingEditRef.current = info;
      dirtyKeysRef.current.add(cellKey(info.rowNo, info.saveColumnKey));
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => void flushPendingCellSave(), 800);
    },
    [instanceId, disabled, flushPendingCellSave]
  );

  const handleCellFocus = useCallback(
    async (info: CellFocusInfo) => {
      if (!instanceId || disabled) return;
      setLockMessage("");
      focusedRef.current = info;
      dirtyKeysRef.current.delete(cellKey(info.rowNo, info.editColumnKey));

      const result = await window.oko.claimCell({
        instanceId,
        rowNo: info.rowNo,
        columnKey: info.columnKey,
        userName,
      });

      if (!result.ok) {
        setLockMessage(
          result.occupiedBy
            ? `Ячейка занята: ${result.occupiedBy}`
            : "Ячейка занята другим пользователем"
        );
        focusedRef.current = null;
        void poll();
        return;
      }

      clearHeartbeat();
      const beat = () => {
        void window.oko.heartbeatCell({
          instanceId,
          rowNo: info.rowNo,
          columnKey: info.columnKey,
        });
      };
      beat();
      heartbeatTimerRef.current = setInterval(
        beat,
        settingsRef.current.heartbeatIntervalSec * 1000
      );
    },
    [instanceId, disabled, userName, poll, clearHeartbeat]
  );

  const handleCellBlur = useCallback(
    async (info: CellBlurInfo) => {
      if (!instanceId || disabled) return;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      pendingEditRef.current = null;
      clearHeartbeat();
      focusedRef.current = null;

      await persistCell(info);
      await window.oko.releasePresence();
      void poll();
    },
    [instanceId, disabled, poll, clearHeartbeat, persistCell]
  );

  const markDirty = useCallback((rowNo: number, columnKey: string) => {
    dirtyKeysRef.current.add(cellKey(rowNo, columnKey));
  }, []);

  return {
    occupiedCells,
    presenceUsers,
    syncStatus,
    lockMessage,
    conflictMessage,
    highlightedCells,
    handleCellFocus,
    handleCellBlur,
    handleCellEdit,
    markDirty,
  };
}
