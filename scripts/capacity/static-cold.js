import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "https://tftclarity.cn").replace(/\/$/, "");
const vus = Number(__ENV.VUS || 1);
const rampSeconds = Number(__ENV.RAMP_SECONDS || 0);

export const options = {
  scenarios: {
    cold_open: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      maxDuration: `${Math.max(60, rampSeconds + 30)}s`,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<5000"],
    checks: ["rate>0.99"],
  },
};

const assets = [
  "/styles.css",
  "/app.js",
  "/favicon.png?v=20260727",
  "/assets/wallpapers/set-17/stargazer-convergence.d9a32361f3ae.webp",
];

const params = {
  headers: { "User-Agent": "tftclarity-capacity-test/1.0" },
};

export default function () {
  if (rampSeconds > 0) sleep(Math.random() * rampSeconds);

  const home = http.get(`${baseUrl}/`, { ...params, tags: { endpoint: "home" } });
  check(home, { "home returns 200": (response) => response.status === 200 });

  const responses = http.batch(
    assets.map((path) => ["GET", `${baseUrl}${path}`, null, { ...params, tags: { endpoint: "static" } }]),
  );
  check(responses, {
    "all initial assets return 200": (values) => values.every((response) => response.status === 200),
  });
}
