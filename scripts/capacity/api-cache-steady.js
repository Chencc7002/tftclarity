import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "https://tftclarity.cn").replace(/\/$/, "");
const baseUrls = String(__ENV.BASE_URLS || baseUrl)
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const vus = Number(__ENV.VUS || 1);
const duration = __ENV.DURATION || "30s";
const rampDuration = __ENV.RAMP_DURATION || "";
const rampDownDuration = __ENV.RAMP_DOWN_DURATION || "10s";
const thinkMin = Number(__ENV.THINK_MIN_SECONDS || 15);
const thinkMax = Number(__ENV.THINK_MAX_SECONDS || 30);
const trustedTunnel = __ENV.TRUSTED_TUNNEL === "1";

export const options = {
  ...(rampDuration
    ? {
        scenarios: {
          steady: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
              { duration: rampDuration, target: vus },
              { duration, target: vus },
              { duration: rampDownDuration, target: 0 },
            ],
            gracefulRampDown: "30s",
          },
        },
      }
    : { vus, duration }),
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:recommend}": ["p(95)<500", "p(99)<1000"],
    checks: ["rate>0.99"],
  },
};

const payload = JSON.stringify({
  input: __ENV.QUERY || "霞什么装备最好？",
  conversationId: "",
  seasonContextId: __ENV.SEASON_CONTEXT_ID || "set17-live",
  startNewTask: true,
  refresh: false,
  deferConclusion: false,
  quickTask: {
    schemaVersion: "quick-task.v1",
    id: "unit-build",
    operation: "unit_build_rankings",
    arguments: { champion: __ENV.CHAMPION || "霞" },
  },
  preferences: {
    structuredParserMode: "never",
    conclusionMode: "off",
  },
});

function requestHeaders(vu = 0) {
  const thirdOctet = Math.floor(vu / 250) % 250;
  const fourthOctet = (vu % 250) + 1;
  return {
    "Content-Type": "application/json",
    "User-Agent": "tftclarity-capacity-test/1.0",
    ...(trustedTunnel ? { "X-Forwarded-For": `198.18.${thirdOctet}.${fourthOctet}` } : {}),
  };
}

function endpoint(vu = 0) {
  return `${baseUrls[vu % baseUrls.length]}/api/recommend`;
}

export function setup() {
  const response = http.post(endpoint(0), payload, {
    tags: { endpoint: "prewarm" },
    headers: requestHeaders(0),
  });
  if (response.status !== 200) throw new Error(`prewarm failed with HTTP ${response.status}`);
}

export default function () {
  const response = http.post(endpoint(__VU), payload, {
    tags: { endpoint: "recommend" },
    headers: requestHeaders(__VU),
  });
  check(response, {
    "recommend returns 200": (value) => value.status === 200,
    "recommend is JSON": (value) => String(value.headers["Content-Type"] || "").includes("application/json"),
    "recommend hits query cache": (value) => {
      try {
        return JSON.parse(value.body).cache?.query?.hit === true;
      } catch {
        return false;
      }
    },
  });
  sleep(thinkMin + Math.random() * Math.max(0, thinkMax - thinkMin));
}
