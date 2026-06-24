import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { encodePinHash, verifyPinHash } from "./coordinatorPin.js";

export type UserRole = "admin" | "coordinator" | "executor";

export interface StoredUser {
  id: string;
  login: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionUser {
  id: string;
  login: string;
  displayName: string;
  role: UserRole;
}

interface UsersFile {
  version: 1;
  users: StoredUser[];
}

let sessionUser: AuthSessionUser | null = null;

function usersFilePath(): string {
  return path.join(app.getPath("userData"), "users.json");
}

function readUsersFile(): UsersFile {
  const filePath = usersFilePath();
  if (!fs.existsSync(filePath)) {
    return { version: 1, users: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as UsersFile;
    if (!raw.users || !Array.isArray(raw.users)) {
      return { version: 1, users: [] };
    }
    return raw;
  } catch {
    return { version: 1, users: [] };
  }
}

function writeUsersFile(data: UsersFile): void {
  const filePath = usersFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function validateLogin(login: string): void {
  const value = normalizeLogin(login);
  if (!/^[a-z0-9._-]{3,32}$/.test(value)) {
    throw new Error("Логин: 3–32 символа, латиница, цифры, . _ -");
  }
}

function validatePassword(password: string): void {
  if (!password || password.length < 4) {
    throw new Error("Пароль должен быть не короче 4 символов");
  }
}

function findUserByLogin(users: StoredUser[], login: string): StoredUser | undefined {
  const key = normalizeLogin(login);
  return users.find((u) => u.login === key);
}

export function authNeedsSetup(): boolean {
  return readUsersFile().users.length === 0;
}

export function getAuthSession(): AuthSessionUser | null {
  return sessionUser;
}

export function authLogout(): void {
  sessionUser = null;
}

export function authLogin(login: string, password: string): AuthSessionUser {
  validatePassword(password);
  const data = readUsersFile();
  const user = findUserByLogin(data.users, login);
  if (!user || !user.active) {
    throw new Error("Неверный логин или пароль");
  }
  if (!verifyPinHash(password, user.passwordHash)) {
    throw new Error("Неверный логин или пароль");
  }
  sessionUser = {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
  };
  return sessionUser;
}

export function authCreateInitialAdmin(
  login: string,
  displayName: string,
  password: string
): AuthSessionUser {
  const data = readUsersFile();
  if (data.users.length > 0) {
    throw new Error("Пользователи уже созданы");
  }
  validateLogin(login);
  validatePassword(password);
  const now = new Date().toISOString();
  const user: StoredUser = {
    id: randomUUID(),
    login: normalizeLogin(login),
    displayName: displayName.trim() || login,
    passwordHash: encodePinHash(password),
    role: "admin",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  data.users.push(user);
  writeUsersFile(data);
  sessionUser = {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
  };
  return sessionUser;
}

function assertAdminSession(): AuthSessionUser {
  const user = sessionUser;
  if (!user || user.role !== "admin") {
    throw new Error("Доступ только для администратора");
  }
  return user;
}

export function authListUsers(): PublicUser[] {
  assertAdminSession();
  return readUsersFile().users.map(toPublicUser);
}

export function authListActiveLogins(): string[] {
  return readUsersFile()
    .users.filter((u) => u.active)
    .map((u) => u.login)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export function authCreateUser(payload: {
  login: string;
  displayName: string;
  password: string;
  role: UserRole;
}): PublicUser {
  assertAdminSession();
  validateLogin(payload.login);
  validatePassword(payload.password);
  if (payload.role === "admin") {
    /* allowed for admin creating another admin */
  }
  const data = readUsersFile();
  if (findUserByLogin(data.users, payload.login)) {
    throw new Error("Пользователь с таким логином уже существует");
  }
  const now = new Date().toISOString();
  const user: StoredUser = {
    id: randomUUID(),
    login: normalizeLogin(payload.login),
    displayName: payload.displayName.trim() || payload.login,
    passwordHash: encodePinHash(payload.password),
    role: payload.role,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  data.users.push(user);
  writeUsersFile(data);
  return toPublicUser(user);
}

export function authUpdateUser(payload: {
  id: string;
  displayName?: string;
  role?: UserRole;
  active?: boolean;
}): PublicUser {
  const admin = assertAdminSession();
  const data = readUsersFile();
  const idx = data.users.findIndex((u) => u.id === payload.id);
  if (idx < 0) throw new Error("Пользователь не найден");

  const user = data.users[idx];
  if (payload.id === admin.id && payload.active === false) {
    throw new Error("Нельзя отключить свою учётную запись");
  }
  if (payload.id === admin.id && payload.role && payload.role !== "admin") {
    throw new Error("Нельзя снять с себя роль администратора");
  }

  const admins = data.users.filter((u) => u.role === "admin" && u.active);
  if (
    user.role === "admin" &&
    user.active &&
    (payload.role !== "admin" || payload.active === false) &&
    admins.length <= 1
  ) {
    throw new Error("Нельзя удалить последнего администратора");
  }

  if (payload.displayName !== undefined) {
    user.displayName = payload.displayName.trim() || user.login;
  }
  if (payload.role !== undefined) user.role = payload.role;
  if (payload.active !== undefined) user.active = payload.active;
  user.updatedAt = new Date().toISOString();

  data.users[idx] = user;
  writeUsersFile(data);

  if (sessionUser?.id === user.id) {
    sessionUser = {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      role: user.role,
    };
  }

  return toPublicUser(user);
}

export function authResetPassword(userId: string, password: string): boolean {
  assertAdminSession();
  validatePassword(password);
  const data = readUsersFile();
  const user = data.users.find((u) => u.id === userId);
  if (!user) throw new Error("Пользователь не найден");
  user.passwordHash = encodePinHash(password);
  user.updatedAt = new Date().toISOString();
  writeUsersFile(data);
  return true;
}

export function authDeleteUser(userId: string): boolean {
  const admin = assertAdminSession();
  const data = readUsersFile();
  const user = data.users.find((u) => u.id === userId);
  if (!user) throw new Error("Пользователь не найден");
  if (user.id === admin.id) throw new Error("Нельзя удалить свою учётную запись");

  const admins = data.users.filter((u) => u.role === "admin" && u.active);
  if (user.role === "admin" && user.active && admins.length <= 1) {
    throw new Error("Нельзя удалить последнего администратора");
  }

  data.users = data.users.filter((u) => u.id !== userId);
  writeUsersFile(data);
  return true;
}

export function roleGrantsCoordinator(role: UserRole): boolean {
  return role === "admin" || role === "coordinator";
}
