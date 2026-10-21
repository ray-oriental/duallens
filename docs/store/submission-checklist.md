# Chrome Web Store / Edge Add-ons submission

由维护者在商店控制台提交。两个商店均待上架，版本与本地化发布信息由维护者发布前核对。

1. 完成离线测试、源文件隐私检查和发布构建：`python -B scripts/build_release.py`。
2. 分别使用 `duallens-chrome-store-v<version>.zip` 与 `duallens-edge-store-v<version>.zip`。两个商店包去掉 manifest.key、仅含扩展运行资源；开发者 ZIP 可保留固定 ID。
3. 运行 `python -B scripts/check_project.py --dist-dir dist`；核对 SHA256SUMS。
4. 使用 listing.en.md、listing.zh-CN.md；不出现竞品名或隶属暗示。上传纯演示网页的截图；发布前核对实际界面语言。
5. 隐私政策 URL：https://github.com/ray-oriental/duallens/blob/main/docs/PRIVACY.md 。先发布政策再提交。
6. Privacy practices 勾选 **Website content（网站内容）** 和 **Authentication information（身份验证信息）**。网页文字/标题与用户自填 API key 会直接发到所选服务；开发者不接收。不能声称“不收集任何数据”。
7. 不勾个人身份、健康、财务、通信、位置、历史或用户行为：不以这些数据为目标，不记录浏览历史或按键；若用户主动翻译的页面含敏感资料，由其选择是否发送。
8. 同意 Limited Use 的三项限制：不出售或在批准用途外转让；不用于无关目的；不用于资信或放贷。向翻译服务发送属于单一用途所需。
9. Remote code 选 **No**；全部 JS/WASM 随包发布，OCR 下载仅为固定提交、字节数及 SHA-256 校验的数据。PDF.js 禁用 eval，CSP 不允许 unsafe-eval。用户脚本单独在 GitHub Releases 分发，不放进商店包。
10. 核对开发者/支持链接、商店要求的主体身份与版本、本地化、许可证。提交动作由维护者完成。

## Single purpose

DualLens translates the content the user is currently looking at — a web page, selected text, text typed in an input field, video captions, a PDF or text in an image — into a language the user chooses, and shows the translation next to the original. All features (optional on-page buttons, side panel, PDF pages, captions, image text) serve this one purpose.

## Permission justifications

