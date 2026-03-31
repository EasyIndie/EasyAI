# 开发与测试（Development）

## 1. TS-Only 规范（Node 侧）

本仓库的 **Node 侧代码与脚本统一以 TypeScript 作为源码语言**，避免出现 `.js/.mjs/.cjs` 等 JavaScript 源码文件，确保一致的工程规范与可维护性。

说明：仓库中仍可能包含非 TS 的配置/文档/基础设施文件（例如 `.yaml/.yml/.md/Dockerfile` 等），以及 Python 服务实现（如 `litellm-service`）。本规范重点约束 “Node 相关源码与脚本”。

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
npm test
```

### 2.2 Admin UI

```bash
cd oneapi-gateway/admin-ui
npm run build
```

## 3. 安全测试（基线）

### 3.0 生产配置基线

- 生产环境请设置 `APP_ENV=production`，并确保不会使用默认示例值（例如 `admin:admin`、`dev-key`、`dev-internal`），否则网关会拒绝启动。
- 如启用 Batch/内部调用鉴权（`ONEAPI_INTERNAL_TOKEN`），默认会将 internal token 请求来源限制在私网/本机 CIDR（可用 `ONEAPI_INTERNAL_TOKEN_ALLOW_CIDRS` 覆盖，或设置为 `any` 关闭限制）。
- 如果网关部署在反向代理/Ingress/LB 后，需要按实际链路设置 `ONEAPI_TRUST_PROXY=1`（可选 `ONEAPI_TRUST_PROXY_HOPS=<n>`），以便基于真实客户端 IP 执行 internal token 的 CIDR 限制。
- Kubernetes 默认启用 NetworkPolicy 安全基线（combined），如果你的集群未启用 CNI NetworkPolicy 或需额外放通（例如外部调用 litellm），需要按需调整策略。

### 3.1 依赖扫描

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

### 3.2 OWASP ZAP（baseline）

```bash
docker run --rm --network host -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t http://localhost:8080/ \
  -r zap-report.html
```

在 Docker Desktop（macOS/Windows）上，`--network host` 行为与 Linux 不同；可改扫 `http://host.docker.internal:8080/` 或直接在宿主机运行扫描。

## 4. 文档一致性校验（Doc Audit）

用于防止文档中的 env 名称、关键路径与实现不一致：

```bash
cd oneapi-gateway
npm run doc-audit
```
