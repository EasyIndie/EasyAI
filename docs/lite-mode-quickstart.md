# Lite Mode 快速启动指南

Lite 模式（轻量级模式）是 EasyAI 平台为纯推理场景设计的高效部署方案。它去除了网关（鉴权、限流、审计）、Redis 缓存和数据库等重型组件，仅保留 **LiteLLM（OpenAI 兼容代理层）** 和 **Ollama（大模型运行环境）**。

非常适合：个人本地开发测试、内网纯推理节点部署。

## 1. 快速启动

1. 在项目根目录下，使用特定的 Compose 文件启动：
   ```bash
   docker compose -f docker-compose.lite.yml up -d --build
   ```

2. 拉取你需要的本地大模型（例如 `qwen2.5:0.5b`）：
   ```bash
   docker compose -f docker-compose.lite.yml exec ollama ollama pull qwen2.5:0.5b
   ```

3. 直接发送兼容 OpenAI 规范的请求测试：
   ```bash
   curl http://localhost:4000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "model": "local/ollama:qwen2.5:0.5b",
       "messages": [{"role": "user", "content": "Hello!"}]
     }'
   ```
   *(注：Lite 模式下，端口为 `4000`，无需携带 `Authorization` 鉴权头)*

---

## 2. 核心配置: `litellm.yaml`

Lite 模式的行为完全由 `config/litellm/litellm.yaml` 控制。如果您想添加新模型或修改行为，请编辑此文件。

### 必填与核心字段说明

```yaml
service:
  # [必填] 全局超时时间（毫秒）。建议设置在 60000 - 120000 之间。
  # 设得太短会导致模型加载时就超时返回 504。
  default_timeout_ms: 120000
  
  # [必填] 允许访问的模型白名单。
  # 必须写全称（例如 local/ollama:xxx），不在列表中的模型会返回 400 错误。
  allowed_models:
    - local/ollama:qwen2.5:0.5b
    - local/ollama:qwen2.5-coder:1.5b

providers:
  ollama:
    # [必填] Ollama 服务的内网地址环境变量。在 docker-compose 中会被自动替换。
    api_base_env: OLLAMA_HOST

model_aliases:
  # [必填] 为上面的 allowed_models 配置底层路由规则。
  local/ollama:qwen2.5:0.5b:
    provider: ollama
    model: qwen2.5:0.5b
```

**可选高级配置 - 多后端负载均衡：**

```yaml
model_aliases:
  local/ollama:my-model:
    backends:
      - provider: ollama
        model: qwen2.5:0.5b
        api_base: http://ollama-1:11434
      - provider: ollama
        model: qwen2.5:0.5b
        api_base: http://ollama-2:11434
    selection: hash  # hash（默认，按请求内容哈希路由）或 round_robin
```

---

## 3. 常见错误排查指南

在 Lite 模式下，系统内置了强大的自愈和错误解析能力，您可以直接通过 API 的返回 JSON 定位问题。

### 常见状态码与原因

#### 404 Not Found (Model not found)
- **现象**：请求提示 `The requested model might not be pulled locally.`
- **原因**：你在请求中指定了模型（如 `gemma4:e2b`），但当前机器的 Ollama 中还没有下载它。
- **解决**：运行拉取命令 `docker compose -f docker-compose.lite.yml exec ollama ollama pull <model_name>`。

#### 504 Gateway Timeout (Upstream timeout)
- **现象**：请求转了很久，然后提示 `The model took too long to respond.`
- **原因**：机器性能有限，Ollama 把大模型加载到显存/内存耗费的时间超过了 `litellm.yaml` 中配置的 `default_timeout_ms`。
- **解决**：调大 `litellm.yaml` 中的超时时间，或者等待第一次慢加载结束后再试（第二次会很快）。

#### 507 Insufficient Storage (Insufficient memory)
- **现象**：提示 `The system does not have enough memory to run this model.`
- **原因**：您的机器可用内存（或分配给 Docker 的内存）不足以加载该模型。
- **自愈机制**：LiteLLM 捕获此错误后，**会在后台自动触发模型卸载**。
- **解决**：在 Mac/Windows 上调大 Docker 的内存限制（建议 12GB+）；或者更换规模更小（如 `0.5b`、`2b`）的模型。

#### 499 Client Closed Request
- **现象**：在服务端日志（`docker logs litellm`）中看到 499 状态码。
- **原因**：用户在模型还在"思考"或逐字输出流（Stream）时，主动关闭了浏览器网页或强制退出了 `curl` 命令。
- **解决**：这是正常的用户行为中断，无需干预服务端。

#### 502 Bad Gateway (Upstream connection error)
- **现象**：提示 `Failed to connect to upstream service.`
- **原因**：Ollama 容器崩溃，或网络不通。
- **解决**：运行 `docker compose -f docker-compose.lite.yml ps` 检查 Ollama 容器是否在正常运行。
