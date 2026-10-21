# DualLens 隐私说明 / Privacy notice

## 中文

默认不授予所有网站的读取 / 更改权限，也不静态注入网页脚本。工具栏、快捷键和右键操作使用 `activeTab` 临时授权当前页面；开启常驻控件、图片文字、跨域 iframe 或自动规则时，才在用户操作中请求可选网站权限。固定主机只覆盖内置翻译服务；自定义接口和本地模型按具体来源授权。拒绝授权时功能保持关闭。撤销广泛权限后，后台保存关闭相关开关和自动规则、取消常驻注册，并在本机保存待提示的字段名，不保存浏览历史。已运行脚本无法卸载，但被动 UI 会随设置关闭，新页面不再自动注入。逐项用途与文件 / 字幕 / 图片来源授权时机见 [权限说明](store/permissions.md)。

DualLens 不收集、不出售、不上传遥测数据，也不建立用户账户。v0.4 默认「机翻先出，大模型精修」：用户触发翻译后，未命中缓存的文字会发往默认 Microsoft 免费非官方机器翻译接口，失败可转往 Google 免费非官方接口；配置了大模型时还会发送给该模型服务。没有模型 key 时只用机器翻译。免费接口可能变动或失效，没有可用性保证。设置可更换引擎、关闭 MT 备用，或选择「只用大模型」以完全禁用 MT 传输；官方 Microsoft Translator / DeepL key 为可选。安装、打开设置本身不发送翻译请求，用户保存的自动翻译规则仍可触发请求。

MT 只收到待翻译文字、占位符和语言，不收到页面 HTML 属性、URL、标题或 cookie；这些占位符并非原网页 HTML。服务商如何处理文字由用户与服务商的协议决定。API key（包括官方 MT key）只保存在当前浏览器的本机 secrets 中，不进入同步设置、发布包、日志或我们的服务器。用户明确选择带口令的加密导出时可以携带 key，明文导出始终不含 key。翻译缓存和偏好也保存在用户设备上。


PDF 在本机通过随包发布的 PDF.js 解析和渲染，PDF 字节不上传、不保存到我们的服务器。只有用户点击翻译后，附近段落文本才发送给用户选择的翻译服务；不向该服务发送 PDF 文件或其 URL。本地选择的文件只在阅读页内存处理。

PDF 类型只在用户打开 popup 或明确打开 PDF 时按需判断；缺少来源权限时先返回授权提示，不进行网络探测。`.pdf` URL 无需探测；其他 HTTP(S) 地址先发匿名 HEAD，失败或缺少 Content-Type 时再发一次 `Range: bytes=0-1023` GET。每次请求超时 5 秒，不跟随重定向、不带 cookie/认证；读取响应头后取消正文，即使服务器忽略 Range 也不读取完整文档。探测不保留 URL/结果缓存，不观察普通网页响应或访问历史。PDF 下载由用户明确打开阅读页触发，同样不带 cookie/认证；需要登录的文档由用户先下载后选择本地文件。

漫画翻译由用户触发：原图匿名下载后仅在设备本地解码和 OCR；只将识别出的文字发送给用户配置的翻译服务，不上传图片、图片 URL、页面 URL 或 cookie，不保存原图。canvas 来源记录钩子只在用户设置的漫画站点名单运行，默认 `*.pixiv.net`；增删后刷新生效。

日/韩/英 fast 语言包来自 tesseract-ocr/tessdata_fast 固定 commit `87416418657359cb625c412a48b6e1d6d41c29bd`，下载并校验 SHA-256 后存于扩展 IndexedDB 或用户脚本私有 GM 存储，可在漫画设置中查看大小及删除。扩展 OCR 代码和 WASM 随包发布；用户脚本使用固定版本 Tesseract 5.1.1 的 jsDelivr `@resource`，仅触发 OCR 后读取、校验并运行。资源 API 不支持时，匿名下载同一固定 URL 并校验、缓存于 GM 私有存储。Tampermonkey 可在安装/更新时预取资源，但普通网页启动不解析 OCR 代码；不使用网页的存储保存这些数据。