| Permission | English | 中文 |
| --- | --- | --- |
| `activeTab` | Used only when the user clicks the toolbar button, presses a shortcut or picks a context-menu item. It gives temporary access to that one tab so the translator can read the visible text and insert the translation. | 仅在用户点击工具栏按钮、按快捷键或选择右键菜单时使用，临时访问当前这一个标签页，用于读取可见文字并插入译文。 |
| `scripting` | Injects the packaged translator (content script and CSS) into the tab the user acted on, and registers it for all sites only if the user turns on a feature that must be present before they click. No remotely hosted code is used. | 将随包发布的翻译脚本与样式注入用户操作的标签页；仅当用户打开必须常驻的功能时，才为所有网站注册。不使用任何远程托管代码。 |
| `storage` | Stores the user's settings, glossary, site rules, translation cache preferences and API keys. Keys stay on the device and are never synced. | 保存用户设置、术语表、站点规则、缓存偏好和 API key；key 只存本机、不同步。 |
| `unlimitedStorage` | Keeps the local translation cache (up to 50,000 entries by default) and the downloaded OCR language data (about 11 MB) from being evicted by the browser. Nothing is uploaded; the user can clear both in Settings. | 防止本机译文缓存（默认最多 50000 条）与已下载的 OCR 语言包（约 11 MB）被浏览器驱逐。不上传任何内容，用户可在设置中清除。（**若采纳 N2 去掉该权限，则删除此条**） |
| `contextMenus` | Adds four right-click items: translate/restore page, translate selection, bilingual video captions, and translate image text (only when that feature is on). | 添加四个右键菜单项：翻译此页/显示原文、翻译选中文字、视频双语字幕，以及（仅在开启时）翻译图片文字。 |
| `sidePanel` | Opens the text-translation side panel when the user presses Alt+S or clicks "Text translation" in the popup. | 用户按 Alt+S 或在弹出页点"文本翻译"时，打开文本翻译侧栏。 |
| `offscreen` | Creates a hidden extension document only when the user asks to translate text in an image, so image decoding and OCR workers run on the device. Pixels are never uploaded. | 仅在用户要求翻译图片中的文字时创建隐藏的扩展文档，使图像解码和 OCR 在本机运行，图像不会上传。 |
| `declarativeNetRequestWithHostAccess` | Sets the Referer header to the site's public root on this extension's own image requests to the image hosts the user has authorised, so the page's images can be read for local OCR. It does not touch the page's own requests and is removed when the feature is turned off. | 仅对本扩展自己向用户已授权的图片主机发起的请求，把 Referer 设为站点公开根地址，使页面中的图片能被本地 OCR 读取；不影响网页自身请求，关闭功能即移除。 |
| Required hosts | Only edge.microsoft.com, api-edge.cognitive.microsofttranslator.com, clients5.google.com: default free machine translation. Other provider hosts are optional and requested on save/test. | 免费机翻的三个主机为必需，其他官方/AI 服务主机在保存或测试时按需申请。 |
| Optional host permission `<all_urls>` | Requested only when the user turns on a feature that must already be on the page before they click — always-translate rules, the floating button, selection/hover/input translation, cross-frame text, auto video captions or image text. If the user declines, the feature stays off. It can be revoked at any time and dependent switches are turned off automatically. | 仅当用户打开必须在点击前就存在于页面上的功能——"总是翻译"规则、悬浮球、划词/悬停/输入框翻译、跨域 iframe、自动视频字幕或图片文字——时才在用户操作中申请。拒绝则功能保持关闭；可随时撤销，相关开关会自动关闭。 |
| Remote code | No. All code and WebAssembly (PDF.js, Tesseract OCR) is packaged. OCR language data is downloaded as data from a pinned commit and verified by size and SHA-256. | 否。全部代码与 WebAssembly（PDF.js、Tesseract OCR）随包发布；OCR 语言数据以数据形式从固定提交下载，并校验字节数与 SHA-256。 |


## Reviewer test instructions / Notes for certification

No account or key is needed. Complete the three-step setup if prompted; selecting free translation confirms the displayed Microsoft/Google destinations there. Open any normal web page (for example an English news article), click the DualLens toolbar icon, then "Translate this page" (or press Alt+A).

1. If the destination has not already been confirmed in setup or Settings, the first translation shows a small card in the lower-right corner explaining where the text will be sent (Microsoft's free machine-translation endpoint, Google as fallback). Click "Continue".
2. The translation appears under each paragraph. Click "Show original" to restore the page.
3. Optional features (floating button, selection, hover, input box, video captions, image text) are off by default. Turning one on shows the browser's optional-permission prompt for "all sites"; declining leaves the feature off.
4. PDF: open a PDF on the web, click the icon, then "Open this PDF with DualLens".
5. AI services (OpenAI, OpenRouter, Ollama, custom) are optional and need the reviewer's own key; they are not required to test.

Notes: The default machine translation uses free, unofficial endpoints that are not documented or guaranteed by Microsoft/Google. If they rate-limit or are unreachable from the review network, translation can fail temporarily; please retry later. No remote code is loaded; PDF.js and Tesseract (WebAssembly) are packaged. OCR language data (data files, not code) is downloaded on first use from a pinned GitHub commit and verified by size and SHA-256. Source: https://github.com/ray-oriental/duallens

漫画取图的 Referer 会话规则仅作用于扩展自身、用户授权主机的匿名图片请求，不影响网页请求；用于读取用户正在查看的图片并在设备上 OCR，不保存原图。可选所有网站权限在开启常驻功能时申请，拒绝则保持关闭。

## Screenshot generation

`python -B scripts/store_assets.py` 使用隔离临时 profile、本地桩服务与演示文章的中文译文生成宣传图和界面截图。不得读取真实密钥或账户；发布前人工核对截图及文案。商店截图不展示用户脚本安装流程。
