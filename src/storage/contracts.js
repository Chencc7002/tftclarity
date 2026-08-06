export const PERSISTENT_REPOSITORY_METHODS = Object.freeze({
  preferences: ["getUserPreference", "setUserPreference", "deleteUserPreference"],
  catalog: ["getItemCatalog", "setItemCatalog", "clearItemCatalog", "getDomainCatalog", "setDomainCatalog", "clearDomainCatalog"],
  aliases: ["addEntityAlias", "getEntityAlias", "setEntityAliasEnabled", "updateEntityAlias", "deleteEntityAlias", "listEntityAliases", "findEntityAliases", "clearEntityAliases"],
  compProfiles: ["getCompProfile", "listCompProfiles", "upsertCompProfile", "deleteCompProfile", "listCompProfileBindings", "upsertCompProfileBinding", "deleteCompProfileBinding"],
  events: ["addQueryEvent", "getQueryEvent", "updateQueryEventConclusion", "pruneQueryEventsBefore"],
  feedback: ["addFeedbackEvent", "findFeedbackEventByFeedbackId", "listFeedbackEvents", "clearFeedbackEvents"],
  audit: ["addAdminAudit", "listAdminAudits"],
  stats: ["getCompTrendHistory", "setCompTrendHistory"]
});

export const EPHEMERAL_STORE_METHODS = Object.freeze({
  sessions: ["getSessionState", "setSessionState", "deleteSessionState", "clearSessionState"],
  queryCache: ["getQuery", "setQuery", "clearQueryCache"],
  defaultContext: ["getDefaultContext", "setDefaultContext", "clearDefaultContextCache"]
});

export const ALL_PERSISTENT_METHODS = Object.freeze(Object.values(PERSISTENT_REPOSITORY_METHODS).flat());
export const ALL_EPHEMERAL_METHODS = Object.freeze(Object.values(EPHEMERAL_STORE_METHODS).flat());

export function assertStoreContract(store, methods, label = "store") {
  const missing = methods.filter((method) => typeof store?.[method] !== "function");
  if (missing.length) throw new Error(`${label} is missing methods: ${missing.join(", ")}`);
  return store;
}

export function createRepositoryViews(store) {
  const bind = (methods) => Object.freeze(Object.fromEntries(methods.map((method) => [
    method,
    (...args) => Promise.resolve(store[method](...args))
  ])));
  return Object.freeze(Object.fromEntries(Object.entries(PERSISTENT_REPOSITORY_METHODS)
    .map(([name, methods]) => [name, bind(methods)])));
}

export function createEphemeralViews(store) {
  const bind = (methods) => Object.freeze(Object.fromEntries(methods.map((method) => [
    method,
    (...args) => Promise.resolve(store[method](...args))
  ])));
  return Object.freeze(Object.fromEntries(Object.entries(EPHEMERAL_STORE_METHODS)
    .map(([name, methods]) => [name, bind(methods)])));
}
