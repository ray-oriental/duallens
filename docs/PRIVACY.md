# 隐私说明 / Privacy

## 中文

**开发者不接收任何数据。** DualLens 没有服务器、账号、统计或远程配置。你触发翻译或启用自动翻译规则后，待译文字由你的浏览器**直接**发给你选择的翻译服务；开发者看不到这些内容。

**发送什么、发给谁**
- 机器翻译（默认）：待译文字（含用于保留格式的占位符）、源/目标语言。默认发往微软 Edge 使用的免费非官方端点 `edge.microsoft.com`（必要时 `api-edge.cognitive.microsofttranslator.com`），失败时发往谷歌 `clients5.google.com`。选用官方 Microsoft Translator 或 DeepL 时发往其官方接口并带上你的 key；官方引擎失败时直接报错，不会回退到免费端点。免费引擎之间的备用默认开启，可在设置里关闭。
- AI 服务（可选）：待译文字、**页面标题（最多 200 字）**、与待译文字相关的术语表条目、你写的自定义提示，以及你的 API key（作为 `Authorization` 头，仅发往你配置的地址）。不发送网址或 cookie；不自动收集表单和密码框内容。用户明确执行输入框翻译时发送该字段的文字，密码框始终跳过。
- 以上请求都不带 cookie（`credentials: omit`）；服务商能看到你的 IP 地址、浏览器 User-Agent 与请求来源标识。这些免费端点不是微软/谷歌面向第三方的正式服务，可能随时变动或失效，其对文字的处理由各自条款决定；DualLens 与这两家公司没有隶属关系。
- 首次向某个服务发送前，上手、设置或当前翻译工具会先说明去向并由你确认；尚未确认时，页面卡片需点"继续翻译"后才发送。仅发往本机回环地址（`localhost`/`127.0.0.1`/`::1`）的本地模型不需要确认。

**保存在本机什么**：设置、术语表、站点规则（可由浏览器同步，不含密钥）；API key（扩展用 chrome.storage.local，用户脚本用脚本管理器存储；仅本机，**未加密**保存，不同步、不进明文导出）；译文缓存（默认 30 天、最多 50000 条，可一键清除；隐身/InPrivate 请求不读写缓存；侧栏等无法确认窗口状态的上下文也停用缓存；用户脚本以管理器提供的隐身标志判断，未知时同样停用；译文可能来自你浏览的私密页面）；已下载的 OCR 语言包；打开网页 PDF 时用于交接的临时副本（有效期 5 分钟，读取后即删，过期副本在下次访问暂存区时清除）。

**浏览器同步**：设置、术语表、站点规则、自定义提示、服务地址与模型名会通过你浏览器自带的同步服务在你的设备间同步（由浏览器厂商运营，不经过 DualLens）。API key 与"已确认的去向"不同步。

**其他网络请求**：①你打开 PDF 或图片文字时，会匿名下载对应文件；②首次使用图片文字时，从 GitHub（`raw.githubusercontent.com`，固定提交与 SHA-256）下载 OCR 语言包，GitHub 可看到你的 IP；③用户脚本版由 Tampermonkey 向 GitHub、jsDelivr 获取并校验固定版本资源。

**Limited Use**：DualLens 对用户数据的使用仅限于提供和改进"翻译你正在查看的内容"这一单一用途；不出售、不用于广告、不用于与该用途无关的目的，也不用于判断资信或放贷。

**联系与变更**：问题与安全报告见 GitHub 仓库（Issues / Security Advisories）。政策变更会随版本更新并记录在 CHANGELOG。

设置页中主动点击「获取模型」会向所选服务请求模型列表；「测试连接」发送固定的示例文字，不包含网页内容。显式测试操作本身授权这次测试，不替代网页文字的首次发送确认。

弹出页只在无法注入当前页（例如内置 PDF 查看器）或网址路径以 `.pdf` 结尾时检查 PDF 类型；`.pdf` 路径无需探测，否则向原站完整 URL 发送匿名 HEAD，必要时 Range GET（最多读取文件头），不跟随重定向。点击打开 PDF 才下载完整文件（上限 64 MiB）；暂存最多 3 份，读取即删，过期项在下一次访问暂存区时清除。选择的本地文件只在内存解析；翻译只发送文本块，不上传 PDF、文件名或 URL。图片也仅下载到本机用于 OCR，不上传像素。

所有能读取浏览器配置文件的人或程序都可能读到未加密的密钥；请保护系统账户。明文导出虽不含密钥，仍可能包含服务地址、站点规则、术语表和自定义提示，请勿公开。加密备份含密钥，使用至少 8 字符口令，通过 PBKDF2-SHA256 与 AES-GCM 加密；口令不保存。删除扩展或清除对应存储可删除本机数据；浏览器同步副本请同时通过浏览器的同步设置管理。

用户脚本管理器还会按其设置从 GitHub 检查脚本更新。GitHub 与 jsDelivr 的资源请求会暴露 IP、User-Agent 等标准网络信息；代码资源固定版本并校验完整性，扩展商店包不加载远程代码。

