# 权限说明 / Permission rationale

提交时请按最终商店包中的 `manifest.json` 逐项核对。当前包（含桌面 PDF P1）的权限用途如下：

- `storage`：保存用户选择的服务设置、本机密钥与翻译缓存；密钥不进入同步区域。
- `unlimitedStorage`：为较长网页的本机翻译缓存提供额外本地容量；不用于上传数据。
- `activeTab`：只对用户当前明确操作的标签页执行即时翻译。
- `contextMenus`：提供用户主动选择的“翻译此页/选中文本”及“用 DualLens 打开此 PDF”菜单入口；PDF 类型只在点击后判断。
- `commands`：提供可选的翻译、双语、恢复和输入框快捷键。
- `scripting`：按用户设置的漫画站点名单动态注册 `world: MAIN`、`document_start` 的原创 canvas 来源记录脚本；默认只有 `*.pixiv.net`，不在所有网站改写画布 API。名单增删后刷新生效。
- `declarativeNetRequestWithHostAccess`：只为本扩展发起的漫画 CDN 取图请求设置公开根地址 Referer；规则限定扩展 ID 与 `xmlhttprequest/other`，网页请求不受影响，关闭漫画或移除名单即撤销，不新增 host 权限。
- `offscreen`：按需创建本地图片解码与 OCR 文档；不用于后台浏览或图片上传。
- CSP `wasm-unsafe-eval`：允许打包的 Tesseract WASM 进行本地识别，以及 PDF.js 本地图像解码；扩展脚本和 Worker 来源仍限于 `self`，不从 CDN 执行代码。
- `<all_urls>`：支持任意普通 HTTP/HTTPS 网页翻译、匿名图片下载，以及用户主动打开的 PDF。PDF 类型探测只在 popup 打开或 PDF 右键项点击时进行：先检查 URL，必要时匿名 HEAD，失败再用 Range GET，仅取响应头并取消正文。PDF 字节在本机渲染，只有用户要求翻译的文本发往所选服务。本地 file:// PDF 还需用户在扩展详情页允许访问文件网址，或直接选择本地文件；不读取浏览器内部页面或账户数据。

PDF 不增加 `webRequest`、cookie、通知或 DNR 权限，不观察普通浏览响应，不自动接管 PDF。每次探测请求超时 5 秒，不跟随重定向、不带 cookie/认证；服务器忽略 Range 时仍立即取消响应体。

v0.4 MT 复用现有 `<all_urls>` 网络权限，不新增权限。翻译动作将文字发送给默认 Microsoft 免费非官方接口（Edge 批量端点；必要时尝试短期 token）或备选 Google 批量端点；它们可能限流或失效。官方 Azure/DeepL 仅用用户本机 key。请求不带 cookie，不发网页 URL、标题或 HTML 属性；设置支持关闭 MT 备用、更换服务或只用 LLM。打开设置不发翻译请求。

v0.4 MT reuses existing host access without new permissions. Translation actions send text to default free unofficial Microsoft/Google endpoints or user-selected official Azure/DeepL services. These requests omit cookies and page URLs, titles and HTML attributes. Users can disable MT fallback, change services or choose LLM-only mode; opening settings makes no translation request. Free endpoints can throttle, change or fail without notice.

The store package should contain only permissions present in its final manifest. `storage` keeps preferences, local secrets and cache; `unlimitedStorage` also accommodates verified local OCR language data. `activeTab` limits immediate action to the user-operated tab; `contextMenus` adds user-invoked translation entries. `scripting` dynamically registers a MAIN/document_start canvas source hook only on opted-in comic domains (default `*.pixiv.net`), with changes effective after refresh. `offscreen` provides local image decoding and OCR. CSP `wasm-unsafe-eval` permits packaged local WASM; extension scripts/workers stay self-only. The `commands` section exposes optional shortcuts. `<all_urls>` permits ordinary page translation and anonymous image downloads; comic images are processed locally, only OCR text goes to the configured service, and no cookies permission is added. `declarativeNetRequestWithHostAccess` sets a public root Referer only for extension-initiated XHR/other requests to opted-in comic CDNs; disabling comics or deleting a site removes its session rules, without additional host access or changes to website requests. Hash-verified fast language data comes from the pinned tessdata_fast URLs documented in COMICS.md and can be deleted on-device.

PDF uses these existing permissions only. Opening the popup or clicking its PDF context-menu entry checks the actual tab URL; an uncertain URL is probed with anonymous HEAD, then one Range GET if HEAD fails or lacks a Content-Type. Each request has a five-second timeout, rejects redirects and cancels the body after reading headers, even if the server ignores Range. There is no response observation, automatic PDF redirection, or additional webRequest/cookies/notifications/DNR permission. PDF bytes are rendered locally by packaged PDF.js; only requested text is sent to the user's selected translation service. File URLs require the browser's separate file-access opt-in; selecting a local PDF in the viewer is also supported.
