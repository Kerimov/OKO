/** Сборка offline-kit (zip для дочки без сервера). */
export function isOfflineKitMode(): boolean {
  return import.meta.env.VITE_OFFLINE_KIT === "true";
}
