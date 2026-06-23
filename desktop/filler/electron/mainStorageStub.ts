import { loadAllPackageInstances } from "./db/packageDb.js";

export function isBackendMode(): boolean {
  return false;
}

export async function loadAllInstances() {
  return loadAllPackageInstances();
}
