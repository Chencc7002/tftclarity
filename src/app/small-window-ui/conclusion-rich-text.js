export const ASSISTANT_OUTPUT_SCHEMA_VERSION = "assistant-output.v1";

const SUMMARY_LABEL_PATTERN = /^(变化汇总|关键变化|核心结论|最终结论|结论|总结|建议|summary|conclusion|recommendation|key points?|key changes?)\s*[：:]?\s*(.*)$/iu;
const IMPORTANT_TOKEN_PATTERN = /(从\s*\d+(?:\.\d+)?\s*(?:人|档|个)?\s*(?:增至|降至|变为)\s*\d+(?:\.\d+)?\s*(?:人|档|个)?|\d+(?:\.\d+)?\s*(?:人|档|个)?\s*(?:→|->|到)\s*\d+(?:\.\d+)?\s*(?:人|档|个)?|[+＋]\s*\d+(?:\.\d+)?|档位未变|人数不变|未达到|未激活|已激活|未升档|已升档|未触发|已触发|无变化|不变|升档|降档)/gu;
const AUTO_STRUCTURE_MIN_LENGTH = 88;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function importantTextHtml(value) {
  const text = String(value ?? "").replaceAll("**", "");
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(IMPORTANT_TOKEN_PATTERN)) {
    html += escapeHtml(text.slice(cursor, match.index));
    html += `<mark class="assistant-rich-text__emphasis">${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function inlineConclusionHtml(value) {
  const text = String(value ?? "");
  const boldPattern = /\*\*(.+?)\*\*/gu;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(boldPattern)) {
    html += importantTextHtml(text.slice(cursor, match.index));
    html += `<strong class="assistant-rich-text__strong">${importantTextHtml(match[1])}</strong>`;
    cursor = match.index + match[0].length;
  }
  return html + importantTextHtml(text.slice(cursor));
}

function summaryLineParts(line) {
  const normalized = line.trim().replace(/^\*\*/, "").replace(/\*\*(?=\s*[：:]?)/u, "");
  return normalized.match(SUMMARY_LABEL_PATTERN);
}

function sentenceSegments(value) {
  const text = String(value ?? "").trim();
  const segments = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1] ?? "";
    current += character;
    const strongBoundary = /[。！？；]/u.test(character);
    const spacedBoundary = /[.!?;]/u.test(character) && (!next || /\s/u.test(next));
    if (!strongBoundary && !spacedBoundary) continue;
    if (current.trim()) segments.push(current.trim());
    current = "";
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function hasExplicitLineStructure(value) {
  return String(value ?? "").split(/\r?\n/u).some((rawLine) => {
    const line = rawLine.trim();
    return /^#{1,3}\s+/u.test(line)
      || /^(?:[-•]|\*)\s+/u.test(line)
      || /^\d+[.)、]\s*/u.test(line)
      || Boolean(summaryLineParts(line));
  });
}

function autoStructuredConclusionText(value) {
  const text = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  const nonEmptyLines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (nonEmptyLines.length !== 1) return text;

  const line = nonEmptyLines[0];
  const explicitSummary = summaryLineParts(line);
  const summaryLabel = explicitSummary?.[1] ?? (/\p{Script=Han}/u.test(line) ? "结论" : "Summary");
  const body = explicitSummary?.[2] ?? line;
  const segments = sentenceSegments(body);
  const shouldStructure = explicitSummary
    ? segments.length >= 2
    : !hasExplicitLineStructure(line)
      && (segments.length >= 3 || (line.length >= AUTO_STRUCTURE_MIN_LENGTH && segments.length >= 2));
  if (!shouldStructure) return text;

  return [
    `${summaryLabel}：${segments[0]}`,
    "",
    ...segments.slice(1).map((segment) => `- ${segment}`)
  ].join("\n");
}

function cleanInternalPositionIds(value) {
  return String(value ?? "")
    .replace(/\s*[（(]\s*cell[_-]?\d+(?:\s*[、,]\s*cell[_-]?\d+)*\s*[)）]/giu, "")
    .replace(/\bcell[_-]?\d+\b/giu, "")
    .replace(/[ \t]+([，。；、])/gu, "$1")
    .replace(/([，；、])\s*([。；])/gu, "$2");
}

function sectionItems(value, separator) {
  return String(value ?? "")
    .replace(/[。；\s]+$/gu, "")
    .split(separator)
    .map((item) => item.trim().replace(/[。；]+$/gu, ""))
    .filter(Boolean);
}

function emphasizedPositionItem(value) {
  const match = String(value ?? "").match(/^(.{1,24}?)(?=(?:放|在|位于))/u);
  return match ? `**${match[1]}**${value.slice(match[1].length)}` : value;
}

function emphasizedAugmentItem(value) {
  const match = String(value ?? "").match(/^([^（(]{1,30})(?=[（(])/u);
  return match ? `**${match[1].trim()}**${value.slice(match[1].length)}` : value;
}

function tacticalConclusionText(value) {
  const text = String(value ?? "").trim();
  const position = text.match(/(?:^|\n)\s*站位(?:（([^）]*)）|\(([^)]*)\))?\s*[：:]\s*([\s\S]*?)(?=(?:\n\s*)*(?:推荐)?(?:强化符文|海克斯)(?:（[^）]*）|\([^)]*\))?\s*[：:]|$)/u);
  if (!position) return text;
  const augments = text.match(/(?:推荐)?(?:强化符文|海克斯)(?:（([^）]*)）|\(([^)]*)\))?\s*[：:]\s*([\s\S]*)$/u);
  const source = String(position[1] ?? position[2] ?? "")
    .replace(/^来自\s*/u, "")
    .replace(/MetaTFT\s*当前/u, "MetaTFT 当前")
    .trim();
  const positions = sectionItems(position[3], /[，；]\s*/u).map(emphasizedPositionItem);
  const augmentItems = augments
    ? sectionItems(augments[3], /[、，；]\s*/u).map(emphasizedAugmentItem)
    : [];
  const augmentQualifier = String(augments?.[1] ?? augments?.[2] ?? "").trim();
  return [
    `**阵容站位${source ? `（${source}）` : ""}**`,
    ...positions.map((item) => `- ${item}`),
    ...(augmentItems.length ? [
      "",
      `**推荐强化符文${augmentQualifier ? `（${augmentQualifier}）` : ""}**`,
      ...augmentItems.map((item) => `- ${item}`)
    ] : [])
  ].join("\n");
}

export function conclusionDisplayText(value) {
  return tacticalConclusionText(cleanInternalPositionIds(value));
}

export function conclusionRichTextHtml(value) {
  const displayText = conclusionDisplayText(value);
  const lines = autoStructuredConclusionText(displayText).split("\n");
  const blocks = [];
  let listItems = [];
  let listType = "ul";

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<${listType} class="assistant-rich-text__list">${listItems.map((item) => `<li>${inlineConclusionHtml(item)}</li>`).join("")}</${listType}>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bullet = line.match(/^(?:[-•]|\*)\s+(.+)$/u);
    if (bullet) {
      if (listItems.length && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(bullet[1]);
      continue;
    }

    const numberedItem = line.match(/^\d+[.)、]\s*(.+)$/u);
    if (numberedItem) {
      if (listItems.length && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(numberedItem[1]);
      continue;
    }

    flushList();
    const markdownHeading = line.match(/^#{1,3}\s+(.+)$/u);
    if (markdownHeading) {
      blocks.push(`<h3 class="assistant-rich-text__section-title">${inlineConclusionHtml(markdownHeading[1])}</h3>`);
      continue;
    }
    const summary = summaryLineParts(line);
    if (summary) {
      blocks.push(`<aside class="assistant-rich-text__summary"><strong>${escapeHtml(summary[1])}</strong>${summary[2] ? `<span>${inlineConclusionHtml(summary[2])}</span>` : ""}</aside>`);
      continue;
    }

    const sectionTitle = line.match(/^\*\*(.+?)\*\*$/u);
    if (sectionTitle) {
      blocks.push(`<h3 class="assistant-rich-text__section-title">${inlineConclusionHtml(sectionTitle[1])}</h3>`);
      continue;
    }

    blocks.push(`<p class="assistant-rich-text__paragraph">${inlineConclusionHtml(line)}</p>`);
  }

  flushList();
  return `<div class="assistant-rich-text" data-assistant-output-schema="${ASSISTANT_OUTPUT_SCHEMA_VERSION}">${blocks.join("")}</div>`;
}
