# 本机模型实测报告

本文档汇总当前设备上本地模型的关键测试数据，用于快速判断模型的速度、内存占用和默认推荐顺序。

## 1. 测试环境

- 测试日期：`2026-04-07`
- 设备：`MacBook Pro (Apple M4 Pro, 48 GB 内存)`
- Docker Desktop 可用内存：`16 GB`
- 运行方式：`docker compose + Ollama + LiteLLM`
- 模型来源：`config/litellm/litellm.yaml`

## 2. 测试方法

- 每次测试前执行 `docker compose restart ollama`，确保单模型独占加载
- 直接调用 `Ollama /api/generate`，固定 prompt 为 `reply only ok`
- 记录 `ollama ps` 的驻留大小、`docker stats` 的容器内存占用，以及首响应耗时

说明：

- 该数据更接近首次加载时的冷启动结果
- `ollama ps` 与 `docker stats` 统计口径不同，数值存在小幅差异属于正常现象

## 3. 模型对比

| 模型 | 容器内存 | 首响应耗时 | 结论 |
| --- | --- | --- | --- |
| `qwen2.5:0.5b` | `587.1 MiB` | `0.894s` | 最适合作为默认轻量模型 |
| `qwen2.5-coder:1.5b` | `1.185 GiB` | `1.467s` | 适合作为默认代码模型 |
| `gemma4:e2b` | `7.314 GiB` | `7.169s` | 可运行，但首响明显偏慢 |
| `gemma4:e4b` | `9.952 GiB` | `8.517s` | 可运行，但占用高，不适合作为默认模型 |

## 4. 结论

- 默认聊天模型建议使用 `qwen2.5:0.5b`
- 默认代码模型建议使用 `qwen2.5-coder:1.5b`
- `gemma4:e2b` 和 `gemma4:e4b` 更适合作为可选模型
- 在 `16 GB` Docker 内存下，`gemma4:e4b` 可以运行，但要避免同时常驻多个大模型
