import assert from "node:assert/strict";
import test from "node:test";

import { patchBilibiliMcpSource } from "../deploy/patch-bilibili-mcp-upstream.mjs";

const fixture = `
export async function getVideoDetail(videoId: string) {
  let videoUrl: string;
  if (videoId.startsWith('BV')) {
    videoUrl = \`${"${API_WEB}"}/view?bvid=${"${videoId}"}\`;
  } else {
    const aid = videoId.substring(2);
    videoUrl = \`${"${API_WEB}"}/view?aid=${"${aid}"}\`;
  }
}
`;

test("patches both BVID and AV detail calls onto the working WBI endpoint", () => {
  const patched = patchBilibiliMcpSource(fixture);

  assert.match(patched, /\/wbi\/view\?bvid=\$\{videoId\}/u);
  assert.match(patched, /\/wbi\/view\?aid=\$\{aid\}/u);
  assert.doesNotMatch(patched, /\$\{API_WEB\}\/view\?/u);
});

test("fails closed when the pinned upstream source shape changes", () => {
  assert.throws(
    () => patchBilibiliMcpSource(fixture.replace("/view?bvid=", "/wbi/view?bvid=")),
    /Expected exactly one upstream occurrence/u
  );
});
