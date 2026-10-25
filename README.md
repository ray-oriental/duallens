# DualLens 双语对照翻译

[![CI](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml/badge.svg)](https://github.com/ray-oriental/duallens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

在每个段落下方显示译文的网页翻译工具。**需要时好用，不需要时不存在**：装好之后页面上不会出现任何东西，直到你主动触发。

开源（MIT）· 无账号 · 无遥测 · 没有开发者服务器 · 文字只发给你选择的翻译服务。

支持桌面 Chrome / Edge（Manifest V3 扩展）；Android Edge 用 Tampermonkey 用户脚本。独立实现，不是任何第三方翻译扩展的分支，与微软、谷歌没有隶属关系。

> 双语对照截图：发布前补充。

## 安装

| 方式 | 说明 |
| --- | --- |
| Chrome Web Store | 待上架，审核通过后补链接 |
| Microsoft Edge Add-ons | 待上架，审核通过后补链接 |
| 开发者模式（Chrome / Edge） | 到 [Releases](https://github.com/ray-oriental/duallens/releases) 下载 `duallens-extension-v<版本>.zip` 解压；或直接选择本仓库的 `extension/` 目录。打开 `chrome://extensions` 或 `edge://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」。无需 npm 或构建。 |
| Android Edge + Tampermonkey | 在 Edge 扩展目录安装 Tampermonkey，打开最新 Release 的 [`duallens.user.js`](https://github.com/ray-oriental/duallens/releases/latest/download/duallens.user.js) 并确认安装。步骤与真机清单见 [使用指南](docs/USAGE.md)。 |

商店版与"加载已解压"版的扩展 ID 不同，设置不会互通；Android Chrome 暂不支持。

用户脚本安装时请允许 Tampermonkey 缓存同版本的 `duallens-settings.js` 与 `duallens-features.js` 资源。
面板/设置、视频字幕及 OCR 实现按需读取本地缓存，校验后才运行；出现资源缺失或校验失败提示时，从官方 Release 重新安装即可。

## 三步上手

1. 点工具栏的 DualLens 图标。第一次会出现三步卡片：选目标语言、选翻译方式（并看到文字会发给谁）。
2. 点「翻译此页」，或按 `Alt+A`。尚未在上手或设置中确认去向时，页面角落会说明文字发往哪里，点「继续翻译」后才发送。
3. 想要更多？在弹出页的「更多功能」里按需打开：悬浮按钮、划词、悬停、输入框翻译、视频字幕、图片文字。**它们默认全部关闭**。

快捷键：`Alt+A` 翻译/显示原文 · `Alt+W` 双语/仅译文 · `Alt+I` 翻译输入框 · `Alt+S` 文本翻译侧栏（可在浏览器的扩展快捷键页修改）。

## 隐私承诺

- 没有账号、没有遥测、没有远程配置，也没有 DualLens 的服务器。
- 翻译时，文字由你的浏览器**直接**发给你选择的服务：默认是微软的免费机器翻译（失败时改用谷歌）；接入自己的 AI 服务后，文字和页面标题会发给它。网址、cookie、密码框不发送。
- 第一次向某个服务发送前先说明去向、由你确认；本机回环地址上的本地模型无需确认。
- API 密钥只存在这台设备，不同步、不进明文导出；译文缓存只在本机，可一键清除。
- 默认的免费机器翻译使用**非官方**接口，可能随时变动或失效；可改用官方带 key 的引擎、关闭备用，或只用 AI 服务。

完整说明：[隐私说明](docs/PRIVACY.md)。产品原则与默认状态：[产品说明](docs/PRODUCT.md)。

## 权限

| | 内容 |
| --- | --- |
| 安装时 | `activeTab`、`scripting`、`storage`、`contextMenus`、`sidePanel` 等基础权限，以及固定的翻译服务地址。**不**申请「所有网站」。 |
| 按需 | 只有当你打开必须在点击前就在页面里的功能（总是翻译规则、悬浮按钮、划词/悬停/输入框、图片文字…）时，才在你的操作中请求「所有网站」可选权限；拒绝则功能保持关闭，随时可撤销。 |
| 不会有 | `tabs`、`cookies`、`webRequest`、历史记录、剪贴板、通知。 |

每一项的用途见[权限说明](docs/store/permissions.md)。

## 接入你自己的 AI 服务（可选）

设置 → AI 服务 → 选一张卡片：

- **OpenRouter**（推荐）：粘贴自己的 key，点「获取模型」可只列出免费模型，并建议 2–3 家不同厂商的备选。免费模型的限额与可用性由服务商决定。
- **OpenAI / DeepSeek**：填入你自己的 key。
- **本地模型**：Ollama、LM Studio（需先启动服务；Ollama 需要设置 `OLLAMA_ORIGINS` 允许浏览器扩展访问，设置页有说明）。勾选「只用本地模型」且备用链仅有本机地址时，文字只发到你的电脑。
- **自定义**：任何 OpenAI 兼容接口，远程带密钥的接口请用 HTTPS。

云端服务默认「机翻先出，大模型精修」。添加本地模型时默认勾选「只用本地模型」，切为「只用 AI 服务」；请同时确认备用链仅含本机地址。换设备时，用带口令的**加密导出**迁移配置（含 key）；明文导出不含 key。

## 功能

| 功能 | 默认 |
| --- | --- |
| 段落级双语 / 仅译文 / 恢复原文，保留链接与行内格式 | 手动触发 |
| 站点规则（按需 / 总是 / 从不，可限定路径）、术语表、6 种译文样式 | 无规则 |
| 悬浮按钮、划词、悬停、输入框翻译 | 关 |
| 视频双语字幕（HTML5 字幕轨、YouTube）、本地 `.srt/.vtt` 导入导出 | 关 |
| 图片文字（本地 OCR：日 / 韩 / 英；首次需下载语言包） | 关 |
| PDF 并排对照阅读（本机 PDF.js 渲染） | 不接管 PDF |
| 文本翻译侧栏 | 手动 |
| 界面语言 | 简体中文（英文界面待后续发布） |

## 构建与测试

扩展是原生 ES 模块，零构建。离线检查不需要账号、密钥或模型服务（CI 使用 Node.js 24、Python 3.12）：

```sh
npm test
python -B -m unittest discover -s scripts -p "test_*.py"
python -B scripts/check_project.py
python -B scripts/build_release.py
python -B scripts/check_project.py --dist-dir dist
```

浏览器端到端测试见 [tests/e2e/README.md](tests/e2e/README.md)（使用 Mock 后端，不联网）。

## 参与贡献

欢迎提交可复现的问题和边界清晰的 PR：见 [贡献指南](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。版本记录见 [CHANGELOG](CHANGELOG.md)，后续方向见[路线图](docs/ROADMAP.md)。

## 许可证

源码与原创图标采用 [MIT](LICENSE)。第三方组件（PDF.js、Tesseract.js 等）随包发布，许可证随附在对应目录。

---

## English summary

**DualLens** shows a translation under each paragraph. It is quiet by default: nothing appears on a page until you click the toolbar button, press `Alt+A`, or use the context menu. Optional features (floating button, selection / hover / input-box translation, video captions, image text) are all off until you enable them.

- **Open source (MIT), no account, no telemetry, no developer servers.** Text goes straight from your browser to the service you choose — by default Microsoft's free, *unofficial* machine-translation endpoint (Google as fallback); with your own AI service configured, text and the page title go to it. Before text is first sent to a service, setup, Settings or the current tool explains the destination and asks for confirmation. Local models on loopback need no confirmation. API keys stay on the device.
- **Permissions on demand:** `activeTab` + fixed translation-service hosts at install; "all sites" is an *optional* permission requested only when you turn on a feature that has to be present before you click.
- **Install:** Chrome Web Store / Edge Add-ons (pending review) · developer mode from the Release ZIP or `extension/` · Android Edge + Tampermonkey userscript.
- **AI services:** OpenRouter (free models), OpenAI, DeepSeek, Ollama / LM Studio, or any OpenAI-compatible endpoint, with your own key.
- **Develop:** zero-build ES modules; `npm test`, `python -B scripts/check_project.py`, `python -B scripts/build_release.py`. See [CONTRIBUTING.md](CONTRIBUTING.md). Not affiliated with Microsoft, Google or any other translation vendor.
