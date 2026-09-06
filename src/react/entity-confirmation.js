const AFFIRMATIVE = /^(?:是(?:的|这个|它)?|对(?:的|没错)?|没错|就是(?:这个|它)?|确认|可以|嗯|好(?:的)?|yes|yeah|yep|correct)[\s。.!！]*$/iu;

// Only select from the server's pending clarification. A name selection is user
// intent, never current evidence; the loop must still resolve it in the catalog.
export function selectedEntityConfirmation(text, bridgeContext) {
  const view = bridgeContext?.view ?? bridgeContext;
  const context = view?.pendingClarification?.confirmationContext;
  if (context?.type !== "entity_candidate" || !Array.isArray(context.candidates)) return null;
  const input = String(text ?? "").trim();
  const candidates = context.candidates.filter(candidate => candidate?.apiName && candidate?.name);
  const matches = candidates.filter(candidate => candidate.name === input);
  const selected = matches.length === 1 ? matches[0]
    : candidates.length === 1 && AFFIRMATIVE.test(input) ? candidates[0] : null;
  if (!selected || !context.entityType) return null;
  return { ...context, candidates: [selected] };
}
