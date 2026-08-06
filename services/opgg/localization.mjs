import {
  traitAliasOverrideByApiName,
  unitAliasOverrideByApiName
} from "../../src/data/domain-alias-overrides.js";
import { itemAliasOverrideByApiName } from "../../src/data/item-alias-overrides.js";
import { currentItemLocalizationByApiName } from "../../src/data/item-localization.js";
import { createAssetResolver } from "../../src/data/asset-resolver.js";

const assetResolver = createAssetResolver();

function readableFallback(value) {
  return String(value ?? "")
    .replace(/^TFT\d+_Item_/u, "")
    .replace(/^TFT_Item_/u, "")
    .replace(/^TFT\d+_/u, "")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
}

function overrideName(entry, fallback) {
  return entry?.zhName ?? entry?.displayName ?? entry?.shortName ?? readableFallback(fallback);
}

function unitDisplayName(apiName) {
  return overrideName(unitAliasOverrideByApiName.get(apiName), apiName);
}

function traitDisplayName(apiName) {
  return overrideName(traitAliasOverrideByApiName.get(apiName), apiName);
}

function itemDisplayName(apiName) {
  const override = itemAliasOverrideByApiName.get(apiName);
  if (override) return overrideName(override, apiName);
  const official = currentItemLocalizationByApiName.get(apiName);
  return official?.zhName ?? official?.enName ?? readableFallback(apiName);
}

function localizeItem(apiName) {
  const asset = assetResolver.resolveItem(apiName);
  return {
    apiName,
    displayName: itemDisplayName(apiName),
    iconUrl: asset.iconUrl,
    assetFallback: asset.fallback
  };
}

function localizeUnit(unit) {
  const apiName = unit?.characterId ?? unit?.name;
  const rarity = Number.isFinite(Number(unit?.rarity))
    ? Number(unit.rarity)
    : null;
  const asset = assetResolver.resolveUnit(apiName);
  const items = (unit?.itemNames ?? []).map(localizeItem);
  return {
    ...unit,
    displayName: unitDisplayName(apiName),
    cost: Number.isFinite(Number(unit?.cost))
      ? Number(unit.cost)
      : Number.isFinite(Number(asset.cost))
        ? Number(asset.cost)
        : rarity === null
          ? null
          : rarity + 1,
    iconUrl: asset.iconUrl,
    fallbackIconUrl: asset.fallbackIconUrl ?? null,
    assetFallback: asset.fallback,
    items,
    itemDisplayNames: items.map((item) => item.displayName)
  };
}

function localizeSignature(signature) {
  const parts = String(signature ?? "").split("|");
  const result = {
    raw: signature ?? null,
    set: parts[0] ?? "",
    traits: [],
    carry: null,
    tank: null
  };
  for (const part of parts) {
    if (part.startsWith("trait:")) {
      const id = part.slice(6);
      result.traits.push({ id, name: traitDisplayName(id) });
    } else if (part.startsWith("carry:")) {
      const id = part.slice(6);
      result.carry = { id, name: unitDisplayName(id), ...assetResolver.resolveUnit(id) };
    } else if (part.startsWith("tank:")) {
      const id = part.slice(5);
      result.tank = { id, name: unitDisplayName(id), ...assetResolver.resolveUnit(id) };
    }
  }
  return result;
}

function localizeMatch(match) {
  return {
    ...match,
    traits: (match?.traits ?? []).map((trait) => ({
      ...trait,
      displayName: traitDisplayName(trait?.name)
    })),
    units: (match?.units ?? []).map(localizeUnit),
    displaySignature: localizeSignature(match?.compFamilySignature)
  };
}

function localizeReview(review) {
  return {
    ...review,
    compPreferences: (review?.compPreferences ?? []).map((comp) => ({
      ...comp,
      displaySignature: localizeSignature(comp.compSignature)
    })),
    matches: (review?.matches ?? []).map((entry) => ({
      ...entry,
      facts: {
        ...entry.facts,
        displaySignature: localizeSignature(entry.facts?.compFamilySignature)
      }
    }))
  };
}

function localizeAggregate(result) {
  const compTrends = (result?.compTrends ?? []).map((comp) => ({
    ...comp,
    displaySignature: localizeSignature(comp.compSignature),
    representativeUnits: (comp.representativeUnits ?? []).map(localizeUnit)
  }));
  const bySignature = new Map(
    compTrends.map((comp) => [comp.compSignature, comp])
  );
  const localizeAnalysisEntry = (entry) => entry
    ? bySignature.get(entry.compSignature) ?? {
        ...entry,
        displaySignature: localizeSignature(entry.compSignature),
        representativeUnits: (entry.representativeUnits ?? []).map(localizeUnit)
      }
    : null;
  return {
    ...result,
    compTrends,
    compAnalysis: result?.compAnalysis
      ? {
          ...result.compAnalysis,
          mostPlayed: localizeAnalysisEntry(result.compAnalysis.mostPlayed),
          bestAveragePlacement: localizeAnalysisEntry(result.compAnalysis.bestAveragePlacement),
          highestTop4Rate: localizeAnalysisEntry(result.compAnalysis.highestTop4Rate),
          highestWinRate: localizeAnalysisEntry(result.compAnalysis.highestWinRate),
          highestEighthRate: localizeAnalysisEntry(result.compAnalysis.highestEighthRate)
        }
      : null,
    unitTrends: (result?.unitTrends ?? []).map((unit) => ({
      ...unit,
      displayName: unitDisplayName(unit.unitId),
      topItems: (unit.topItems ?? []).map((item) => ({
        ...item,
        ...localizeItem(item.item)
      }))
    }))
  };
}

export {
  itemDisplayName,
  localizeItem,
  localizeAggregate,
  localizeMatch,
  localizeReview,
  localizeSignature,
  localizeUnit,
  readableFallback,
  traitDisplayName,
  unitDisplayName
};
