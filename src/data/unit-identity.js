function set18IdentityToken(apiName) {
  const match = String(apiName ?? "").match(/^(?:DA_18_|TFT18_)(.+)$/i);
  if (!match) return null;
  const token = match[1].replace(/_(?:AD|AP)$/i, "").toLowerCase();
  // MetaTFT emits Elise's transformed board form as a second unit even though
  // it is not a shop unit and has the same user-facing champion name.
  if (token === "elisespider") return "elise";
  return token;
}

export function canonicalUnitIdentity(value) {
  const record = value && typeof value === "object" ? value : null;
  const apiName = record?.apiName ?? record?.id ?? record?.target ?? record?.record?.apiName ?? value;
  const aliases = record?.aliases ?? record?.record?.aliases ?? [];
  const catalogIdentity = aliases.find?.((alias) => /^TFT18_/i.test(String(alias ?? "")));
  const canonicalApiName = record?.canonicalApiName
    ?? record?.record?.canonicalApiName
    ?? catalogIdentity
    ?? apiName;
  const token = set18IdentityToken(canonicalApiName) ?? set18IdentityToken(apiName);
  return token ? `set18:${token}` : `unit:${String(apiName ?? "").toLowerCase()}`;
}

function providerSampleCount(value) {
  const count = Number(
    value?.providerSampleCount
    ?? value?.sampleCount
    ?? value?.record?.providerSampleCount
    ?? value?.record?.sampleCount
    ?? 0
  );
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function apiPreference(apiName) {
  const value = String(apiName ?? "");
  if (/^DA_18_.+_AD$/i.test(value)) return 40;
  if (/^DA_18_/i.test(value) && !/_AP$/i.test(value)) return 35;
  if (/^DA_18_.+_AP$/i.test(value)) return 30;
  if (/^TFT18_/i.test(value)) return 10;
  return 0;
}

export function preferEquivalentUnit(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftSamples = providerSampleCount(left);
  const rightSamples = providerSampleCount(right);
  if (leftSamples !== rightSamples) return rightSamples > leftSamples ? right : left;
  const leftApiName = left.apiName ?? left.id ?? left.target ?? left.record?.apiName;
  const rightApiName = right.apiName ?? right.id ?? right.target ?? right.record?.apiName;
  const leftPreference = apiPreference(leftApiName);
  const rightPreference = apiPreference(rightApiName);
  if (leftPreference !== rightPreference) return rightPreference > leftPreference ? right : left;
  return String(rightApiName ?? "").localeCompare(String(leftApiName ?? "")) < 0 ? right : left;
}
