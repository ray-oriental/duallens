# DualLens 双语对照翻译

[![CI](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml/badge.svg)](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

独立实现的通用网页双语翻译插件：桌面 Chrome / Edge 用 Manifest V3 扩展，Android Edge 手机与平板用 Tampermonkey 用户脚本。填入自己的模型服务即可使用，本机网关是可选增强；没有账户体系、遥测或付费墙。

**第一版 v0.1.0：网页核心功能。** PDF、EPUB、视频字幕、OCR、文档和 iframe 翻译尚未实现，见 [路线图](docs/ROADMAP.md)。这不是任何第三方翻译扩展的官方版本或代码分支。

工作区已接入 v0.2 多平台与设置 v2（Unreleased）；安装资产与版本以 Release 实际内容为准。

## 下载与安装

仅浏览器使用下载扩展包；需要本机网关或离线开发时下载 portable 完整源码包，或克隆本仓库。

从 [Releases](https://github.com/ray-oriental/duallens/releases) 下载 `duallens-extension-v0.1.0.zip`，解压后：

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的解压目录。
3. 从源码安装时，选择本仓库的 `extension/` 目录。无需 npm install 或构建。
4. 打开扩展设置，按首次使用向导添加并配置模型。新安装未选服务，不会自动联网或借用本机账户与校园服务。
5. 打开普通网页，点击扩展按钮「翻译页面」。

扩展固定 ID 为 `noodgdnebcnfkgipoabjjlgaebocgnkj`。manifest 的 key 是公开身份信息，无私钥。当前没有上架扩展商店；不支持 Firefox / Safari。

### Edge 商店与 Android Edge + Tampermonkey

审核通过后可用：从 Microsoft Edge Add-ons 安装商店版。审核通过前，请使用 Release 中的 `duallens-edge-store-v<version>.zip` 解压后加载，或使用开发者模式安装。

Android 手机与平板：

1. 在 Edge 的「扩展」目录安装并启用 Tampermonkey，入口随 Edge 版本可能变化；也可参考 [Tampermonkey 官方 Edge 安装页](https://www.tampermonkey.net/index.php?browser=edge)。
2. 打开 [最新 Release 的 duallens.user.js](https://github.com/ray-oriental/duallens/releases/latest/download/duallens.user.js)，确认 Tampermonkey 安装提示，启用脚本。若对应 Release 尚未包含该资产，可从源码运行 `node scripts/build_userscript.mjs` 后安装 `dist/duallens.user.js`。
3. 打开普通网页，从 Tampermonkey 的脚本菜单点「DualLens 设置」，或从悬浮球菜单打开设置。按下方 OpenRouter 示例配置，保存后点悬浮球翻译页面。
4. 长按段落 500ms 翻译；移动手指或滚动会取消长按。划词按钮位于选区下方。输入法不方便打三连空格时，用悬浮球菜单的「翻译当前输入框」。
5. 手机、平板与两台电脑之间，用带口令的加密配置导出/导入迁移服务和 key。GM 存储不会自动跟随桌面扩展同步；真机验收步骤见 [移动端清单](tests/e2e/MOBILE_ACCEPTANCE.md)。

Android Chrome 当前没有本项目可安装的扩展或用户脚本版本。书签脚本是 P1 计划，尚未交付；使用移动版请打开 Android Edge。桌面 Tampermonkey 也可安装同一用户脚本，避免与 DualLens 扩展在同一网页同时启用。

## 功能

- 段落级双语对照、仅译文和恢复原文；保留链接、加粗和行内代码。
- 视口懒翻译、动态内容、SPA 页面；翻译缓存、模型限流与备用模型冷却。
- Shift + 悬停、划词翻译、输入框三连空格翻译、悬浮球。
- 15 种译文样式、术语表、提示词预设、总是／从不翻译站点规则。
- `Alt+A` 翻译／恢复，`Alt+W` 双语／仅译文，`Alt+I` 翻译当前输入框。若有快捷键冲突，在浏览器扩展快捷键页调整。

## 选择模型

### 首选示例：OpenRouter 免费模型

1. 打开设置，在服务预设中选择「OpenRouter」并添加配置。地址预填 `https://openrouter.ai/api/v1`。
2. 在 [OpenRouter](https://openrouter.ai/keys) 获取你自己的 API key。扩展设置页使用密钥框；用户脚本点击「设置 key」，在浏览器原生对话框中输入。
3. 手动点击「获取模型」：列表只选输入、输出价格都为 0 的模型，优先支持 JSON mode 的候选；可调整推荐的 2–3 个不同厂商免费模型组成的链。
4. 点击「测试连接」，确认返回测试译文后「保存设置」。获取列表和测试是由你主动发起的网络请求；未保存的 key 只是临时草稿。

免费模型的名称、可用性及限额会变化，以 [OpenRouter 限额说明](https://openrouter.ai/docs/api/reference/limits) 为准。备选链帮助应对单个模型不可用，不能绕过账号的分钟/每日额度；也不能保证免费模型的翻译质量。

### 其他服务与自定义接口

可添加 DeepSeek、硅基流动、智谱、月之暗面、OpenAI、Google Gemini、Groq、交大、Ollama 或自定义预设。填写你有权使用的服务的 base URL（通常以 `/v1` 结尾）、模型名和 API key。交大预设直接使用你自己的 key，不依赖本机中转。接口需支持非流式 `/chat/completions` 和纯文本 messages。不支持 JSON mode 的端点可关闭该选项；400 格式错误也会去掉格式参数重试一次。备选链可跨服务配置。

扩展 API key 只保存在当前浏览器的 `chrome.storage.local`；用户脚本只保存在 Tampermonkey 的 GM 私有存储。非机密扩展配置使用 `chrome.storage.sync`，超限时整组回退本机并显示「此设备未同步」。明文导出不含 key；只有主动填写口令的加密导出包含 key，可在设备之间搬配置。用户脚本只显示 key 的已设置/未设置状态及设置、清除按钮；key 与备份口令均在原生对话框中输入，默认不回填旧值，取消保留原值，密钥修改点击保存后生效。网页文本将发送给你选择的服务；在私密页面使用前应明确该服务的数据处理方式。

### 本机网关与 Ollama（桌面端可选）

直连模型服务无需启动 Python、Ollama 或任何本机进程。手机上的 `127.0.0.1` 指向手机自己，不能用作桌面电脑网关地址。

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
python -B -m unittest discover -s scripts -p "test_*.py"
python -B scripts/check_project.py
python -B scripts/build_release.py
```

Node.js 24、Python 3.12 是 CI 验证版本；浏览器 E2E 的独立安装说明见 [tests/e2e/README.md](tests/e2e/README.md)。

## 限制与许可证

当前仅顶层网页；复杂真实站点还需要逐站验证。本机小模型可能漏翻或给出低质量译文。原子图片按页面元素克隆，可能再次请求原资源。浏览器内部页面不能注入扩展。

源码和原创图标采用 [MIT](LICENSE)。不包含参考扩展的发布包、源码、默认规则表或品牌素材。安全报告方式见 [SECURITY.md](SECURITY.md)。
