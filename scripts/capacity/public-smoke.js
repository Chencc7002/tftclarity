import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "https://tftclarity.cn").replace(/\/$/, "");
const vus = Number(__ENV.VUS || 1);
const duration = __ENV.DURATION || "10s";

export const options = {
  vus,
  duration,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  const response = http.get(`${baseUrl}/`, {
    tags: { endpoint: "home" },
    headers: { "User-Agent": "tftclarity-capacity-test/1.0" },
  });
  check(response, {
    "home returns 200": (value) => value.status === 200,
    "home is HTML": (value) => String(value.headers["Content-Type"] || "").includes("text/html"),
  });
  sleep(1);
}
