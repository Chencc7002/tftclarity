import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const script = resolve("scripts/build-youtube-human-review-packet.mjs");

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeFixture(root, transcriptHash = "frozen-transcript-hash") {
  const manifestDirectory = join(root, "acceptance");
  const annotationsDirectory = join(manifestDirectory, "annotations");
  const outputsDirectory = join(root, "outputs");
  await mkdir(annotationsDirectory, { recursive: true });
  await mkdir(outputsDirectory, { recursive: true });

  const artifactPath = join(outputsDirectory, "raw-transcript.json");
  await writeJson(artifactPath, {
    schemaVersion: "youtube_transcript_artifact.v1",
    transcriptHash,
    transcript: {
      videoId: "abcdefghijk",
      language: "en",
      snippets: [
        { start: 0, duration: 2, text: "First complete transcript line." },
        { start: 301, duration: 3, text: "Second complete transcript line." }
      ]
    }
  });
  await writeJson(join(outputsDirectory, "case.json"), {
    source: {
      videoId: "abcdefghijk",
      transcriptHash,
      locale: "en"
    },
    artifacts: {
      canonicalRawTranscript: artifactPath
    }
  });
  await writeJson(join(annotationsDirectory, "case.json"), {
    id: "case",
    videoId: "abcdefghijk",
    output: "case.json",
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    category: "short_video",
    season: "set-test",
    patch: "1.0",
    locale: "en",
    annotationProvenance: {
      sourceTranscriptHash: transcriptHash
    },
    annotations: {
      claims: [],
      irrelevantWindows: []
    }
  });
  await writeJson(join(manifestDirectory, "manifest.json"), {
    name: "review-packet-test",
    cases: [{
      id: "case",
      annotationFile: "annotations/case.json"
    }]
  });
  return {
    manifestPath: join(manifestDirectory, "manifest.json"),
    annotationPath: join(annotationsDirectory, "case.json"),
    outputsDirectory
  };
}

test("human review packet includes the complete hash-locked transcript", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "youtube-review-packet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await makeFixture(root);
  const outputPath = join(root, "packet.md");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    "--manifest",
    fixture.manifestPath,
    "--outputs",
    fixture.outputsDirectory,
    "--output",
    outputPath
  ]);
  const result = JSON.parse(stdout);
  const packet = await readFile(outputPath, "utf8");
  assert.equal(result.transcriptSnippets, 2);
  assert.match(packet, /case \/ 完整字幕覆盖/);
  assert.match(packet, /First complete transcript line/);
  assert.match(packet, /Second complete transcript line/);
  assert.match(packet, /0:00–5:00/);
  assert.match(packet, /5:00–5:04/);
});

test("human review packet fails closed on transcript hash drift", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "youtube-review-packet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await makeFixture(root);
  const annotation = JSON.parse(
    await readFile(fixture.annotationPath, "utf8")
  );
  annotation.annotationProvenance.sourceTranscriptHash = "changed-hash";
  await writeJson(fixture.annotationPath, annotation);
  await assert.rejects(
    execFileAsync(process.execPath, [
      script,
      "--manifest",
      fixture.manifestPath,
      "--outputs",
      fixture.outputsDirectory,
      "--output",
      join(root, "packet.md")
    ]),
    /output transcriptHash does not match the annotation/
  );
});
