import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 20,
  duration: "5m",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_KEYS = (__ENV.API_KEYS || "dev-key")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default function () {
  const key = API_KEYS[__VU % API_KEYS.length];
  const url = `${BASE_URL}/v1/chat/completions`;
  const payload = JSON.stringify({
    model: "local/ollama:qwen2.5:0.5b",
    messages: [{ role: "user", content: `Tenant ${__VU} hello` }],
    temperature: 0,
  });

  const res = http.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
  });

  check(res, { "status 200": (r) => r.status === 200 });
  sleep(0.2);
}
