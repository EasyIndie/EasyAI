# 开发与测试（Development）

## 1. TS-Only 规范（Node 侧）

本仓库的 **Node 侧代码与脚本统一以 TypeScript 作为源码语言**，避免出现 `.js/.mjs/.cjs` 等 JavaScript 源码文件，确保一致的工程规范与可维护性。

说明：仓库中仍可能包含非 TS 的配置/文档/基础设施文件（例如 `.yaml/.yml/.md/Dockerfile` 等），以及 Python 服务实现（如 `litellm-service`）。本规范重点约束 "Node 相关源码与脚本"。

规则摘要：
- 源码文件统一使用 `.ts`
- 内部模块引用统一使用 `.ts` 扩展名（例如 `./config.ts`）
- 不提交或维护 JavaScript 源码文件：`.js/.mjs/.cjs`
- 工具脚本放在 `tools/` 下并使用 `.ts`

Node 版本建议：
- 推荐使用 Node 22（仓库根目录提供 `.nvmrc`）

## 2. 单元/集成测试

### 2.1 OneAPI Gateway

```bash
cd oneapi-gateway
npm install
npm test
```

测试覆盖范围：
- 鉴权模块 (auth.test.ts)
- 管理 API (admin.api.test.ts)
- 批处理 API (batch.api.test.ts)
- 缓存逻辑 (cache.test.ts)
- 配置验证 (config.validation.test.ts)
- Dashboard API (dashboard.api.test.ts)
- 数据库清理 (db-delete.test.ts)
- Guardrails (guardrails.test.ts)
- OpenAPI 规范 (openapi.test.ts)
- 代理转发集成 (proxy.integration.test.ts)
- 限流 (rate_limit.test.ts)
- 上游管理 (upstreams.test.ts)

### 2.2 Admin UI

```bash
cd oneapi-gateway/admin-ui
npm ci && npm run build
```

### 2.3 Chat UI

```bash
cd oneapi-gateway/chat-ui
npm ci && npm run build
```

## 3. Docker 构建

构建所有服务镜像：

```bash
docker compose build
```

或构建单个组件：

```bash
docker compose build oneapi
docker compose build litellm
docker compose build batch_worker
```

## 4. 安全测试（基线）

### 4.1 生产配置基线

- 生产环境请在 `oneapi.yaml` 中设置 `app_env: "production"`，并确保不会使用默认示例值（例如 `admin:admin`、`dev-key`、`dev-internal`），否则网关会拒绝启动。
- 如启用 Batch/内部调用鉴权（`internal_token`），默认会将 internal token 请求来源限制在私网/本机 CIDR（可用 `internal_token_allow_cidrs` 覆盖，或设置为 `any` 关闭限制）。
- 如果网关部署在反向代理/Ingress/LB 后，需要按实际链路设置 `trust_proxy: true`（可选配置跳数），以便基于真实客户端 IP 执行 internal token 的 CIDR 限制。
- Kubernetes 默认启用 NetworkPolicy 安全基线（combined），如果你的集群未启用 CNI NetworkPolicy 或需额外放通（例如外部调用 litellm），需要按需调整策略。
- 生产环境建议启用 Guardrails（`guardrails.enabled: true`）并配置 TLS。

### 4.2 依赖扫描

```bash
cd oneapi-gateway
npm audit
```

容器镜像（示例：Trivy）：

```bash
trivy image easyai/oneapi-gateway:latest
trivy image easyai/litellm-service:latest
trivy image easyai/batch-worker:latest
```

### 4.3 OWASP ZAP（baseline）

```bash
docker run --rm --network host -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t http://localhost:3003/ \
  -r zap-report.html
```

在 Docker Desktop（macOS/Windows）上，`--network host` 行为与 Linux 不同；可改扫 `http://host.docker.internal:3003/` 或直接在宿主机运行扫描。

## 5. 文档一致性校验（Doc Audit）

用于防止文档中的 env 名称、关键路径与实现不一致：

```bash
cd oneapi-gateway
npm run doc-audit
```
