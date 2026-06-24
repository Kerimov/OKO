import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PACKAGE_META, readPackageMetaFile, writePackageMetaFile, type PackageMeta } from "./schema.js";

function hashPin(pin: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

export function encodePinHash(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hashPin(pin, salt)}`;
}

export function verifyPinHash(pin: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = hashPin(pin, salt);
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function hasCoordinatorPin(metaPath: string): boolean {
  if (!fs.existsSync(metaPath)) return false;
  const meta = readPackageMetaFile(metaPath);
  return Boolean(meta.coordinatorPinHash);
}

export function verifyCoordinatorPin(folderPath: string, pin: string): boolean {
  const metaPath = path.join(folderPath, PACKAGE_META);
  const meta = readPackageMetaFile(metaPath);
  return verifyPinHash(pin, meta.coordinatorPinHash);
}

export function setCoordinatorPin(
  folderPath: string,
  pin: string,
  oldPin?: string
): void {
  const metaPath = path.join(folderPath, PACKAGE_META);
  const meta = readPackageMetaFile(metaPath);
  if (meta.coordinatorPinHash) {
    if (!oldPin || !verifyPinHash(oldPin, meta.coordinatorPinHash)) {
      throw new Error("Неверный текущий PIN координатора");
    }
  }
  if (!pin || pin.length < 4) {
    throw new Error("PIN должен быть не короче 4 символов");
  }
  const next: PackageMeta = { ...meta, coordinatorPinHash: encodePinHash(pin) };
  writePackageMetaFile(metaPath, next);
}
