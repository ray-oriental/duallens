# 使用 DualLens

DualLens 使用你选择的服务。默认 Microsoft 免费非官方机器翻译，失败时可转 Google；服务会收到待译文字，也可能限流或失效。可关闭备选、选择官方带 key 的服务，或配置自己的 OpenAI 兼容模型。安装和打开设置不发翻译请求。

## 电脑 Chrome / Edge

1. 从 [Release](https://github.com/ray-oriental/duallens/releases) 下载扩展 ZIP，解压到独立目录。
2. 打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式，加载含 `manifest.json` 的目录。源码安装选择 `extension/`，无需构建。
3. 打开普通网页，从工具栏弹出页点击翻译，或使用 `Alt+A`、右键「翻译此页 / 显示原文」。浏览器内部页面不能注入。
4. 悬浮球、被动划词、悬停、输入框和漫画 OCR 默认关闭，需要时在设置中显式开启。右键「翻译选中文字」始终可用。

商店审核与发布状态以商店页面为准，商店安装和源码加载可能使用不同扩展 ID。

## Android Edge + Tampermonkey

1. 在支持 Tampermonkey 的 Android Edge 版本中安装并启用它，确认脚本运行在管理器隔离上下文。
2. 打开 [用户脚本安装链接](https://github.com/ray-oriental/duallens/releases/latest/download/duallens.user.js)，确认安装。版本固定的设置资源由管理器在安装时缓存，打开时本地校验。
3. 从 Tampermonkey 菜单选择「翻译 / 恢复当前页面」或打开设置。默认不会显示悬浮球和划词按钮。
4. 按需开启触摸交互。开启 hover 后可长按段落 500ms，滚动或移动手指取消；划词按钮在选区下方。输入框翻译也需显式开启。

手机和平板使用同一脚本。桌面 GM 桩与设备模拟不能代替真机验收，见[移动清单](../tests/e2e/MOBILE_ACCEPTANCE.md)。Android Chrome 书签脚本仍为计划项，本项目没有可安装的 Android Chrome 版本。避免同页同时启用扩展与用户脚本。

## 配置自己的模型

选择 OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio 或自定义预设，填写地址、模型和自己的 API key，手动获取模型、测试连接后保存。OpenRouter 免费发现仅列出输入输出标价均为零的候选；限额和可用性由服务商决定。可配置跨服务备选链。

本地预设为 `http://localhost:11434/v1`（Ollama）和 `http://localhost:1234/v1`（LM Studio），需自行启动服务。Ollama 需配置 `OLLAMA_ORIGINS` 允许具体扩展来源，例如 `setx OLLAMA_ORIGINS "chrome-extension://<扩展 ID>"`；扩展 ID 从浏览器扩展详情页获取，勿使用所有扩展的通配来源。localhost 指当前设备，手机不能通过它访问电脑；其它设备须填可访问地址。远程带密钥接口使用 HTTPS，URL 中不能包含凭据。

API key 仅存设备本地，不进公共设置同步。用户脚本用浏览器原生对话框输入 key，网页表单不显示已存 key。网络翻译仅在用户主动操作或显式配置的自动规则触发时发生。

## 在设备间迁移配置

1. 在来源设备设置备份口令并加密导出，可复制加密文本或保存文件；扩展还可显示二维码。
2. 在目标设备导入并输入同一口令，确认服务地址在该设备可访问。
3. 口令通过另一条安全渠道传递，不保存到公开文件。加密备份包含 key，应按密钥保管；明文导出不含 key。

Chrome 公共设置同步不含 key，GM 存储不会自动跟随扩展或其它设备同步。旧版配置升级 settings v3 时保留服务 id、地址、模型与秘密槽，将旧兼容类型转为 OpenAI，并仅一次关闭默认增强功能；之后可重新开启。
