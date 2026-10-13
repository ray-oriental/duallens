# 权限说明 / Permission rationale

提交时请按最终商店包中的 `manifest.json` 逐项核对。当前包（含桌面 PDF P1）的权限用途如下：

- `storage`：保存用户选择的服务设置、本机密钥与翻译缓存；密钥不进入同步区域。
- `unlimitedStorage`：为较长网页的本机翻译缓存提供额外本地容量；不用于上传数据。
- `activeTab`：只对用户当前明确操作的标签页执行即时翻译。
- `contextMenus`：提供用户主动选择的“翻译此页/选中文本”及“用 DualLens 打开此 PDF”菜单入口；PDF 类型只在点击后判断。
- `commands`：提供可选的翻译、双语、恢复和输入框快捷键。
- `scripting`：按用户设置的漫画站点名单动态注册 `world: MAIN`、`document_start` 的原创 canvas 来源记录脚本；默认只有 `*.pixiv.net`，不在所有网站改写画布 API。名单增删后刷新生效。
- `offscreen`：按需创建本地图片解码与 OCR 文档；不用于后台浏览或图片上传。
- CSP `wasm-unsafe-eval`：允许打包的 Tesseract WASM 进行本地识别，以及 PDF.js 本地图像解码；扩展脚本和 Worker 来源仍限于 `self`，不从 CDN 执行代码。
- `<all_urls>`：支持任意普通 HTTP/HTTPS 网页翻译、匿名图片下载，以及用户主动打开的 PDF。PDF 类型探测只在 popup 打开或 PDF 右键项点击时进行：先检查 URL，必要时匿名 HEAD，失败再用 Range GET，仅取响应头并取消正文。PDF 字节在本机渲染，只有用户要求翻译的文本发往所选服务。本地 file:// PDF 还需用户在扩展详情页允许访问文件网址，或直接选择本地文件；不读取浏览器内部页面或账户数据。

PDF 不增加 `webRequest`、cookie、通知或 DNR 权限，不观察普通浏览响应，不自动接管 PDF。每次探测请求超时 5 秒，不跟随重定向、不带 cookie/认证；服务器忽略 Range 时仍立即取消响应体。

The store package should contain only permissions present in its final manifest. `storage` keeps preferences, local secrets and cache; `unlimitedStorage` also accommodates verified local OCR language data. `activeTab` limits immediate action to the user-operated tab; `contextMenus` adds user-invoked translation entries. `scripting` dynamically registers a MAIN/document_start canvas source hook only on opted-in comic domains (default `*.pixiv.net`), with changes effective after refresh. `offscreen` provides local image decoding and OCR. CSP `wasm-unsafe-eval` permits packaged local WASM; extension scripts/workers stay self-only. The `commands` section exposes optional shortcuts. `<all_urls>` permits ordinary page translation and anonymous image downloads; comic images are processed locally, only OCR text goes to the configured service, and no DNR or cookies permissions are added. Hash-verified fast language data comes from the pinned tessdata_fast URLs documented in COMICS.md and can be deleted on-device.

PDF uses these existing permissions only. Opening the popup or clicking its PDF context-menu entry checks the actual tab URL; an uncertain URL is probed with anonymous HEAD, then one Range GET if HEAD fails or lacks a Content-Type. Each request has a five-second timeout, rejects redirects and cancels the body after reading headers, even if the server ignores Range. There is no response observation, automatic PDF redirection, or additional webRequest/cookies/notifications/DNR permission. PDF bytes are rendered locally by packaged PDF.js; only requested text is sent to the user's selected translation service. File URLs require the browser's separate file-access opt-in; selecting a local PDF in the viewer is also supported.
