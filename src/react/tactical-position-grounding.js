const compact = (text) => String(text ?? "").normalize("NFKC").replace(/[\s*#`·・•]/gu, "").toLowerCase();
const current = (entry) => entry.temporalStatus !== "historical" && entry.metadata?.temporalStatus !== "historical";
const identity = (value) => JSON.stringify([value.seasonContextId, value.clusterId, value.compId]);
const number = (value) => ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 }[value] ?? Number(value));
const positionPattern = /第\s*[一二三四五六七1-7]\s*[排列]|[一二三四]排|(?:放在|站在|位于|放到|在|放|站)\s*(?:前排|中排|后排)|^\s*[-*#]*(?:前排|中排|后排).{0,16}[:：]/u;
const startsWithAlias = (line, alias) => [alias, `在${alias}`, `阵容:${alias}`].some(prefix =>
  line.startsWith(prefix) && /^(?:$|[:：(（]|阵容)/u.test(line.slice(prefix.length)));

const parentheticalCoordinates = "[（(]\\s*第\\s*[一二三四1-4]\\s*排\\s*[·・]?\\s*第\\s*[一二三四五六七1-7]\\s*列\\s*[）)]";
function separateNamedCoordinates(segment, units, errors) {
  const annotations = [];
  let residual = segment.replace(/\*\*/gu, "");
  const names = [...new Set(units.map(unit => unit.name).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    residual = residual.replace(new RegExp(`${escaped}\\s*${parentheticalCoordinates}`, "gu"), match => {
      annotations.push(match);
      // Retain the name so a later shared predicate (A(...) and B(...) stand
      // in row 1) still applies to both units. Do not discard that assertion.
      return name;
    });
  }
  if (new RegExp(parentheticalCoordinates, "u").test(residual)) {
    errors.push("positioning coordinate annotation names no verified unit in its cited composition");
  }
  return [residual, ...annotations];
}

export function hasTacticalPositionProse(answer) {
  const text = String(answer ?? "");
  return /\bcell[_-]?\d+\b/iu.test(text)
    || text.split(/\n/u).some((line) => positionPattern.test(line));
}

// Checks explicit position statements, not general strategy prose. No inferred
// formation, new evidence, or model-provided identity map is accepted here.
export function scopedTacticalPositionErrors(answer, entries) {
  const tactical = entries.filter(entry => current(entry) && entry.toolName === "composition_tactical_details"
    && Array.isArray(entry.value?.formation?.units));
  if (!tactical.length) return [];
  const groups = new Map();
  for (const entry of tactical) {
    const key = entry.value.compId ? identity(entry.value) : entry.evidenceId;
    if (!groups.has(key)) groups.set(key, { entries: [], aliases: new Set() });
    groups.get(key).entries.push(entry);
  }
  // Names come from cited ranking rows bound by the server's tactical plan.
  // A bare unit name is never used as a composition alias.
  for (const entry of entries.filter(entry => current(entry) && entry.toolName === "comps_rankings")) {
    for (const row of entry.value?.results ?? []) {
      const plan = row.tacticalDetailQueryPlan;
      if (!plan || plan.status !== "ready") continue;
      const group = groups.get(identity({ seasonContextId: plan.seasonContextId,
        clusterId: plan.clusterId, compId: plan.compositionId }));
      if (group && row.compositionRef?.name) group.aliases.add(compact(row.compositionRef.name));
    }
  }
  const errors = [];
  if (/\bcell[_-]?\d+\b/iu.test(answer)) errors.push("positioning answer must not expose raw provider cell identifiers");
  let scope = null;
  for (const line of String(answer ?? "").split(/\n/u)) {
    const normalized = compact(line).replace(/^(?:[-+]|\d+[.)、])/, "")
      .replace(/^阵容[一二三四五六七八九十\d]+:/u, "");
    const matches = [...groups].filter(([, group]) => [...group.aliases].some(alias => startsWithAlias(normalized, alias)));
    if (matches.length) scope = matches.length === 1 ? matches[0][0] : null;
    else {
      const heading = line.match(/^\s*#{1,6}\s+([^：:]+)|^\s*\*\*([^*]+)\*\*\s*(?:[:：]|$)|^\s*[-+]?\s*([^：:]+)[:：]/u);
      const title = compact(heading?.[1] ?? heading?.[2] ?? heading?.[3]);
      const knownUnit = tactical.some(entry => entry.value.formation.units.some(unit => compact(unit.name) === title));
      if (heading && !knownUnit && !/^(?:(?:前排|中排|后排|站位|成员)$|第?[一二三四1-4]排(?:[（(](?:前排|中排|后排)[）)])?$)/u.test(title)) scope = null;
    }
    if (!positionPattern.test(line)) continue;
    const selected = groups.size === 1 ? [...groups.values()][0] : scope ? groups.get(scope) : null;
    if (!selected) { errors.push("positioning claim requires an unambiguous composition heading from cited evidence"); continue; }
    // Do not interpret a champion mentioned only in the composition title as
    // the subject of the first unit's position sentence.
    const body = matches.length !== 1 ? line : /^\s*(?:#{1,6}\s*)?\*\*/u.test(line)
      ? line.replace(/^\s*(?:#{1,6}\s*)?\*\*[^*]+\*\*/, "").replace(/^\s*[:：]/u, "")
      : line.replace(/^[^：:]+[:：]/u, "");
    // Repeated observations of the same identity must agree; never choose the
    // observation whose position happens to match the model's claim.
    const plainBody = body.replace(/\*\*/gu, "");
    const rowHeader = plainBody.match(/^\s*[-*#]*\s*第?([一二三四1-4])排\s*(?:[（(](前排|中排|后排)[）)])?\s*[:：]/u);
    if (rowHeader?.[2]) {
      const row = number(rowHeader[1]);
      const zone = row === 1 ? "前排" : row === 4 ? "后排" : "中排";
      if (rowHeader[2] !== zone) errors.push("positioning row heading contradicts its zone label");
    }
    const segments = (rowHeader ? plainBody.slice(rowHeader[0].length) : plainBody).split(/[，,。；;、]/u);
    for (const entry of selected.entries) {
      for (const part of segments) {
        if (!part.trim()) continue;
        const units = entry.value.formation.units;
        for (const segment of separateNamedCoordinates(rowHeader ? `第${rowHeader[1]}排 ${part}` : part, units, errors)) {
          if (!positionPattern.test(segment)) continue;
          const plain = segment.replace(/\*\*/gu, "");
          if (!units.some(unit => unit.name && plain.includes(unit.name)) && !/[:：]\s*$/u.test(plain)) {
            errors.push("positioning claim names no unit with a position in its cited composition");
          }
          for (const unit of units) {
            const name = String(unit.name ?? "");
            if (!name) continue;
            const withoutLongerNames = units.filter(other => other.name !== name && other.name?.includes(name))
              .reduce((text, other) => text.replaceAll(other.name, ""), plain);
            if (!withoutLongerNames.includes(name)) continue;
            const expectedRow = unit.boardPosition?.rowFromFront;
            const expectedColumn = unit.boardPosition?.columnFromLeft;
            const rows = [...plain.matchAll(/(?:第\s*([一二三四1-4])\s*排|([一二三四])排)/gu)].map(m => number(m[1] ?? m[2]));
            const columns = [...plain.matchAll(/第\s*([一二三四五六七1-7])\s*列/gu)].map(m => number(m[1]));
            for (const row of rows) if (row !== expectedRow) errors.push(`positioning answer contradicts formation for ${name}: expected row ${expectedRow}, claimed row ${row}`);
            for (const column of columns) if (column !== expectedColumn) errors.push(`positioning answer contradicts formation for ${name}: expected column ${expectedColumn}, claimed column ${column}`);
            const zone = plain.match(/^\s*[-*]*\s*(前排|中排|后排)[^：:]{0,16}[：:]/u)?.[1]
              ?? plain.slice(plain.indexOf(name) + name.length).match(/.{0,8}(?:放在|站在|位于|放到|在|放|站)\s*(前排|中排|后排)/u)?.[1];
            const expectedZone = expectedRow === 1 ? "前排" : expectedRow === 4 ? "后排" : "中排";
            if (zone && zone !== expectedZone) errors.push(`positioning answer contradicts formation for ${name}: expected ${expectedZone}, claimed ${zone}`);
          }
        }
      }
    }
  }
  return [...new Set(errors)];
}
