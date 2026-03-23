import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 20 },
    { duration: "3m", target: 200 },
    { duration: "1m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.02"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_KEY = __ENV.API_KEY || "dev-key";

export default function () {
  const url = `${BASE_URL}/v1/embeddings`;
  const payload = JSON.stringify({
    model: "local/ollama:llama3.1",
    input: "Peak traffic test",
  });

  const res = http.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  check(res, { "status 200": (r) => r.status === 200 });
  sleep(0.05);
}

