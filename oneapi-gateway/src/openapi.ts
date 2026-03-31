import type { FastifyInstance } from "fastify";
import type { Config } from "./config.ts";

function buildSpec(cfg: Config) {
  const securitySchemes = {
    bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT or API Key" },
    apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
  } as const;

  const security = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

  return {
    openapi: "3.0.3",
    info: {
      title: "OneAPI Gateway",
      version: "0.1.0",
      description:
        "User-facing APIs for calling OpenAI-compatible endpoints via the gateway. Admin/Dashboard/Metrics endpoints are intentionally not included.",
    },
    servers: [{ url: "/" }],
    components: { securitySchemes },
    tags: [{ name: "OpenAI" }, { name: "Batch" }],
    paths: {
      "/v1/models": {
        get: {
          tags: ["OpenAI"],
          summary: "List models (proxied)",
          security,
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/v1/chat/completions": {
        post: {
          tags: ["OpenAI"],
          summary: "Create chat completion (proxied)",
          description:
            "This endpoint is forwarded to upstream OpenAI-compatible services. Streaming responses use server-sent events when stream=true.",
          security,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "messages"],
                  properties: {
                    model: { type: "string" },
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["role", "content"],
                        properties: {
                          role: { type: "string", enum: ["system", "user", "assistant", "tool"] },
                          content: { type: "string" },
                          name: { type: "string" },
                        },
                      },
                    },
                    stream: { type: "boolean", default: false },
                    temperature: { type: "number" },
                    top_p: { type: "number" },
                    max_tokens: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/event-stream": { schema: { type: "string" } },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/v1/embeddings": {
        post: {
          tags: ["OpenAI"],
          summary: "Create embeddings (proxied)",
          security,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "input"],
                  properties: {
                    model: { type: "string" },
                    input: {
                      oneOf: [
                        { type: "string" },
                        { type: "array", items: { type: "string" } },
                        { type: "array", items: { type: "integer" } },
                        { type: "array", items: { type: "array", items: { type: "integer" } } },
                      ],
                    },
                    encoding_format: { type: "string", enum: ["float", "base64"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/v1/batches": {
        post: {
          tags: ["Batch"],
          summary: "Create a batch job",
          security,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requests"],
                  properties: {
                    requests: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["endpoint", "body"],
                        properties: {
                          endpoint: { type: "string", description: "Target endpoint under /v1, e.g. /v1/chat/completions" },
                          body: { type: "object" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Unauthorized" },
            "503": { description: "Batch not enabled" },
          },
        },
      },
      "/v1/batches/{batchId}": {
        get: {
          tags: ["Batch"],
          summary: "Get batch status",
          security,
          parameters: [{ name: "batchId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" },
          },
        },
      },
      "/v1/batches/{batchId}/output": {
        get: {
          tags: ["Batch"],
          summary: "Download batch output (JSONL)",
          security,
          parameters: [{ name: "batchId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/jsonl": { schema: { type: "string" } },
                "text/plain": { schema: { type: "string" } },
              },
            },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden" },
            "404": { description: "Not found" },
          },
        },
      },
    },
    "x-oneapi": {
      authModes: Array.from(cfg.authModes.values()),
      notes: ["The gateway proxies any other /v1/* paths supported by upstreams, but only a common subset is described here."],
    },
  };
}

export async function registerOpenApi(app: FastifyInstance, cfg: Config): Promise<void> {
  const spec = buildSpec(cfg);

  app.get("/openapi.json", async (_req, reply) => {
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("cache-control", "no-store");
    return spec;
  });

  app.get("/docs", async (_req, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OneAPI Gateway API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true
      });
    </script>
  </body>
</html>`;
  });
}

