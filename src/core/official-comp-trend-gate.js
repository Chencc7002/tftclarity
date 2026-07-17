import { calculateMetaTftPagePlacementChange } from "./metatft-page-trend.js";

export const OFFICIAL_COMP_TREND_THRESHOLD = -0.10;
export const OFFICIAL_COMP_TREND_MINIMUM = 3;
export const OFFICIAL_COMP_TREND_FIELD_PATH = "results.data.comps";
export const OFFICIAL_COMP_TREND_PAGE_PATH = "results.data.cluster_details[*].trends";

function finiteExactChange(row) {
  if (!row || typeof row !== "object"
    || !Object.prototype.hasOwnProperty.call(row, "Average Placement Change")) return null;
  const rawValue = row["Average Placement Change"];
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function rawCompEntries(response) {
  const data = response?.results?.data;
  if (!data || typeof data !== "object"
    || !Object.prototype.hasOwnProperty.call(data, "comps")) {
    return { status: "field_missing", entries: [] };
  }
  const comps = data.comps;
  if (Array.isArray(comps)) {
    return {
      status: "present",
      entries: comps.map((row, index) => [String(row?.Cluster ?? row?.cluster ?? row?.cluster_id ?? index), row])
    };
  }
  if (!comps || typeof comps !== "object") return { status: "field_invalid", entries: [] };
  return { status: "present", entries: Object.entries(comps) };
}

function pageTrendEntries(response) {
  const details = response?.results?.data?.cluster_details;
  if (Array.isArray(details)) {
    return details.map((row, index) => [
      String(row?.Cluster ?? row?.cluster ?? row?.cluster_id ?? index),
      row
    ]);
  }
  return details && typeof details === "object" ? Object.entries(details) : [];
}

function eligibleEntries(measured, threshold) {
  return measured
    .filter((entry) => entry.avgPlacementChange < threshold)
    .sort((left, right) => left.avgPlacementChange - right.avgPlacementChange
      || left.clusterId.localeCompare(right.clusterId));
}

export function inspectOfficialCompTrendGate(response = {}, options = {}) {
  const threshold = Number.isFinite(Number(options.threshold))
    ? Number(options.threshold)
    : OFFICIAL_COMP_TREND_THRESHOLD;
  const minimum = Number.isInteger(Number(options.minimum)) && Number(options.minimum) > 0
    ? Number(options.minimum)
    : OFFICIAL_COMP_TREND_MINIMUM;
  const raw = rawCompEntries(response);
  const rawMeasured = raw.entries.map(([clusterId, row]) => ({
    clusterId: String(clusterId),
    avgPlacementChange: finiteExactChange(row)
  })).filter((entry) => entry.avgPlacementChange !== null);
  const pages = pageTrendEntries(response);
  const pageMeasured = pages.map(([clusterId, row]) => {
    const calculated = calculateMetaTftPagePlacementChange(row?.trends);
    return calculated ? {
      clusterId: String(clusterId),
      avgPlacementChange: calculated.avgPlacementChange,
      comparedAt: calculated.comparedAt,
      endpointAt: calculated.endpointAt,
      baselineAvgPlacement: calculated.baselineAvgPlacement,
      endpointAvgPlacement: calculated.endpointAvgPlacement
    } : null;
  }).filter(Boolean);
  const rawEligible = eligibleEntries(rawMeasured, threshold);
  const pageEligible = eligibleEntries(pageMeasured, threshold);
  const useRaw = rawEligible.length >= minimum;
  const usePage = !useRaw && pageEligible.length >= minimum;
  const sourceType = useRaw
    ? "raw_field"
    : usePage
      ? "page_calculated"
      : rawMeasured.length > 0
        ? "raw_field"
        : pageMeasured.length > 0
          ? "page_calculated"
          : null;
  const measured = sourceType === "raw_field" ? rawMeasured : pageMeasured;
  const eligible = sourceType === "raw_field" ? rawEligible : pageEligible;
  const ready = eligible.length >= minimum;
  const status = ready
    ? "ready"
    : measured.length > 0
      ? "insufficient"
      : raw.status;

  return {
    ready,
    status,
    sourceType,
    sourcePath: sourceType === "page_calculated"
      ? OFFICIAL_COMP_TREND_PAGE_PATH
      : OFFICIAL_COMP_TREND_FIELD_PATH,
    threshold,
    minimum,
    rawCompCount: raw.entries.length,
    rawMeasuredCount: rawMeasured.length,
    pageCompCount: pages.length,
    pageMeasuredCount: pageMeasured.length,
    measuredCount: measured.length,
    eligibleCount: eligible.length,
    // Never expose a partial top three. Page-calculated entries are backed by
    // MetaTFT's official daily trend samples and preserve their endpoints.
    leaders: ready ? eligible.slice(0, minimum) : [],
    clusterId: response?.results?.data?.cluster_id ?? response?.cluster_id ?? null,
    updatedAt: response?.updated ?? response?.results?.data?.updated ?? null
  };
}
