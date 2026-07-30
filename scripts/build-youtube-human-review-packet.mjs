import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) result[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      result[key] = argv[++index];
    } else result[key] = true;
  }
  return result;
}

function text(value) {
  return String(value ?? "").replaceAll("\r\n", "\n").trim();
}

function inline(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => `\`${text(value).replaceAll("`", "\\`")}\``)
    .join("、") || "无";
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "?";
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(2).replace(/\.?0+$/, "");
  return `${minutes}:${remainder.padStart(2, "0")}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolveArtifactPath(value, envelopePath) {
  if (!value) throw new Error(`${envelopePath} is missing a raw transcript artifact`);
  const candidates = isAbsolute(String(value))
    ? [String(value)]
    : [
        resolve(String(value)),
        resolve(dirname(envelopePath), String(value))
      ];
  let lastError;
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Cannot read transcript artifact for ${envelopePath}: ${lastError?.message ?? value}`
  );
}

async function loadFullTranscript(annotation, outputsDirectory) {
  const outputName = annotation.output ?? `${annotation.videoId}.json`;
  const envelopePath = resolve(outputsDirectory, outputName);
  const envelope = await readJson(envelopePath);
  const expectedHash = annotation.annotationProvenance?.sourceTranscriptHash;
  if (envelope.source?.videoId !== annotation.videoId) {
    throw new Error(`${annotation.id} output videoId does not match the annotation`);
  }
  if (!expectedHash || envelope.source?.transcriptHash !== expectedHash) {
    throw new Error(`${annotation.id} output transcriptHash does not match the annotation`);
  }
  const artifactPath = await resolveArtifactPath(
    envelope.artifacts?.canonicalRawTranscript ?? envelope.artifacts?.rawTranscript,
    envelopePath
  );
  const artifact = await readJson(artifactPath);
  if (artifact.transcriptHash !== expectedHash) {
    throw new Error(`${annotation.id} raw transcript hash does not match the annotation`);
  }
  const transcript = artifact.transcript;
  const snippets = transcript?.snippets;
  if (!Array.isArray(snippets) || snippets.length === 0) {
    throw new Error(`${annotation.id} raw transcript has no snippets`);
  }
  const normalized = snippets.map((snippet) => {
    const start = Number(snippet.start);
    const duration = Number(snippet.duration);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || !text(snippet.text)) {
      throw new Error(`${annotation.id} raw transcript contains an invalid snippet`);
    }
    return {
      start,
      end: start + Math.max(0, duration),
      text: text(snippet.text)
    };
  });
  return {
    artifactPath,
    hash: expectedHash,
    language: transcript.language ?? envelope.source?.locale,
    snippetCount: normalized.length,
    start: normalized[0].start,
    end: Math.max(...normalized.map((snippet) => snippet.end)),
    snippets: normalized
  };
}

