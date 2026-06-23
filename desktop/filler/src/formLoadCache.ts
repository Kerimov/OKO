import type { FormSchema, OkoFormInstance } from "@portal/types";

interface CachedForm {
  instance: OkoFormInstance;
  schema: FormSchema;
}

const cache = new Map<string, CachedForm>();

export function getCachedForm(instanceId: string): CachedForm | undefined {
  return cache.get(instanceId);
}

export function setCachedForm(
  instanceId: string,
  instance: OkoFormInstance,
  schema: FormSchema
): void {
  cache.set(instanceId, { instance, schema });
}

export function patchCachedInstance(instanceId: string, instance: OkoFormInstance): void {
  const entry = cache.get(instanceId);
  if (entry) {
    entry.instance = instance;
  }
}

export function clearFormCache(): void {
  cache.clear();
}
