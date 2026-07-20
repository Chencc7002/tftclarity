import test from "node:test";
import assert from "node:assert/strict";
import { createSmallWindowServer } from "../src/app/small-window-server.js";

test("public legal routes return their HTML documents over HTTP", async (t) => {
  const server = createSmallWindowServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const cases = [
    ["/privacy", "Privacy Policy"],
    ["/privacy/", "Privacy Policy"],
    ["/terms", "Terms of Service"],
    ["/terms/", "Terms of Service"]
  ];

  for (const [path, title] of cases) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/u, path);
    assert.match(await response.text(), new RegExp(`<title>${title}`), path);
  }
});
