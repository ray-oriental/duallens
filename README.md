# DualLens 双语对照翻译

[![CI](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml/badge.svg)](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

独立实现的 Chrome / Edge Manifest V3 网页双语翻译扩展。由你选择模型和服务；没有账户体系、遥测或付费墙。

**第一版 v0.1.0：网页核心功能。** PDF、EPUB、视频字幕、OCR、文档和 iframe 翻译尚未实现，见 [路线图](docs/ROADMAP.md)。这不是任何第三方翻译扩展的官方版本或代码分支。

## 下载与安装

仅浏览器使用下载扩展包；需要本机网关或离线开发时下载 portable 完整源码包，或克隆本仓库。

从 [Releases](https://github.com/ray-oriental/duallens/releases) 下载 `duallens-extension-v0.1.0.zip`，解压后：

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的解压目录。
3. 从源码安装时，选择本仓库的 `extension/` 目录。无需 npm install 或构建。
4. 打开扩展设置，先选择并配置模型。新安装默认选择未配置的「自定义 OpenAI 兼容接口」，不会自动借用本机账户或校园服务。
5. 打开普通网页，点击扩展按钮「翻译页面」。

扩展固定 ID 为 `noodgdnebcnfkgipoabjjlgaebocgnkj`。manifest 的 key 是公开身份信息，无私钥。当前没有上架扩展商店；不支持 Firefox / Safari。

## 功能

### Edge 商店与 Android 用户脚本

审核通过后可用：从 Microsoft Edge Add-ons 安装商店版。审核通过前，请使用 Release 中的 `duallens-edge-store-v<version>.zip` 解压后加载，或使用开发者模式安装。

Android Edge：打开“扩展”并安装 Tampermonkey，然后打开 Release 里的 `duallens.user.js` 链接，按 Tampermonkey 提示安装并在脚本设置中填写自己的模型服务。

- 段落级双语对照、仅译文和恢复原文；保留链接、加粗和行内代码。
- 视口懒翻译、动态内容、SPA 页面；翻译缓存、模型限流与备用模型冷却。
- Shift + 悬停、划词翻译、输入框三连空格翻译、悬浮球。
- 15 种译文样式、术语表、提示词预设、总是／从不翻译站点规则。
- `Alt+A` 翻译／恢复，`Alt+W` 双语／仅译文，`Alt+I` 翻译当前输入框。若有快捷键冲突，在浏览器扩展快捷键页调整。

## 选择模型

### 自定义接口

设置中选择「自定义 OpenAI 兼容接口」，填入你有权使用的服务的 base URL（通常以 `/v1` 结尾）、模型名和可选 API key。接口需支持非流式 `/chat/completions` 和纯文本 messages。不支持 JSON mode 的端点可关闭该选项；400 格式错误也会去掉格式参数重试一次。

API key 只保存在当前浏览器的 `chrome.storage.local`，不会同步或导出。网页文本将发送给你选择的服务；在私密页面使用前应明确该服务的数据处理方式。

### 本机网关与 Ollama

可使用 Python 3.10+ 标准库网关（无需 pip 依赖）：

```sh
python -B gateway/duallens_gateway.py serve --port 18790
```

默认仅启用 Ollama，地址 `http://127.0.0.1:11434`，模型名单为 `qwen3:4b`、`gpt-oss:20b`；需要自行准备模型。设置中选择「本机网关」、base URL `http://127.0.0.1:18790/v1`、模型 `ollama/qwen3:4b`。也可按下方配置添加已有的其他 Ollama 模型。

网关健康检查：`http://127.0.0.1:18790/health`。浏览器 Origin 默认仅允许上述固定 DualLens 身份，本机程序也可通过回环接口调用。商店版要把商店分配的扩展 ID 加入 `~/.duallens/gateway.json` 的 `allowed_origins` 白名单；只接受用户显式填写的精确 `chrome-extension://<id>`，不接受通配或网页来源。

### 可选集成：SJTU、Hermes、Claude、Codex

这些后端默认关闭，需在机器本地 `~/.duallens/gateway.json` 显式启用。参考 [网关配置示例](gateway/gateway.example.json) 与 [架构说明](docs/ARCHITECTURE.md)。配置、登录态、令牌与模型都不放入仓库。

- SJTU：适配已有的本机 DDL Hub 中转和共享额度账；不附带中转或校园登录凭据。
- Hermes：适配独立的 `hermes proxy` 回环进程，并限制模型白名单；不向聊天 agent 发送请求或改它的配置。服务与模型的可用性、免费规则由提供方决定。
- Claude / Codex：当前订阅 CLI 适配面向 Windows npm 安装。需要你已有的官方 CLI 登录态；仅手动选用，不加入自动备用链。默认不设每日调用上限，仍受订阅本身额度限制。CLI 会关闭工具和项目指令读取。
- Linux / macOS 可使用直接兼容端点或网关 Ollama；此版本不承诺订阅 CLI、自启脚本或 Hermes 启动包装器在这些平台可用。

### 离线演示

选择「Mock（测试，不联网）」即可验证页面交互。译文只是在原句前加「【译】」，**不是真实翻译**，也不调用任何模型。

## Windows 登录自启（可选）

在仓库目录或完整源码包目录的 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File gateway\Install-Startup.ps1
# 只有已安装并配置 Hermes 时才增加其独立代理启动项
powershell -ExecutionPolicy Bypass -File gateway\Install-Startup.ps1 -WithHermes
# 停止并移除两个 DualLens 自有启动项
powershell -ExecutionPolicy Bypass -File gateway\Install-Startup.ps1 -Remove
```

运行态在 `~/.duallens`。脚本不会自动支付、注册第三方账号或安装模型，也不会修改其他应用的启动项。

## 开发与协作

见 [贡献指南](CONTRIBUTING.md)。GitHub `main` 是协作基线；用 fork／feature branch 和 PR 开发，不同步运行态或直接覆盖其他人的改动。CI 在 Windows 与 Ubuntu 跑离线单测，Ubuntu 另跑 mock 浏览器验收。

```sh
npm test
python -B -m unittest discover -s gateway/tests
python -B scripts/check_project.py
python -B scripts/build_release.py
```

Node.js 24、Python 3.12 是 CI 验证版本；浏览器 E2E 的独立安装说明见 [tests/e2e/README.md](tests/e2e/README.md)。

## 限制与许可证

当前仅顶层网页；复杂真实站点还需要逐站验证。本机小模型可能漏翻或给出低质量译文。原子图片按页面元素克隆，可能再次请求原资源。浏览器内部页面不能注入扩展。

源码和原创图标采用 [MIT](LICENSE)。不包含参考扩展的发布包、源码、默认规则表或品牌素材。安全报告方式见 [SECURITY.md](SECURITY.md)。
