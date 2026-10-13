# DualLens 隐私说明 / Privacy notice

## 中文

DualLens 不收集、不出售、不上传遥测数据，也不建立用户账户。网页文本只会发送到用户在设置中明确选择的模型服务；服务商如何处理这些文本由用户与该服务商的协议决定。API key 只保存在当前浏览器的本机存储中，不进入同步设置、发布包、日志或我们的服务器。翻译缓存和偏好也保存在用户设备上。

可选的本机网关只监听回环地址，并要求精确配置的扩展 Origin；它不会把本机服务公开到局域网或互联网。

PDF 在本机通过随包发布的 PDF.js 解析和渲染，PDF 字节不上传、不保存到我们的服务器。只有用户点击翻译后，附近段落文本才发送给用户选择的翻译服务；不向该服务发送 PDF 文件或其 URL。本地选择的文件只在阅读页内存处理。

PDF 类型只在用户打开 popup 或点击 PDF 右键菜单时按需判断。`.pdf` URL 无需探测；其他 HTTP(S) 地址先发匿名 HEAD，失败或缺少 Content-Type 时再发一次 `Range: bytes=0-1023` GET。每次请求超时 5 秒，不跟随重定向、不带 cookie/认证；读取响应头后取消正文，即使服务器忽略 Range 也不读取完整文档。探测不保留 URL/结果缓存，不观察普通网页响应或访问历史。PDF 下载由用户明确打开阅读页触发，同样不带 cookie/认证；需要登录的文档由用户先下载后选择本地文件。

漫画翻译由用户触发：原图匿名下载后仅在设备本地解码和 OCR；只将识别出的文字发送给用户配置的翻译服务，不上传图片、图片 URL、页面 URL 或 cookie，不保存原图。canvas 来源记录钩子只在用户设置的漫画站点名单运行，默认 `*.pixiv.net`；增删后刷新生效。

日/韩/英 fast 语言包来自 tesseract-ocr/tessdata_fast 固定 commit `87416418657359cb625c412a48b6e1d6d41c29bd`，下载并校验 SHA-256 后存于扩展 IndexedDB 或用户脚本私有 GM 存储，可在漫画设置中查看大小及删除。扩展 OCR 代码和 WASM 随包发布；用户脚本使用固定版本 Tesseract 5.1.1 的 jsDelivr `@resource`，仅触发 OCR 后读取、校验并运行。资源 API 不支持时，匿名下载同一固定 URL 并校验、缓存于 GM 私有存储。Tampermonkey 可在安装/更新时预取资源，但普通网页启动不解析 OCR 代码；不使用网页的存储保存这些数据。

## English

DualLens does not collect, sell, or upload telemetry and does not require an account. Webpage text is sent only to the model service explicitly selected by the user; that provider's handling is governed by the user's agreement with the provider. API keys remain in this browser's local storage and are not placed in sync settings, release packages, logs, or our servers. Translation cache and preferences remain on the user's device.

The optional local gateway listens only on a loopback address and requires an exact, explicitly configured extension Origin. It does not expose the local service to the LAN or the public Internet.

PDF files are parsed and rendered on-device using packaged PDF.js. Their bytes are not uploaded or stored on our servers. Only nearby paragraph text explicitly requested for translation is sent to the user's selected provider; the PDF file and its URL are not sent to that provider. Selected local files are processed in the viewer's memory.

PDF type detection runs only when the user opens the popup or clicks the PDF context menu. A .pdf URL needs no probe. Other HTTP(S) URLs receive one anonymous HEAD, followed by one `Range: bytes=0-1023` GET if HEAD fails or has no Content-Type. Each request has a five-second timeout, rejects redirects, omits cookies/authentication and cancels its body after reading headers, even when the server ignores Range. Probe URLs/results are not cached; ordinary browsing responses and history are not observed. Downloading PDF bytes requires an explicit viewer action and also omits cookies/authentication. Users can download authenticated documents themselves and select the local file.

User-triggered comic translation downloads images anonymously and performs decoding/OCR locally. Only recognized text is sent to the configured translator; images, image/page URLs and cookies are not uploaded, and originals are not persisted. Canvas source hooks run only on opted-in domains (default `*.pixiv.net`); changes take effect after refresh.

Fast Japanese/Korean/English language data is pinned to tessdata_fast commit `87416418657359cb625c412a48b6e1d6d41c29bd`, checked with SHA-256, and stored in extension IndexedDB or private GM storage with size/delete controls. Extensions package their OCR code/WASM. Userscripts read integrity-pinned jsDelivr Tesseract 5.1.1 resources only after OCR is requested; unsupported resource APIs fall back to anonymous, hash-verified downloads and private GM caching. Tampermonkey may prefetch resources at install/update time. Ordinary page startup does not parse OCR code, and webpage storage is not used.
