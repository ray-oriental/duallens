# 权限说明 / Permission rationale

## 中文

默认安装不申请所有网站的读取和更改权限，没有静态 `content_scripts`。工具栏、快捷键、右键操作使用 `activeTab` 临时访问当前页面，再由 `scripting` 注入；浏览器内部页、扩展商店及原生 PDF 查看器不能注入。临时权限由浏览器管理，跨来源导航或关闭标签页后失效。

- `storage`：保存偏好、机密和缓存。偏好可使用浏览器同步；API key 只存本机，明文导出不含 key。
- `unlimitedStorage`：本机翻译缓存与校验后的 OCR 语言包可能超过普通配额；这些数据不上传，可在设置中清除。此权限不授予文件系统访问。
- `activeTab`：明确调用工具栏、快捷键或右键菜单时临时访问当前标签页，支持手动翻译与恢复。
- `scripting`：按需注入幂等 loader、按用户授权动态注册常驻脚本；YouTube 轨道观察器及名单内漫画 canvas 来源记录器使用随包发布的原创 MAIN 脚本。全部关闭时取消注册。
- `contextMenus`：提供翻译此页 / 显示原文、选中文字、视频字幕，以及开启图片文字后的图片入口。当前版本没有 PDF 右键菜单。
- `sidePanel`：用户通过 Alt+S 或侧栏入口打开独立文本翻译工具。
- `offscreen`：仅在用户请求图片文字或 PDF 扫描页 OCR 时创建扩展文档进行图像解码和 Worker 识别，不上传图像；缺少语言包时先确认体积和来源，再按需申请下载来源权限。不新增权限。
- `declarativeNetRequestWithHostAccess`：仅在已拥有目标 CDN 主机权限时，为本扩展 ID 发起的 `xmlhttprequest` / `other` 请求设置漫画站点公开根地址 Referer。规则不匹配网页请求；关闭图片文字、删除站点或撤销主机权限后移除相应会话规则。

必需主机仅为 `edge.microsoft.com`、`api-edge.cognitive.microsofttranslator.com`、`clients5.google.com`，用于默认免费非官方机翻。官方 Microsoft/DeepL 及 AI 服务均使用可选来源权限，保存或测试时按需申请。

`optional_host_permissions: ["<all_urls>"]` 仅声明可申请范围，默认没有授予。开启悬浮按钮、划词、悬停、输入框、跨 frame、视频字幕、图片文字等常驻功能或「总是翻译」规则时，UI 必须在用户手势中请求广泛权限；拒绝则不保存开启状态。字幕自动开启和按语言自动翻译同样依赖常驻注入。自定义 AI 和本地模型在保存 / 测试配置前按具体来源请求权限，无需申请所有网站。Chrome 匹配模式按主机授权，不把端口视为隔离边界。

| 操作 | 没有广泛权限 | 授权并开启所需功能 |
| --- | --- | --- |
| 手动网页 / 选区 / 输入框 | activeTab 顶层按需注入；同源 iframe 由顶层控制器处理 | 同样可用 |
| 常驻控件 / 自动规则 | 先在 UI 请求广泛权限 | 后续新文档动态注入；当前页由 UI 调用 `tab-ensure` |
| 跨域 iframe | 不注入 | 常驻脚本使用现有无 UI frame agent |
| YouTube 字幕 | 当前来源匿名读轨道；跨 www/m 来源先授权轨道来源 | 自动字幕启用时注册 document_start 观察器 |
| 漫画 / canvas / CDN | 开启图片文字时请求广泛权限；单来源授权须包含图片 CDN | 本地 OCR；canvas 与 Referer 规则仍检查对应主机 |
| PDF | 弹出页点击时，后台借 activeTab 匿名取回并以一次性令牌交给阅读器；其他来源在阅读器按钮手势申请来源权限，或选择本地文件 | 已授予来源可匿名读取；登录 / 重定向文件先自行下载 |

