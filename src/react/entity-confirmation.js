const AFFIRMATIVE = /^(?:是(?:的|这个|它)?|对(?:的|没错)?|没错|就是(?:这个|它)?|确认|可以|嗯|好(?:的)?|yes|yeah|yep|correct)[\s。.!！]*$/iu;

const AKALI_FORMS = [
  { apiName: "DA_Akali_TrueDamage19", name: "真实伤害阿卡丽", tag: /真实伤害|真伤|truedamage/iu },
  { apiName: "DA_AkaliKDA19", name: "K/DA 阿卡丽", tag: /kda/iu }
];
export function akaliForm(apiName) {
  const form = AKALI_FORMS.find(form => form.apiName === apiName);
  return form && { apiName: form.apiName, name: form.name };
}

export function currentSelectionText(input) {
  return String(input ?? "").split(/\n\s*引用的历史回复\s*\/\s*Quoted previous replies/u, 1)[0].trim();
}

export function akaliSelection(input, pending) {
  const text = currentSelectionText(input).normalize("NFKC").replace(/[\s/·（）()]/gu, "");
  const choices = pending?.type === "entity_candidate" && pending.entityType === "unit"
    && pending.candidates?.length && pending.candidates.every(c => akaliForm(c.apiName)) ? pending.candidates : [];
  const namesAkali = /阿卡[丽莉]|akali/iu.test(text);
  if (!choices.length && !namesAkali) return null;
  if (choices.length) {
    const ordinal = /^(?:我选|选|就)?第?([一二12])个[吧。！!]?$/u.exec(text);
    if (ordinal) {
      const candidate = choices["一1".includes(ordinal[1]) ? 0 : 1];
      if (candidate) return { ...akaliForm(candidate.apiName), origin: "selection" };
    }
  }
  const matches = AKALI_FORMS.filter(form => form.tag.test(text));
  if (matches.length > 1 && /对比|比较|分别|区别|各自/u.test(text)) return null;
  if (matches.length === 1) {
    const form = matches[0];
    const remaining = text.replace(form.tag, "@");
    const qualified = /(?:@的?(?:阿卡[丽莉]|akali)|(?:阿卡[丽莉]|akali)(?:的)?@)/iu.test(remaining)
      || (choices.length && /^(?:我(?:说的|指的|选)?(?:是)?|选|就是|是)?@(?:的)?(?:那个|这个|那只)?[吧。！!]?$/u.test(remaining));
    if (qualified && !/(?:不是|不要|不选|排除|而非)(?:那个|这个)?(?:阿卡[丽莉])?@/u.test(remaining)) {
      return { ...akaliForm(form.apiName), origin: "explicit" };
    }
  }
  if (matches.length || namesAkali || choices.length) return { origin: "ambiguous" };
  return null;
}

// Only select from the server's pending clarification. A name selection is user
// intent, never current evidence; the loop must still resolve it in the catalog.
export function selectedEntityConfirmation(text, bridgeContext) {
  const view = bridgeContext?.view ?? bridgeContext;
  const context = view?.pendingClarification?.confirmationContext;
  if (context?.type !== "entity_candidate" || !Array.isArray(context.candidates)) return null;
  const input = String(text ?? "").trim();
  const candidates = context.candidates.filter(candidate => candidate?.apiName && candidate?.name);
  const variant = view.akaliVariant;
  if (variant?.apiName && candidates.some(candidate => candidate.apiName === variant.apiName)) {
    return { ...context, candidates: [akaliForm(variant.apiName)] };
  }
  const matches = candidates.filter(candidate => candidate.name === input);
  const selected = matches.length === 1 ? matches[0]
    : candidates.length === 1 && AFFIRMATIVE.test(input) ? candidates[0] : null;
  if (!selected || !context.entityType) return null;
  return { ...context, candidates: [selected] };
}
