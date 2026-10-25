# Changelog

## [Unreleased]

- 页面内输入框、划词、悬停翻译与原位重试仅接受真实用户输入，忽略网页脚本伪造的触发事件。

## [1.0.0] - 2026-10-22

- Redesigned, quiet interface (monochrome, no boxed cards) in English and Simplified Chinese.
- Quiet defaults, device-local destination confirmation, on-demand permissions and bilingual settings.
- Page, selection, input, hover, PDF, subtitle and local image-text translation with configurable AI services.
- Separate extension/store and Android userscript distributions with reproducible offline checks.
- Custom AI services: a root base URL that serves a webpage is completed to `/v1` after a probe; clearer errors for webpages, unparseable replies, auth and 404; every settings action shows a busy state and a timestamped result.

## Earlier versions

Early releases developed paragraph translation and exact restoration, formatting preservation, provider configuration, machine-translation drafts and AI refinement, PDF translation, local OCR, captions, frame support and portable settings. These features now form the current universal browser translation product.
