import { useSyncExternalStore } from "react";
import { getAuthSnapshot, subscribeAuth } from "./auth";

export function useAuth() {
  return useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
}