function renderFullTranscript(lines, caseId, transcript) {
  lines.push(
    `### ${caseId} / 完整字幕覆盖`,
    "",
    `- 字幕片段：${transcript.snippetCount}`,
    `- 覆盖时间：\`${formatSeconds(transcript.start)}–${formatSeconds(transcript.end)}\``,
    `- 语言：\`${text(transcript.language) || "unknown"}\``,
    `- 冻结字幕哈希：\`${transcript.hash}\``,
    "",
    "请先顺序阅读以下全部时间块，再审核 seed claim，并通过 `additionalClaims`",
    "补充字幕支持但 seed 遗漏的可复用 TFT 知识。",
    ""
  );
  const blocks = new Map();
  for (const snippet of transcript.snippets) {
    const blockStart = Math.floor(snippet.start / 300) * 300;
    const block = blocks.get(blockStart) ?? [];
    block.push(
      `[${snippet.start.toFixed(2)}–${snippet.end.toFixed(2)}] ${snippet.text}`
    );
    blocks.set(blockStart, block);
  }
  for (const [blockStart, blockLines] of blocks) {
    const blockEnd = Math.min(blockStart + 300, transcript.end);
    lines.push(
      `<details><summary>${formatSeconds(blockStart)}–${formatSeconds(blockEnd)}</summary>`,
      "",
      "```text",
      ...blockLines,
      "```",
      "",
      "</details>",
      ""
    );
  }
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(
  String(args.manifest ?? "services/youtube-ingestion/acceptance/manifest.json")
);
const outputsDirectory = resolve(
  String(args.outputs ?? ".cache/youtube-acceptance/retest-v6-final")
);
const outputPath = resolve(
  String(
    args.output
    ?? ".cache/youtube-acceptance/human-review-packet.md"
  )
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const lines = [
  "# YouTube RAG 独立人工标注审核包",
  "",
  "本文件用于人工盲审，不能由提取模型自动签核。请逐条对照字幕窗口：",
  "",
  "- `支持`：claim、实体、条件和时间戳均由字幕支持；",
  "- `驳回`：不是可复用 TFT 知识、字幕不支持或属于无关内容；",
  "- `修改`：写出修订后的 claim、实体、条件或时间戳；",
  "- 审阅者不应以当前 KnowledgeDocument 数量作为正确答案。",
  "",
  "完成后需在对应 annotation JSON 中设置：",
  "",
  "```json",
  "{",
  '  "annotationStatus": "complete",',
  '  "annotationProvenance": {',
  '    "reviewer": "<姓名或审阅标识>",',
  '    "reviewerType": "human",',
  '    "independentHumanReview": true,',
  '    "transcriptCoverageReviewed": true,',
  '    "exhaustiveClaimReview": true,',
  '    "reviewedAt": "<ISO-8601 时间>"',
  "  }",
  "}",
  "```",
  "",
  "推荐使用机器可校验的审核表，而不是直接修改 annotation：",
  "",
  "```powershell",
  "npm run youtube:acceptance:review:export",
  "# 填写 .cache/youtube-acceptance/human-review.json",
  "npm run youtube:acceptance:review:apply",
  "npm run youtube:acceptance:review:evaluate",
  "```",
  "",
  "审核人必须阅读完整字幕覆盖范围并补充 seed 遗漏的 claim；只确认现有 claim",
  "不能证明 claim recall。`apply` 会校验 reviewer、三项 attestation、字幕哈希、",
  "逐条 fingerprint、全部 claim 和无关窗口 decision，并输出新的 reviewed 集，",
  "不会覆盖仓库中的 provisional seed。",
  ""
];

let totalClaims = 0;
let totalSnippets = 0;
for (const entry of manifest.cases ?? []) {
  const annotationPath = resolve(dirname(manifestPath), entry.annotationFile);
  const annotation = await readJson(annotationPath);
  const transcript = await loadFullTranscript(annotation, outputsDirectory);
  const claims = annotation.annotations?.claims ?? [];
  totalClaims += claims.length;
  totalSnippets += transcript.snippetCount;
  lines.push(
    `## ${entry.id}`,
    "",
    `- 视频：${annotation.sourceUrl}`,
    `- 类别：\`${annotation.category}\``,
    `- scope：\`${annotation.season} / ${annotation.patch} / ${annotation.locale}\``,
    `- 字幕哈希：\`${annotation.annotationProvenance?.sourceTranscriptHash}\``,
    `- 完整字幕片段：${transcript.snippetCount}`,
    `- 待审核 claim：${claims.length}`,
    ""
  );
  renderFullTranscript(lines, entry.id, transcript);
  for (const [index, claim] of claims.entries()) {
    lines.push(
      `### ${entry.id} / ${index + 1}`,
      "",
      `- [ ] 支持  - [ ] 驳回  - [ ] 修改`,
      `- 类型：\`${text(claim.type)}\``,
      `- 实体：${inline(claim.subjects)}`,
      `- 条件：${inline(claim.conditions)}`,
      `- 时间：\`${claim.timestampStart}–${claim.timestampEnd}s\``,
      `- 待审 claim：${text(claim.reviewedClaim)}`,
      "",
      "<details><summary>字幕窗口</summary>",
      "",
      "```text",
      text(claim.transcriptExcerpt),
      "```",
      "",
      "</details>",
      "",
      "- 修订：",
      ""
    );
  }
  for (const [index, window] of (
    annotation.annotations?.irrelevantWindows ?? []
  ).entries()) {
    lines.push(
      `### ${entry.id} / 无关窗口 ${index + 1}`,
      "",
      `- [ ] 确认无关  - [ ] 不是无关`,
      `- 时间：\`${window.timestampStart}–${window.timestampEnd}s\``,
      `- 原因：${text(window.reason)}`,
      ""
    );
  }
}

lines.splice(2, 0, `共 ${manifest.cases?.length ?? 0} 个视频、${totalClaims} 条 claim。`, "");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  ok: true,
  output: outputPath,
  cases: manifest.cases?.length ?? 0,
  claims: totalClaims,
  transcriptSnippets: totalSnippets
}, null, 2)}\n`);