本工具面向一般用户，不针对儿童建立账户或收集儿童资料。翻译内容由用户选择，请结合第三方服务条款决定是否发送敏感文字。第三方服务依各自的 [Microsoft 隐私声明](https://privacy.microsoft.com/privacystatement)、[Google 隐私政策](https://policies.google.com/privacy)、[DeepL 隐私政策](https://www.deepl.com/privacy) 或所配置 AI 服务的政策处理请求。

商店申报包含「网站内容」和「身份验证信息」：文字及用户提供的 API key 会直接发送到所选服务。开发者不接收、出售或保留这些请求。

## English

The developer receives no data. DualLens has no servers, accounts, analytics or remote configuration. When you trigger translation or enable an automatic translation rule, your browser sends the text directly to the service you selected.

What is sent
- Machine translation (default): the text to translate (with placeholder tags that preserve formatting) and the source/target languages, to Microsoft's free unofficial endpoint (edge.microsoft.com, and api-edge.cognitive.microsofttranslator.com if needed), then Google's (clients5.google.com) if that fails. With official Microsoft Translator or DeepL the text and your key go to their official APIs; official engines fail with an error and never fall back to free endpoints. Fallback between free engines is enabled by default and can be disabled in Settings.
- AI service (optional): the text, the page title (up to 200 characters), glossary entries that match the text, your custom prompt, and your API key as an Authorization header, only to the address you configured. URLs and cookies are not sent. Form contents are not automatically collected; explicitly translating an input sends that field’s text. Password fields are always skipped.
- Requests carry no cookies. Providers can see your IP address, User-Agent and the extension origin. The free endpoints are not official third-party services of Microsoft or Google, may change or stop at any time, and are governed by those companies' terms. DualLens is not affiliated with either.
- Before text is first sent to a service, setup, Settings or the current translation tool explains the destination and asks you to confirm. An unacknowledged destination shows a card and text goes out only after Continue. Local models on a loopback address (localhost, 127.0.0.1, ::1) need no confirmation.

Stored on your device: settings, glossary, site rules (synced by your browser, no keys); API keys (device only in chrome.storage.local or userscript-manager storage, stored unencrypted, never synced or in plaintext exports); translation cache (30 days and up to 50,000 entries by default, disabled for incognito/InPrivate requests and contexts without an authoritative normal-window flag (including unknown userscript-manager state), may contain translations of private pages, clearable); downloaded OCR language data; a temporary copy of a web PDF while the reader tab opens (valid for five minutes, deleted when read; expired copies are purged on the next handoff access).

Browser sync carries settings, glossary, site rules, custom prompt, service URLs and model names via your browser vendor's sync service, not DualLens. Keys and "confirmed destinations" never sync.

Other requests: PDFs and images you ask to translate are downloaded anonymously; OCR language data is fetched once from GitHub (raw.githubusercontent.com, pinned commit, SHA-256 verified), so GitHub sees your IP; the userscript edition fetches pinned resources from GitHub and jsDelivr through Tampermonkey.

Limited Use: user data is used only to provide and improve the single purpose of translating content you are viewing. It is not sold, used for advertising, used for unrelated purposes, or used to determine creditworthiness.

Contact and changes: see the GitHub repository (Issues / Security Advisories). Changes ship with new versions and are listed in the CHANGELOG.

Deliberately clicking Fetch models requests a model list; Test connection sends fixed sample sentences, without webpage content. Such explicit tests authorize that test request and do not acknowledge future webpage translation.

The popup checks PDF type only if injection fails (such as the built-in PDF viewer) or the URL path ends in .pdf. A .pdf path needs no probe; otherwise an anonymous HEAD, then if needed a Range GET for the header, goes to the original full URL without redirects. Full PDF bytes are fetched only on Open (64 MiB maximum); up to three temporary copies expire after five minutes, are deleted when consumed, and expired records are removed on the next handoff access. Selected local files are processed in memory. Only text blocks are translated, without PDF bytes, filename or URL. Images are downloaded for local OCR; pixels are never uploaded.

Anyone able to read the browser profile may read unencrypted keys. Protect your OS account. Plaintext exports omit keys but can contain service addresses, site rules, glossary and custom prompts; do not post them publicly. Encrypted exports include keys, use PBKDF2-SHA256/AES-GCM and require at least eight passphrase characters; passphrases are not stored. Uninstalling or clearing extension storage removes device data; manage browser-sync copies through the browser vendor’s sync settings as well.

Tampermonkey may check for updates on GitHub. GitHub/jsDelivr requests expose standard IP and User-Agent information. Userscript resources are version-pinned and integrity checked; the store extension loads no remote executable code.

DualLens serves a general audience and does not create children’s accounts or build profiles. Consider provider policies before translating sensitive content: [Microsoft](https://privacy.microsoft.com/privacystatement), [Google](https://policies.google.com/privacy), [DeepL](https://www.deepl.com/privacy), or the policy of your configured AI service.

Store disclosures include Website content and Authentication information: text and user-provided API keys are transmitted directly to the selected provider. The developer does not receive, sell or retain these requests. For privacy questions, open an issue in the GitHub repository; disclose security vulnerabilities through its private Security Advisories channel.
