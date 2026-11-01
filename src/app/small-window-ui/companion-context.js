// A selection descriptor only. All profile text is resolved on the server.
export function companionRequestContext(search, quickTask = false) {
  const personaId = new URLSearchParams(search).get('companion');
  return !quickTask && personaId ? { companion: { schemaVersion: 'companion-context.v1', personaId } } : {};
}