权限撤销后，后台取消常驻注册并保存关闭相关开关、自动语言与自动规则，保留「从不」规则及其他偏好。本机 `ui.permissionsRevoked` 保存受影响字段列表，供下次 popup 说明；不会自动重新申请。浏览器不能卸载已运行脚本；已有控制器通过设置变化关闭被动 UI，新文档不再自动注入。

`commands` 是快捷键声明，不是额外权限。没有 `tabs`、`cookies`、`webRequest`、通知、历史记录或剪贴板权限。`web_accessible_resources` 明确列举内容模块依赖与 CSS，不公开 UI、后台、密钥、模型或 vendor 目录。CSP `wasm-unsafe-eval` 用于打包的本地 OCR / PDF WASM；脚本与 Worker 仍限 `self`。

## English

Installation does not request access to all websites and declares no static content scripts. Explicit toolbar, shortcut and context-menu actions use temporary `activeTab` access and idempotent `scripting` injection. Restricted browser/store pages and the native PDF viewer cannot be injected. Temporary access ends after cross-origin navigation or tab closure.

- `storage`: preferences, local secrets and cache; keys stay outside sync and plaintext exports.
- `unlimitedStorage`: verified local OCR language data and translation cache can exceed ordinary quotas; users can delete them. This does not grant filesystem access.
- `activeTab`: temporary access to the explicitly operated tab for manual translation and restoration.
- `scripting`: on-demand injection, permission-gated resident registration, and packaged original MAIN-world YouTube/canvas hooks.
- `contextMenus`: explicit page, selection and video actions; an image action only when image text is enabled. There is currently no PDF menu item.
- `sidePanel`: user-opened text translation via Alt+S or the browser sidebar.
- `offscreen`: local image decoding and OCR Workers only after an explicit image-text or scanned-PDF OCR request. Missing language data discloses size/source and requests the download origin after confirmation. No additional permissions are introduced.
- `declarativeNetRequestWithHostAccess`: host-gated session rules set a public site-root Referer only for this extension's XHR/other requests to selected comic CDNs. Website requests are unaffected; disabling comics, deleting a site or losing host permission removes the rules.

Required HTTPS hosts are limited to `edge.microsoft.com`, `api-edge.cognitive.microsofttranslator.com` and `clients5.google.com`. They serve free unofficial Microsoft/Google translation. Official Microsoft/DeepL and all AI provider hosts are optional and requested when saving or testing the service. Unofficial services may change or fail.

Optional `<all_urls>` is a requestable scope, not an installation grant. UI must request it in the user's switch/rule gesture before enabling passive features or automatic translation; denial keeps them disabled. Automatic subtitles and language rules also need resident injection. Custom/local API configurations request their specific origin before testing or saving. Host patterns do not isolate ports.

Without broad access, manual actions inject only the top document, whose controller handles same-origin frames. Resident registration covers cross-origin frames only after broad access and a passive feature/rule opt-in. Same-origin YouTube captions use anonymous page fetch; cross-www/m tracks require the track host's permission. Comic CDNs/canvas hooks each need corresponding host grants. PDF toolbar clicks capture bytes in the background using activeTab and pass a one-use extension-local token to the reader. Other reader sources request missing origin access in a button gesture; local selection is also available, and file URLs require the browser's separate opt-in. Authenticated/redirected PDFs can be downloaded by the user and selected locally.

Revocation unregisters resident scripts and saves dependent switches/automatic rules as off, preserving never-rules and unrelated settings. Local `ui.permissionsRevoked` field names allow popup UI to explain this later. Already-running scripts cannot be unloaded; passive UI follows saved settings, and new documents receive no automatic injection. No permissions are automatically re-requested.

`commands` declares shortcuts, not an additional permission. No tabs/cookies/webRequest/notifications/history/clipboard permissions are requested. Web-accessible resources enumerate the content module graph and CSS only. CSP permits packaged local WASM while scripts and Workers remain self-only; no remote executable extension code is loaded.