漫画 CDN 防盗链兼容只设置公开站点根地址 Referer。扩展会话规则限定本扩展 ID 与 XHR/other，网页请求不受影响，关闭漫画或移出名单即撤销。用户脚本匿名 GM 请求只在站点与 CDN 匹配时带同一 Referer，不带 cookie、凭据或私密页面路径。

## English

All-site read/change access is optional and no static content scripts are declared. Explicit toolbar, shortcut and context-menu actions use temporary activeTab access. Passive features and automatic rules request website permissions only in the user's enabling action; denial keeps them disabled. Required hosts cover built-in translation services; custom/local APIs request specific origins. Revocation unregisters resident scripts, saves dependent switches/rules as off, and stores only affected field names locally for a later UI notice, not browsing history. Already-running scripts cannot be unloaded, but their passive UI follows settings; new documents receive no automatic injection. See [permission rationale](store/permissions.md) for individual uses and PDF/caption/image source access.

DualLens does not collect, sell, or upload telemetry and does not require an account. The v0.4 default shows machine translation first, then optionally refines it with a configured LLM. On a translation action, uncached text goes to Microsoft's free unofficial translation endpoint, with Google's free unofficial endpoint as fallback, and to the configured LLM when available. Without an LLM key, only machine translation runs. These free endpoints can change or fail without a service guarantee. Settings can change engines, disable MT fallback, or select LLM-only mode to disable MT transmission entirely. Official Microsoft Translator/DeepL keys are optional. Installation and opening settings do not send translation requests; user-saved automatic translation rules can trigger requests.

MT receives text, placeholder tags and languages, without page HTML attributes, URLs, titles or cookies; placeholders are not the original webpage HTML. Provider handling is governed by the user's agreement with that provider. API keys, including official MT keys, remain in local secrets, outside sync settings, release packages, logs and our servers. User-requested password-encrypted exports may include keys; plaintext exports never do. Translation cache and preferences remain on the user's device.


PDF files are parsed and rendered on-device using packaged PDF.js. Their bytes are not uploaded or stored on our servers. Only nearby paragraph text explicitly requested for translation is sent to the user's selected provider; the PDF file and its URL are not sent to that provider. Selected local files are processed in the viewer's memory.

PDF type detection runs only when the user opens the popup or explicitly opens a PDF; missing source access returns a permission hint without a network probe. A .pdf URL needs no probe. Other HTTP(S) URLs receive one anonymous HEAD, followed by one `Range: bytes=0-1023` GET if HEAD fails or has no Content-Type. Each request has a five-second timeout, rejects redirects, omits cookies/authentication and cancels its body after reading headers, even when the server ignores Range. Probe URLs/results are not cached; ordinary browsing responses and history are not observed. Downloading PDF bytes requires an explicit viewer action and also omits cookies/authentication. Users can download authenticated documents themselves and select the local file.

User-triggered comic translation downloads images anonymously and performs decoding/OCR locally. Only recognized text is sent to the configured translator; images, image/page URLs and cookies are not uploaded, and originals are not persisted. Canvas source hooks run only on opted-in domains (default `*.pixiv.net`); changes take effect after refresh.

Fast Japanese/Korean/English language data is pinned to tessdata_fast commit `87416418657359cb625c412a48b6e1d6d41c29bd`, checked with SHA-256, and stored in extension IndexedDB or private GM storage with size/delete controls. Extensions package their OCR code/WASM. Userscripts read integrity-pinned jsDelivr Tesseract 5.1.1 resources only after OCR is requested; unsupported resource APIs fall back to anonymous, hash-verified downloads and private GM caching. Tampermonkey may prefetch resources at install/update time. Ordinary page startup does not parse OCR code, and webpage storage is not used.

Comic CDN compatibility sets only a public site-root Referer. Extension session rules match this extension ID and XHR/other requests only, leave website requests untouched, and are removed on disabling comics or deleting the site. Anonymous userscript GM requests use the same header only for matching comic sites and CDNs, without cookies, credentials or private page paths.
