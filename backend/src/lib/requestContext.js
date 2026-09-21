import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

export function runWithContext(ctx, fn) {
  return als.run(ctx || {}, fn);
}

export function getContext() {
  return als.getStore() || {};
}

export function getRequestUserId() {
  return getContext().userId || null;
}

export function getCachedConfig() {
  return getContext().config ?? null;
}

export function setCachedConfig(config) {
  const store = als.getStore();
  if (store) store.config = config;
}
