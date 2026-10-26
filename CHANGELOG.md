# Changelog

## [Unreleased]

- PDF 一次性交接缓存在后台初始化、浏览器启动、扩展安装／更新及读写时清理过期副本；明确区分五分钟逻辑过期与物理删除时机，不新增权限。
- PDF 阅读器支持在本机导出双栏对照或仅译文 PDF，包含范围选择、逐页翻译进度和取消；导出件为图像版式。
- 扫描 PDF 可显式开启本机 OCR，复用经大小与 SHA-256 校验的语言包；低置信度文字保留原像素，识别分块仅存阅读会话。
- 页面内输入框、划词、悬停翻译与原位重试仅接受真实用户输入，忽略网页脚本伪造的触发事件。
- PDF 阅读器改用 v1.0 单色界面：共用令牌与控件，去掉蓝色按钮、彩色图标与投影；导出与 OCR 面板改为设置页同款字段，进度为纯文字。

## [1.0.0] - 2026-10-22

- Redesigned, quiet interface (monochrome, no boxed cards) in English and Simplified Chinese.
- Quiet defaults, device-local destination confirmation, on-demand permissions and bilingual settings.
- Page, selection, input, hover, PDF, subtitle and local image-text translation with configurable AI services.
- Separate extension/store and Android userscript distributions with reproducible offline checks.
- Custom AI services: a root base URL that serves a webpage is completed to `/v1` after a probe; clearer errors for webpages, unparseable replies, auth and 404; every settings action shows a busy state and a timestamped result.

## Earlier versions

Early releases developed paragraph translation and exact restoration, formatting preservation, provider configuration, machine-translation drafts and AI refinement, PDF translation, local OCR, captions, frame support and portable settings. These features now form the current universal browser translation product.
