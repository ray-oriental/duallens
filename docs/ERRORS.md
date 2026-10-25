# 报错体系（v1.1）

## 规则与恢复动作

- 文案为「发生了什么 + 怎么办」；一句话能说明就一句。界面不出现堆栈、原始 JSON、内部机器码。服务名称只来自已知显示名，其他服务称「翻译服务」。
- 服务器返回的文字只在本地经 `scrub` 去除本次密钥及常见令牌形式后用于分类，随后丢弃；不显示响应片段。未知异常使用固定兜底文案。技术详情只含 HTTP 状态、已知服务名，绝不带 URL、任意服务器代码、请求或响应正文。
- `classify` 将调度码 `ERR.*` 与用户恢复分类 `category` 分开。401/403 保持 CONFIG；429 限流保持 RATE_LIMITED；余额/配额不足按配置问题终止重试。模型不存在与接口不存在分开。Retry-After 支持秒数、小数和 HTTP 日期；提示向上取整为大约秒数，传输保留有限数值。
- 网络/离线：读取 `navigator.onLine`，只在明确 false 时称离线；超时不冒充离线。GM 请求失败说明检查脚本管理器连接权限；不会读取其事件正文。
- 配置错误给「打开设置」，AI 直达 `#ai`，官方机翻直达 `#common`，存储问题直达 `#data`。可重试错误给「重试」，所有分类均可展开一行「详情」。权限未获准时不自动重新申请，要求用户显式重新开启。
- 临时错误先安静自动重试，最多两次：网络 / 离线恢复、超时、服务端 5xx 等待 16 秒；限流优先使用 Retry-After（最多两分钟），缺失时 60 秒。到期后仅在设备在线、页面可见、段落仍在视口、翻译仍开启且未暂停时发起；离线或滚出视口则等待联网 / 可见性 / 滚动事件，不轮询。配置、密钥 / 权限、地址 / 404、解析、模型、配额、内容拒绝、首次确认、跳转、超大响应等不自动重试。后台既有有界重试与免费备用链仍保留。
- 部分失败保留成功段落和原文；不可重试或自动重试用尽时，汇总「n 段没有翻译成功」，提供「重试这些段落」。计数排除仍在自动重试中的单元，等待期间不弹提示，段落保留原有标记。手动重试只处理这些终止失败的单元，合并为有界批次并重置其重试次数。跨域 frame 代理保持无 UI，现有跨域计数不汇总到顶层；停止 / 导航取消计时器、提示和旧结果。
- 翻译与模型列表请求统一使用 `redirect: 'error'`，不跟随 HTTP 3xx；不探测 Location、不自动向最终地址重发。已知跳转归类为 redirect，要求在设置填写最终地址；HTTP 状态可用时显示在详情中。GM 同样要求拒绝跳转，并在进度 / 状态变化 / 完成时检查 `finalUrl` 来源；不同源立即中止、丢弃结果，不再发请求。
- 所有翻译、模型列表和错误响应统一上限 4 MiB（4,194,304 字节），SSE 也按接收字节计数。Content-Length 已超限立即取消；缺失、不可信或压缩后的长度较小时，以解码前读取的正文流字节累计兜底，超限取消 reader。GM 用 onprogress.loaded 和 UTF-8 正文字节数兜底并 abort。不会先读完整原生响应再判断，也不会把超大错误正文带进报错。
- 同一页面最多一个 toast；新的提示替换旧提示。可恢复错误持续显示，直到关闭、恢复原文、导航或重试；不让操作按钮在点击前消失。成功使用免费机翻备用的提示每次页面翻译最多一次，6 秒后消失；一般信息提示 2.6 秒。原有输入无焦点、编辑器内容已变等本地提示保留现有显式短时长。
- 每次错误替换文本节点、更新可见的本地时间（精确到毫秒）和 `data-error-revision`，并作 120ms 淡入；减少动效时无动画。设置页沿用原有 HH:MM:SS 与异步清空/忙碌态反馈。
- 首次发送仍由阻塞确认卡处理，未确认零发送，不把确认当网络失败；PDF 与 OCR 专用错误由 v11-pdf 维护，本文件仅盘点。

## 共享分类与当前中英文案

| ERR 调度码 / 分类 | 触发场景 | 中文 | English | 界面 | 动作 |
| --- | --- | --- | --- | --- | --- |
| ERR.NETWORK / offline | 网络请求失败且 navigator.onLine 明确为 false | 当前设备已离线，请联网后重试。 | This device is offline. Reconnect and retry. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试 |
| ERR.NETWORK / network | 请求无法连接到所选服务；浏览器未提供跳转原因的 fetch 失败 | 无法连接翻译服务（也可能是跳转被拦截）；请检查网络，并在设置中改用最终地址后重试。 | Cannot reach the service; a redirect may be blocked. Check your connection and use the final address in Settings, then retry. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试 |
| ERR.NETWORK / ERR.TIMEOUT / timeout | 请求或流式等待超过配置时限 | 翻译服务响应超时，请稍后重试或更换模型。 | The translation service timed out. Retry later or choose another model. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试 |
| ERR.RATE_LIMITED / rate | HTTP 429 / rate_limit_exceeded | 翻译服务请求过多，请稍后重试。 | The translation service is rate limiting requests. Retry later. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试（有 Retry-After 时提示秒数） |
| ERR.PROVIDER / server | HTTP 5xx | 翻译服务暂时不可用，请稍后重试。 | The translation service is temporarily unavailable. Retry later. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试 |
| ERR.CONFIG / auth | HTTP 401 / 403（内容策略拒绝另分） | 密钥无效或没有访问权限，请在设置中检查密钥与服务权限。 | The key is invalid or lacks access. Check your key and service permissions in Settings. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai |
| ERR.PROVIDER / address | HTTP 404 且没有模型错误信息 | 找不到服务接口，请在设置中检查服务地址（通常以 /v1 结尾）。 | The service endpoint was not found. Check the service address in Settings (usually ending in /v1). | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai |
| ERR.PARSE / parse | 返回非 JSON / 结构或译文校验失败 | 翻译服务返回的内容无法解析，请重试或更换模型。 | The translation service returned an unreadable response. Retry or choose another model. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试 / 更换模型 |
| ERR.PARSE / html | 接口地址返回 HTML 网页 | 服务返回的是网页，请在设置中检查是否填写了接口地址（通常以 /v1 结尾）。 | The service returned a webpage. Check the API address in Settings (usually ending in /v1). | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai |
| ERR.PROVIDER / model | model_not_found / Model Not Exist / No endpoints found | 所选模型不存在或暂时不可用，请在设置中重新获取并选择模型。 | The selected model does not exist or is unavailable. Refresh and select a model in Settings. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai |
| ERR.CONFIG / quota | 402 / DeepL 456 / insufficient_quota / balance / credit | 翻译服务的配额或余额不足，请检查服务账户或更换服务。 | The translation service has insufficient quota or credit. Check your service account or choose another service. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai |
| ERR.PROVIDER / refused | content_filter / moderation / message.refusal / SSE 安全拒绝 | 翻译服务因内容安全规则拒绝了这段文字，请调整选中文字或更换服务。 | The translation service rejected this text under its content policy. Adjust the selected text or choose another service. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；调整所选文字 / 服务 |
| ERR.CONFIG / config | 未选择服务、模型或缺少必需字段 | 翻译服务尚未配置完整，请打开设置检查服务地址、密钥和模型。 | The translation service setup is incomplete. Check its address, key and model in Settings. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai；MT 为 #common |
| ERR.CONFIRMATION_REQUIRED / confirmation | 所选去向首次发送前尚未确认 | 首次发送前需确认文字去向，请在确认提示中继续或更换服务。 | Confirm the destination before sending text. Continue or change service in the confirmation prompt. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 阻塞确认卡；继续 / 更换服务 |
| ERR.PERMISSION / permission | 拒绝站点访问或没有 activeTab | 未获得站点权限，功能仍关闭；请重新开启并允许所需权限。 | Site access was denied and the feature remains off. Enable it again and allow the required permission. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；用户重新开启功能并授权 |
| ERR.RESTRICTED / restricted | 浏览器内置、商店或原生 PDF 页面 | 当前页面受限（内置页、商店或原生 PDF），请打开普通网页或 DualLens PDF 阅读器。 | This page is restricted (browser pages, stores or native PDF). Open a webpage or the DualLens PDF reader. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；普通网页 / DualLens PDF 阅读器 |
| ERR.INJECTION / injection | 普通 HTML 页面无法建立内容控制器 | 未能连接页面，请刷新页面后重试。 | Could not connect to this page. Reload the page and retry. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 刷新后重试 |
| ERR.STORAGE / storage | QuotaExceededError / 存储配额错误 | 设备存储空间不足，未能保存；请在设置中清理缓存后重试。 | Device storage is full and saving failed. Clear the cache in Settings and retry. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 打开设置 #data 清缓存后重试 |
| ERR.PARTIAL / partial | 仍存在的段落单元处于 error 状态 | $1 段没有翻译成功，可重试这些段落。 | $1 paragraphs could not be translated. Retry these paragraphs. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试这些段落；配置错误同时提供设置 |
| ERR.FALLBACK / fallback | 免费 MT 首选失败，备用已成功给出译文 | 免费机器翻译失效，已切换备用服务，可继续阅读。 | The free endpoint failed. A fallback service is in use; keep reading. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；继续阅读，6 秒自动关闭 |
| ERR.CANCELLED / cancelled | 用户取消或恢复原文 | 已取消翻译，需要时可重新翻译。 | Translation cancelled. Translate again when needed. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；需要时重新翻译 |
| ERR.PROVIDER / unknown | 没有安全的可识别错误类别 | 未能完成操作，请重试；若仍失败，请检查设置。 | The operation could not be completed. Retry; if it keeps failing, check Settings. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 详情；检查设置后重试 |
| ERR.NETWORK / gm | GM_xmlhttpRequest 失败且不是主动取消 | 用户脚本请求失败，请检查网络及脚本管理器连接权限后重试。 | The userscript request failed. Check your connection and script manager permissions, then retry. | 页面提示、popup、侧栏、用户脚本；后台传输同分类 | 重试；检查网络和脚本管理器连接权限 |
| ERR.REDIRECT / redirect | 可识别的 3xx / redirect fetch 异常 / GM finalUrl 不同源 | 服务地址发生了跳转（HTTP 3xx），为安全起见没有跟随。请在设置中改用最终地址。 | The service address redirected (HTTP 3xx). DualLens did not follow it for safety. Use the final address in Settings. | 页面提示、popup、设置、侧栏、用户脚本；后台传输同分类 | 打开设置 #ai（官方机翻 #common），不自动重试 |
| ERR.RESPONSE_SIZE / size | Content-Length / 累计字节 / GM loaded 超过 4 MiB | 服务返回内容超过 4 MiB，已停止接收。请缩小翻译范围或更换模型后重试。 | The service response exceeded 4 MiB and was stopped. Translate less text or choose another model, then retry. | 页面提示、popup、设置、侧栏、用户脚本；后台传输同分类 | 详情；缩小范围 / 更换模型，不自动重试 |

### 传输可观察性与兼容限制

Chromium 的原生 fetch 在 `redirect: 'error'` 被触发时可能只给 `TypeError: Failed to fetch`，不暴露状态、Location 或 cause，和网络故障无法可靠区分。可识别的重定向使用专门文案；没有证据的失败使用网络文案并提示可能拦截了跳转，不伪造 HTTP 3xx。两种情况均不跟随跳转、不探测第二来源。此类不透明失败仍可能按网络错误进行两次原地址重试。

旧脚本管理器若忽略 `redirect: 'error'`，`finalUrl` 回调发生时，跳转请求可能已经发生；兼容检查只能立即中止并拒绝使用结果，不能撤回已经发送的数据。严格的跳转前阻断依赖支持该参数的 Tampermonkey；不要把 finalUrl 检查解释为旧版本上的发送前保证。



## 原有错误与输入校验文案盘点

逐键列出源码中已有的错误、拒绝、边界与修正提示。局部校验没有独立 ERR 时明确标记；不把校验误当联网失败。PDF/OCR 非标准码保留所属模块。源码行号是本次快照，新增扫描 OCR / 导出错误需 PDF 同事追加。

| 原键 / 错误码 | 触发场景与来源 | 中文 | English | 界面 | 用户动作 |
| --- | --- | --- | --- | --- | --- |
| `m0` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comic-sites.js:7` | 扩展身份无效 | Invalid extension identity | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m2` / unsupported | 服务配置、网络、响应或任务校验失败；`extension/background/comic-sites.js:33` | 此浏览器无法设置图片 Referer | This browser cannot set the image Referer | 后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；服务配置、网络、响应或任务校验失败；页面翻译或交互操作失败；`extension/background/comics.js:5`；`extension/content/comics/capabilities.js:13`；`extension/content/comics/capabilities.js:14` | 图片地址无效 | Invalid image address | OCR / 图片、后台 → 各消费界面、页面内提示 / 段落 | 按文案检查设置 / 更换服务 |
| `m4` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:7` | 图片下载失败（HTTP $1）：站点拒绝扩展下载；原图已保留 | Image download failed (HTTP $1). The site blocked the extension; the original image is unchanged | 后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m5` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:9` | 不支持的图片格式 | Unsupported image format | 后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；服务配置、网络、响应或任务校验失败；页面翻译或交互操作失败；`extension/background/comics.js:14`；`extension/content/comics/capabilities.js:18` | 图片超过 16 MB | Image exceeds 16 MB | OCR / 图片、后台 → 各消费界面、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m7` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:22` | 请在弹出页开启图片文字并允许网站访问权限；跨站图片还需要允许其图片来源。 | Enable Image text in the popup and allow site access. Cross-site images also need access to their source. | 后台 → 各消费界面 | 显式重新开启并授权；拒绝保持关闭 |
| `ma` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:65` | 漫画识别请求无效 | Invalid OCR request | 后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `md` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:74` | 画布含嵌套切片、透明混合或不支持的合成方式，暂无法可靠识别 | Nested tiles, transparency or unsupported blending prevent reliable canvas recognition | 后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `me` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；服务配置、网络、响应或任务校验失败；`extension/background/comics.js:75`；`extension/offscreen/ocr.js:59` | 画布切片无效 | Invalid canvas tile | OCR / 图片、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `mf` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/comics.js:76` | 画布变换无效 | Invalid canvas transform | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `mg` / ERR.CONFIG | 服务配置、网络、响应或任务校验失败；`extension/background/handlers.js:36` | 找不到模型配置：$1 | Model configuration not found: $1 | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `mh` / ERR.CONFIG | 服务配置、网络、响应或任务校验失败；`extension/background/handlers.js:43` | 没有要翻译的文字 | No text to translate | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `mr` / ERR.CONFIG | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:131` | 机器翻译 key 无效或额度不足 | The translation key is invalid or its quota is exhausted | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `ms` / ERR.PROVIDER | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:133` | 机器翻译服务暂不可用（HTTP $1） | Translation service unavailable (HTTP $1) | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `mt` / ERR.PROVIDER | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:135` | 机器翻译请求被拒绝（HTTP $1） | Translation request rejected (HTTP $1) | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `mu` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:139` | 机器翻译返回了无法解析的内容 | Could not parse the translation response | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m10` / ERR.CONFIG | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:281` | DeepL 额度已用完 | DeepL quota exhausted | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m11` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:322` | 机器翻译没有返回这一段的译文 | No translation was returned for this paragraph | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m12` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/shared/errors.js:117` | ；官方引擎失败，未转发到免费端点。 | ; the official service failed. Nothing was sent to free endpoints. | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m13` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:331` | 机器翻译暂时不可用，稍后自动重试 | Machine translation is unavailable. It will retry later | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m15` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/mt.js:403` | 机器翻译没有返回结果 | No translation was returned | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m16` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；服务配置、网络、响应或任务校验失败；`extension/background/pdf.js:7` | 无法读取此 PDF。请允许该来源，或下载后在阅读页选择本地文件。 | Could not read this PDF. Allow its source, or download it and select the local file in the reader. | PDF 阅读器、后台 → 各消费界面 | 显式重新开启并授权；拒绝保持关闭 |
| `m17` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；服务配置、网络、响应或任务校验失败；`extension/background/pdf.js:48` | 当前页面未确认是 PDF，请先打开 PDF 文件。 | This page is not confirmed as a PDF. Open a PDF file first. | PDF 阅读器、后台 → 各消费界面 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m19` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:30`；`extension/background/queue.js:89`；`extension/background/translator.js:118` | 没有可用的模型配置 | No model is configured | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m1b` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:37` | 接口地址为空或格式不对 | The service address is empty or invalid | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m1d` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/background/providers.js:40`；`extension/shared/settings.js:233` | 接口地址不能包含凭据或查询参数 | The service address cannot contain credentials or query parameters | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m1f` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:44` | API key 含有非法字符 | The API key contains invalid characters | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1g` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:45` | 不会通过明文 http 向远程主机发送 API key，请改用 https | API keys cannot be sent to remote hosts over plain HTTP. Use HTTPS | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1i` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:168` | 无效的流式响应 | Invalid streaming response | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1k` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:175` | 流式响应过大 | The streaming response is too large | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1m` / ERR.NETWORK | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:234` | 请求超时（$1 秒） | Request timed out ($1 seconds) | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m1r` / ERR.PROVIDER | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:286` | 演示后端按要求返回错误 | The mock service returned the requested error | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1t` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:291` | 演示输入格式错误 | Invalid mock input | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m1y` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:334` | 接口返回里没有译文内容 | The service returned no translation text | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m1z` / ERR.PARSE | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:357` | 接口返回里没有模型列表 | The service returned no model list | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m25` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/subtitles.js:7` | 跨站字幕需要来源权限；请在弹出页授权网站访问，或使用当前站点字幕。 | Cross-site subtitles need source access. Allow site access in the popup, or use subtitles from this site. | 后台 → 各消费界面 | 显式重新开启并授权；拒绝保持关闭 |
| `m26` / config | 服务配置、网络、响应或任务校验失败；`extension/background/subtitles.js:20` | 字幕轨道请求无效或过多 | Invalid request or too many subtitle tracks | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m27` / network | 服务配置、网络、响应或任务校验失败；`extension/background/subtitles.js:31` | 无法连接翻译服务（也可能是跳转被拦截）；请检查网络，并在设置中改用最终地址后重试。 | Cannot reach the service; a redirect may be blocked. Check your connection and use the final address in Settings, then retry. | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m28` / ERR.CONFIG | 服务配置、网络、响应或任务校验失败；`extension/background/translator.js:57` | 服务或模型选择无效 | Invalid service or model selection | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m29` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/translator.js:231`；`extension/background/translator.js:301` | 模型没有返回这一段的译文 | The model returned no translation for this paragraph | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m2c` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/translator.js:327` | 译文不完整 | Incomplete translation | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m2d` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/translator.js:523` | 大模型响应超时 | The AI service timed out | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m2e` / ERR.PROVIDER | 服务配置、网络、响应或任务校验失败；`extension/background/translator.js:580` | 没有得到译文 | No translation received | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m2f` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:3`；`extension/content/comics/controller.js:87`；`extension/content/comics/controller.js:90` | 此页无法本地识别 | Local OCR is unavailable on this page | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2g` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:7` | 此页无法本地识别（WASM 被页面策略阻止） | Local OCR is unavailable (WASM blocked by page policy) | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2h` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:20` | 图片下载失败（HTTP $1） | Image download failed (HTTP $1) | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2i` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:21` | 不支持的图片或图片过大 | Unsupported image or image too large | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2j` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:23` | 此页无法取图 | Could not retrieve the image on this page | OCR / 图片、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m2k` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/capabilities.js:23` | 图片下载超时 | Image download timed out | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2m` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/controller.js:74` | 此平台暂不支持语言包管理 | Language pack management is unavailable on this platform | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m2o` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/controller.js:100` | 文字翻译失败 | Text translation failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m32` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/panel.js:28` | canvas 站点注册失败 | Canvas site registration failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m35` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/panel.js:58` | 没有找到可信文字；可切换语言/方向重试。 | No reliable text found. Try another language or direction. | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m39` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/panel.js:75` | 语言包不可用 | Language pack unavailable | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3d` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；设置保存、导入导出或字段校验；页面翻译或交互操作失败；`extension/content/comics/panel.js:79`；`extension/ui/forms/index.js:37` | 语言包删除失败 | Could not delete the language pack | OCR / 图片、设置、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3e` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/runtime-resources.js:12` | OCR 运行时资源不可用 | OCR runtime unavailable | OCR / 图片、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m3f` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/runtime-resources.js:14`；`extension/content/comics/runtime-resources.js:36` | OCR 运行时大小校验失败 | OCR runtime size check failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m3g` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/runtime-resources.js:17` | OCR 运行时 SHA-256 校验失败 | OCR runtime SHA-256 check failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m3h` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/runtime-resources.js:37`；`extension/content/comics/runtime-resources.js:38` | OCR 运行时下载失败 | OCR runtime download failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m3i` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/runtime-resources.js:38` | OCR 运行时下载超时 | OCR runtime download timed out | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m3l` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/sites.js:5` | 漫画站点域名无效 | Invalid comic site domain | OCR / 图片、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m3n` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/sites.js:12` | 漫画站点无效 | Invalid comic site | OCR / 图片、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m3r` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:22`；`extension/offscreen/language-store.js:33`；`extension/offscreen/ocr.js:121` | 不支持的 OCR 语言 | Unsupported OCR language | OCR / 图片、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m3s` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:35`；`extension/offscreen/language-store.js:26`；`extension/offscreen/language-store.js:46` | 语言包大小校验失败 | Language pack size check failed | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3t` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:36`；`extension/content/comics/userscript-ocr.js:37` | 语言包下载失败 | Language pack download failed | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3u` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:37` | 语言包下载超时 | Language pack download timed out | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3w` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:56` | 本地 OCR 失败 | Local OCR failed | OCR / 图片、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m3x` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:58` | 此页无法本地识别（Worker 或 WASM 被页面策略阻止） | Local OCR is unavailable (Worker or WASM blocked by page policy) | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m3z` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:67` | 图片像素过大 | Too many image pixels | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m40` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；页面翻译或交互操作失败；`extension/content/comics/userscript-ocr.js:91` | 此页无法本地识别（OCR 超时 20 秒） | Local OCR is unavailable (20-second timeout) | OCR / 图片、页面内提示 / 段落 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m4a` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；页面翻译或交互操作失败；`extension/content/controller.js:507`；`extension/pdf/translate.js:247` | 译文为空 | The translation is empty | PDF 阅读器、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m4s` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；页面翻译或交互操作失败；`extension/content/injector.js:291`；`extension/pdf/viewer.js:510`；`extension/pdf/viewer.js:598` | 未知错误 | Unknown error | PDF 阅读器、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m4t` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；页面翻译或交互操作失败；`extension/content/injector.js:291`；`extension/pdf/viewer.js:598` | 翻译失败：$1（点击重试） | Translation failed: $1 (click to retry) | PDF 阅读器、页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m4u` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/inputbox.js:10` | 选区结构无法安全写回 | The selection cannot be replaced safely | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m4v` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/inputbox.js:10` | 请先点进输入框 | Click an input field first | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m50` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/inputbox.js:10` | 翻译未完成。 | Translation did not finish. | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m5v` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/selection.js:12` | 暂时没有翻译出来。 | No translation yet. | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m5y` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/subtitles/files.js:3` | 字幕格式无效：请使用有效的 SRT / VTT 时间轴 | Invalid subtitle format. Use a valid SRT / VTT timeline | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m5z` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；页面翻译或交互操作失败；`extension/content/subtitles/files.js:21`；`extension/sidepanel/subtitle-form.js:44` | 字幕文件不能超过 2 MB | Subtitle files cannot exceed 2 MB | 侧栏 / 用户脚本文本工具、页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m60` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/subtitles/json3.js:36` | 字幕格式无效或过大 | Subtitle format is invalid or too large | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m63` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；页面翻译或交互操作失败；`extension/content/subtitles/observe.js:35`；`extension/content/subtitles/observe.js:64`；`extension/platform/extension.js:26`；`extension/platform/userscript.js:38` | 字幕轨道地址无效 | Invalid subtitle track address | 后台 → 各消费界面、页面内提示 / 段落 | 按文案检查设置 / 更换服务 |
| `m64` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/subtitles/observe.js:44` | 无法读取字幕轨道或轨道过大，请重新打开播放器字幕 | Could not read the subtitle track, or it is too large. Reopen player subtitles | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m65` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/subtitles/observe.js:55` | 字幕轨道过大 | Subtitle track is too large | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m66` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/subtitles/observe.js:67` | 无法读取字幕轨道或轨道过大 | Could not read the subtitle track, or it is too large | 页面内提示 / 段落 | 依文案修正输入或查看详情 |
| `m67` / 界面局部校验或上游错误（无独立码） | 页面翻译或交互操作失败；`extension/content/util.js:4` | 悬停翻译失败，请重试 | Hover translation failed. Try again | 页面内提示 / 段落 | 检查网络后重试；保留原文 |
| `m68` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/detector.js:5` | 检测图像过大 | Detection image is too large | OCR / 图片 | 依文案修正输入或查看详情 |
| `m69` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/language-store.js:8` | 无法打开 OCR 语言缓存 | Could not open the OCR language cache | OCR / 图片 | 依文案修正输入或查看详情 |
| `m6a` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/language-store.js:21` | OCR 语言缓存操作失败 | OCR language cache operation failed | OCR / 图片 | 检查网络后重试；保留原文 |
| `m6b` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/language-store.js:29` | 语言包 SHA-256 校验失败 | Language pack SHA-256 check failed | OCR / 图片 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6c` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/language-store.js:41` | 语言包下载失败（HTTP $1） | Language pack download failed (HTTP $1) | OCR / 图片 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6d` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/ocr.js:28` | 图片过大 | Image is too large | OCR / 图片 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6e` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/ocr.js:52` | 图片像素过大（上限 2400 万） | Image exceeds 24 million pixels | OCR / 图片 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6f` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/ocr.js:66` | 画布切片参数无效 | Invalid canvas tile parameters | OCR / 图片 | 依文案修正输入或查看详情 |
| `m6g` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/ocr.js:105` | 本地 OCR 超时（20 秒） | Local OCR timed out (20 seconds) | OCR / 图片 | 检查网络后重试；保留原文 |
| `m6i` / 界面局部校验或上游错误（无独立码） | 图片识别、语言包或图像取回失败；`extension/offscreen/ocr.js:128` | 本地识别失败：解码或 WASM 不可用；原图已保留 | Local recognition failed: decoding or WASM unavailable. The original image is unchanged | OCR / 图片 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6j` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/segment-worker.js:21`；`extension/pdf/viewer.js:103` | PDF 文本块识别失败 | PDF text segmentation failed | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6o` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/source.js:22` | 无法读取 PDF；需要登录或重定向的文档请先下载，再选择本地文件。 | Could not read the PDF. Download documents requiring sign-in or redirects, then select the local file. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m6p` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/translate.js:203` | 没有收到完整译文 | No complete translation received | PDF 阅读器 | 依文案修正输入或查看详情 |
| `m6q` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/translate.js:247` | 译文缺少公式，保留原文 | A formula is missing from the translation. The original is kept | PDF 阅读器 | 依文案修正输入或查看详情 |
| `m6u` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:167` | 重试失败 | Retry failed | PDF 阅读器 | 检查网络后重试；保留原文 |
| `m6z` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:174` | 失败 $1（点 ↻ 重试） | Failed: $1 (click ↻ to retry) | PDF 阅读器 | 检查网络后重试；保留原文 |
| `m70` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:175` | $1 块精修失败，显示机器翻译 | AI refinement failed for $1 blocks. Machine translation is shown | PDF 阅读器 | 检查网络后重试；保留原文 |
| `m71` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:220`；`extension/pdf/viewer.js:421` | 此页没有可读取的文本层（可能为扫描件），不提供 OCR | This page has no readable text layer, possibly a scan. OCR is not available | PDF 阅读器 | 依文案修正输入或查看详情 |
| `m75` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:281` | 此页解析失败；可点击页码跳转重试。 | Could not parse this page. Jump to its page number to retry. | PDF 阅读器 | 检查网络后重试；保留原文 |
| `m76` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:283` | 部分页面无法渲染，其他页面仍可阅读。 | Some pages could not be rendered. Other pages remain readable. | PDF 阅读器 | 依文案修正输入或查看详情 |
| `m78` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:510` | 翻译失败：$1。点击重试 | Translation failed: $1. Click to retry | PDF 阅读器 | 检查网络后重试；保留原文 |
| `m79` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:533` | 大模型精修失败，显示的是机器翻译 | AI refinement failed. Machine translation is shown | PDF 阅读器 | 按文案检查设置 / 更换服务 |
| `m7a` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:576` | 此页没有可读取的文本层（可能为扫描件），本轮不提供 PDF OCR。 | This page has no readable text layer, possibly a scan. PDF OCR is not available. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m7c` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:810` | 加密 PDF 暂不支持，请先在本地解密后重新选择文件。 | Encrypted PDFs are not supported. Decrypt the file locally, then select it again. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m7d` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:814` | 最多打开 2000 页 PDF；请先在本地拆分。 | PDFs can have at most 2,000 pages. Split the file locally first. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m7f` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:836` | 无法打开 PDF：文件无效、过大、加密，或链接需要登录/重定向。请先下载后选择本地文件；file:// 需允许访问文件网址。 | Could not open this PDF. It may be invalid, too large, encrypted, or require sign-in or redirects. Download it and select the local file. file:// requires file URL access. | PDF 阅读器 | 显式重新开启并授权；拒绝保持关闭 |
| `m7i` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/viewer.js:937` | 当前页面未确认是 PDF（或匿名探测失败）。请打开 PDF 文件后重试，也可选择已下载的本地 PDF。 | This page is not confirmed as a PDF, or the anonymous check failed. Open a PDF and retry, or select a local PDF. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `m7k` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/platform/extension.js:15`；`extension/ui/common.js:19` | 后台没有响应 | The background service did not respond | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m7m` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/platform/extension.js:35` | 字幕轨道读取失败 | Could not read the subtitle track | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m7p` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/platform/port-client.js:155` | 没有收到译文 | No translation received | 后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m7q` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/configcrypto.js:13` | 密钥配置无效 | Invalid key configuration | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m7r` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/configcrypto.js:29`；`extension/shared/configcrypto.js:53`；`extension/shared/configcrypto.js:59`；`extension/shared/configcrypto.js:64` | 配置格式无效 | Invalid configuration format | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m7t` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/configcrypto.js:38` | 配置文件最大 1MB | Configuration files cannot exceed 1 MB | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m7u` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/configcrypto.js:50` | 配置文件过大或格式无效 | Configuration file is too large or invalid | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m7w` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/configcrypto.js:66` | 口令错误或加密配置已损坏 | Incorrect passphrase or damaged encrypted configuration | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m80` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/shared/destinations.js:33` | 微软失败时将改用谷歌，本页文字会发送给谷歌。 | If Microsoft fails, text on this page will be sent to Google. | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m8j` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/shared/presets.js:10` | 可公开获取免费模型列表。免费模型有每分钟和每日限额，切换模型不能绕过账号限额；以服务商当前规则为准。JSON 模式按模型能力启用。 | Public free-model discovery. Free models have per-minute and daily limits; switching models does not bypass account limits. Provider rules apply. Enable JSON mode only for supported models. | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m93` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:57` | AI 服务优先，慢或失败时用机器翻译 | AI first, machine translation on delay or failure | 设置、后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `m95` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:199` | 接口标识无效 | Invalid service identifier | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m97` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:239` | 备选链的首个接口或模型无效 | The first fallback service or model is invalid | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m98` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:330` | 默认扩展存储不可用，请传入 SettingsStore | Extension storage unavailable. Supply a SettingsStore | 设置、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m9a` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:391` | 站点模式无效：如 example.com/docs/*，可加 HTTP(S) 和端口；不能含空白、查询串、片段或凭据 | Invalid site pattern. Use example.com/docs/* with optional HTTP(S) and port, without spaces, query, fragment or credentials | 设置、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m9e` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:402` | 悬浮按钮自动隐藏开关无效 | Invalid floating button auto-hide setting | 设置、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m9f` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:404` | 输入框双语模式或顺序无效 | Invalid input bilingual mode or order | 设置、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `m9g` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:409` | 交互服务或模型选择无效 | Invalid interaction service or model | 设置、后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `m9y` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；`extension/sidepanel/subtitle-form.js:34` | ；部分失败，可重新翻译 | ; some entries failed. You can translate again | 侧栏 / 用户脚本文本工具 | 检查网络后重试；保留原文 |
| `ma1` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；`extension/sidepanel/subtitle-form.js:59` | 字幕翻译失败，请检查翻译服务配置 | Subtitle translation failed. Check the translation service settings | 侧栏 / 用户脚本文本工具 | 按文案检查设置 / 更换服务 |
| `ma5` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；`extension/sidepanel/subtitle-form.js:73`；`extension/sidepanel/text-form.js:164`；`extension/sidepanel/text-form.js:166` | 设置读取失败 | Could not load settings | 侧栏 / 用户脚本文本工具 | 检查网络后重试；保留原文 |
| `mak` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；`extension/sidepanel/text-form.js:144` | 无法访问剪贴板，请选中译文复制 | Clipboard unavailable. Select and copy the translation | 侧栏 / 用户脚本文本工具 | 依文案修正输入或查看详情 |
| `mal` / 界面局部校验或上游错误（无独立码） | 文本 / 字幕文件操作失败；`extension/sidepanel/text-form.js:150` | 此设备无法朗读 | Speech is unavailable on this device | 侧栏 / 用户脚本文本工具 | 依文案修正输入或查看详情 |
| `maq` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/common.js:22`；`extension/ui/forms/feedback.js:50`；`extension/ui/forms/index.js:24` | 操作失败 | Operation failed | 设置 | 检查网络后重试；保留原文 |
| `mb5` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:7` | 未获得网站访问权限，功能保持关闭。 | Site access was not granted. The feature stays off. |  | 显式重新开启并授权；拒绝保持关闭 |
| `mbb` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:7` | 未选择 AI 服务，请先在设置里添加。 | No AI service selected. Add one in Settings first. |  | 依文案修正输入或查看详情 |
| `mbf` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:25` | ，失败时发给$1 | , or $1 if it fails |  | 检查网络后重试；保留原文 |
| `mbg` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:25` | 失败时直接报错，不转发到免费端点。 | Failures are reported directly, without forwarding to free endpoints. |  | 检查网络后重试；保留原文 |
| `mbu` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:26` | 此设备未同步；配置与 API 密钥保存在本机。 | Sync is off on this device. Settings and API keys stay here. | 设置 | 按文案检查设置 / 更换服务 |
| `mby` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:31` | 站点规则 JSON 格式无效 | Invalid site rules JSON | 设置 | 依文案修正输入或查看详情 |
| `mc0` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:33` | 漫画站点钩子注册失败 | Could not register the comic site hook | 设置 | 检查网络后重试；保留原文 |
| `mc2` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:34` | 此平台不能查看语言包 | Language packs cannot be viewed on this platform | 设置 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `mc4` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:39` | API 密钥含有非法字符 | The API key contains invalid characters | 设置 | 按文案检查设置 / 更换服务 |
| `mc7` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:42` | 密钥含有非法字符 | The key contains invalid characters | 设置 | 按文案检查设置 / 更换服务 |
| `mce` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:48` | 未获得服务访问权限。 | Service access was not granted. | 设置 | 显式重新开启并授权；拒绝保持关闭 |
| `mcg` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:50` | 获取失败 | Could not retrieve data | 设置 | 检查网络后重试；保留原文 |
| `mci` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:51` | 接口没有返回有效的翻译 JSON | The service did not return valid translation JSON | 设置 | 按文案检查设置 / 更换服务 |
| `mck` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:53` | 测试失败 | Test failed | 设置 | 检查网络后重试；保留原文 |
| `mcl` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:54` | 此平台不能直接测试机器翻译 | This platform cannot test machine translation directly | 设置 | 依文案修正输入或查看详情 |
| `mcx` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:65` | 浏览器未允许复制；文本已选中，请用系统复制。 | Clipboard access denied. Text selected; use the system copy command. | 设置 | 显式重新开启并授权；拒绝保持关闭 |
| `md2` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:70` | 配置文件过大 | Configuration file is too large | 设置 | 按文案检查设置 / 更换服务 |
| `md3` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:71` | 此平台未提供清理缓存操作 | Cache clearing is unavailable on this platform | 设置 | 依文案修正输入或查看详情 |
| `md6` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:73` | 读取更新后的配置失败 | Could not read updated settings | 设置 | 按文案检查设置 / 更换服务 |
| `mde` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/interactions.js:12` | 未获得服务访问权限，配置没有保存。 | Service access was not granted. Settings were not saved. | 设置 | 按文案检查设置 / 更换服务 |
| `mdt` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/interactions.js:12` | 操作没有完成，请检查设置。 | The operation did not finish. Check Settings. | 设置 | 依文案修正输入或查看详情 |
| `mdz` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/layout.js:14` | 免费模型有每分钟和每日限额；自动备选不能绕过账号限额。未点击获取或测试前不会联网。 | Free models have per-minute and daily limits. Fallbacks do not bypass account limits. No connection is made until you get models or test. | 设置 | 按文案检查设置 / 更换服务 |
| `meb` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/layout.js:30` | 失败时自动换另一家免费引擎 | Try the other free engine on failure | 设置 | 检查网络后重试；保留原文 |
| `meh` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/layout.js:37` | 机器翻译先显示，AI 服务随后原位精修；失败时保留机器翻译。 | Machine translation appears first. AI refinement replaces it when ready; failures keep the first translation. | 设置 | 检查网络后重试；保留原文 |
| `mez` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/layout.js:56` | 超时（ms） | Timeout (ms) | 设置 | 检查网络后重试；保留原文 |
| `mi3` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/site-rules.js:13` | 站点模式或规则 JSON 无效，例如 example.com/docs/* | Invalid site pattern or rules JSON. Example: example.com/docs/* | 设置 | 依文案修正输入或查看详情 |
| `mi4` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:13` | 网站访问权限已撤销，相关功能和自动翻译已关闭，需要时可重新打开。 | Site access was revoked, so related features and automatic translation are off. Turn them on again when needed. | popup / 用户脚本面板 | 显式重新开启并授权；拒绝保持关闭 |
| `mi7` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:15` | 此页面无法翻译 | This page cannot be translated | popup / 用户脚本面板 | 依文案修正输入或查看详情 |
| `miq` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:15` | 无需账号和密钥。网页文字发给微软，失败时发给谷歌。 | No account or key needed. Page text is sent to Microsoft, or Google if it fails. | popup / 用户脚本面板 | 按文案检查设置 / 更换服务 |
| `mix` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:15` | 手机没有工具栏按钮。从 Tampermonkey 菜单打开 DualLens，或在「更多功能」里打开悬浮按钮。 | Phones have no toolbar button. Open DualLens from the Tampermonkey menu, or turn on the floating button under More. | popup / 用户脚本面板 | 依文案修正输入或查看详情 |
| `mj0` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:15` | 操作没有完成，请稍后重试。 | The operation did not finish. Try again later. | popup / 用户脚本面板 | 检查网络后重试；保留原文 |
| `mj4` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup-view.js:15` | ，$1 段没有成功 | , $1 paragraphs failed | popup / 用户脚本面板 | 依文案修正输入或查看详情 |
| `mj6` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/ui/popup.js:7` | 设置读取失败，请重新打开。 | Could not read settings. Reopen the popup. | popup / 用户脚本面板 | 检查网络后重试；保留原文 |
| `mj8` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 漫画开关或源语言无效 | Invalid comic setting or source language | 设置 | 依文案修正输入或查看详情 |
| `mj9` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 字幕设置无效 | Invalid subtitle settings | 设置 | 依文案修正输入或查看详情 |
| `mja` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 翻译方式或机器翻译设置无效 | Invalid translation method or machine translation settings | 设置 | 依文案修正输入或查看详情 |
| `mjc` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 显示模式无效 | Invalid display mode | 设置 | 依文案修正输入或查看详情 |
| `mjd` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 翻译短文本开关无效 | Invalid short-text setting | 设置 | 依文案修正输入或查看详情 |
| `mje` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 译文样式无效 | Invalid translation style | 设置 | 依文案修正输入或查看详情 |
| `mjf` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 提示词设置无效 | Invalid prompt settings | 设置 | 依文案修正输入或查看详情 |
| `mjn` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 悬停快捷键无效 | Invalid hover shortcut | 设置 | 依文案修正输入或查看详情 |
| `mjo` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 输入框设置无效 | Invalid input settings | 设置 | 依文案修正输入或查看详情 |
| `mjp` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 悬浮按钮位置无效 | Invalid floating button position | 设置 | 依文案修正输入或查看详情 |
| `mjq` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 开关设置无效 | Invalid toggle setting | 设置 | 依文案修正输入或查看详情 |
| `mjr` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 自动翻译语言无效 | Invalid automatic translation language | 设置 | 依文案修正输入或查看详情 |
| `mju` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 自定义规则样式无效 | Invalid custom rule style | 设置 | 依文案修正输入或查看详情 |
| `mjv` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 活动接口无效 | Invalid active service | 设置 | 按文案检查设置 / 更换服务 |
| `mjw` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 接口标识重复或类型无效 | Duplicate service identifier or invalid type | 设置 | 按文案检查设置 / 更换服务 |
| `mjx` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 接口名称或模型无效 | Invalid service name or model | 设置 | 按文案检查设置 / 更换服务 |
| `mjy` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 接口地址无效 | Invalid service address | 设置 | 按文案检查设置 / 更换服务 |
| `mk0` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | JSON模式无效 | Invalid JSON mode | 设置 | 依文案修正输入或查看详情 |
| `mk4` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 超时 | Timeout | 设置 | 检查网络后重试；保留原文 |
| `mk6` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:7` | 备选链的接口或模型无效 | Invalid fallback service or model | 设置 | 按文案检查设置 / 更换服务 |
| `mk9` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/validation.js:66` | $1设置无效 | Invalid $1 setting | 设置 | 依文案修正输入或查看详情 |
| `mka` / 界面局部校验或上游错误（无独立码） | 页面状态、权限或脚本资源不可用；`extension/userscript/panel.js:4` | 设置加载失败，请关闭后重试 | Could not load settings. Close and try again | popup / 用户脚本面板 | 检查网络后重试；保留原文 |
| `mkb` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；页面状态、权限或脚本资源不可用；`extension/userscript/settings-resource.js:5` | 设置资源缺失或校验失败，请重新安装用户脚本（从官方 Release 安装，并允许 Tampermonkey 缓存资源）。 | Settings resource is missing or invalid. Reinstall the userscript from the official release and allow Tampermonkey to cache resources. | 设置、popup / 用户脚本面板 | 显式重新开启并授权；拒绝保持关闭 |
| `cacheClearFailed` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/options.js:23` | 缓存清除失败 | Could not clear the cache |  | 检查网络后重试；保留原文 |
| `cacheOperationFailed` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/cache.js:78`；`extension/background/cache.js:122` | 缓存操作失败 | Cache operation failed | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `pdfCacheUnavailable` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/handoff.js:24` | PDF 暂存不可用，请下载后选择本地文件。 | PDF storage is unavailable. Download the file and choose it locally. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `pdfTokenInvalid` / 界面局部校验或上游错误（无独立码） | PDF 打开、获取或翻译失败；`extension/pdf/handoff.js:50` | PDF 打开链接无效，请从原 PDF 标签页重新打开。 | Invalid PDF link. Open it again from the original PDF tab. | PDF 阅读器 | 按文案选择文件 / 安装语言包 / 重试（PDF/OCR 同事维护） |
| `polishEmptyRules` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/site-rules.js:11` | 还没有规则。 | No rules yet. | 设置 | 依文案修正输入或查看详情 |
| `polishWhenPrimaryFails` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/interactions.js:73` | $1失败时 | If $1 fails | 设置 | 检查网络后重试；保留原文 |
| `consentMicrosoftFallback` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/shared/destinations.js:39` | 将使用微软免费翻译，本页文字会发送给微软；失败时改用谷歌。 | DualLens will use Microsoft's free translator. Text on this page will be sent to Microsoft, and to Google if Microsoft fails. | 后台 → 各消费界面 | 检查网络后重试；保留原文 |
| `lookSentFallback` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:23` | 文字发给$1，失败时发给$2 | sent to $1, or $2 if it fails |  | 检查网络后重试；保留原文 |
| `lookFallbackShort` / 界面局部校验或上游错误（无独立码） | ；`extension/ui/components.js:23` | 失败时发给$1 | $1 as fallback |  | 检查网络后重试；保留原文 |
| `uiLanguageInvalid` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；服务配置、网络、响应或任务校验失败；`extension/shared/settings.js:226`；`extension/ui/validation.js:22`；`extension/ui/validation.js:85` | 界面语言无效 | Invalid interface language | 设置、后台 → 各消费界面 | 依文案修正输入或查看详情 |
| `endpointAuth` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:253` | 密钥无效或没有权限（HTTP $1） | The API key is invalid or lacks permission (HTTP $1) | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `endpointNotFound` / 界面局部校验或上游错误（无独立码） | 服务配置、网络、响应或任务校验失败；`extension/background/providers.js:253` | 找不到这个接口（HTTP $1），请检查基础地址 | API endpoint not found (HTTP $1). Check the base URL | 后台 → 各消费界面 | 按文案检查设置 / 更换服务 |
| `testNeedsModel` / 界面局部校验或上游错误（无独立码） | 设置保存、导入导出或字段校验；`extension/ui/forms/index.js:379` | 请先点「获取模型」选择一个模型，或手动填写模型名 | Click “Get models” to choose a model first, or type a model name | 设置 | 按文案检查设置 / 更换服务 |

## throw / reject 路径核对

枚举所有非 vendor JS 的显式 Error/DLError 抛出点（包括内部校验）。上表提供对应文案；未本地化的内部异常只允许分类器固定兜底到达界面。

| 来源 | 源码触发 / 校验 |
| --- | --- |
| `extension/background/comic-sites.js:7` | `if(!/^[a-p]{32}$/.test(extensionId)) throw new Error(l10n('m0'));` |
| `extension/background/comic-sites.js:12` | `if(hosts.has(host) && hosts.get(host)!==site.referer) throw new Error(l10n('m1'));` |
| `extension/background/comics.js:5` | `if (![image,page].every((u) => ['http:','https:'].includes(u.protocol) && !u.username && !u.password)) throw new Error(l10n('m3'));` |
| `extension/background/comics.js:7` | `if (!res.ok) throw new Error(l10n('m4', [res.status]));` |
| `extension/background/comics.js:9` | `if (!['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(mime)) throw new Error(l10n('m5'));` |
| `extension/background/comics.js:14` | `if (size>MAX_BYTES) { await reader.cancel(); throw new Error(l10n('m6')); }` |
| `extension/background/comics.js:28` | `throw new Error(TEXT.permission);` |
| `extension/background/comics.js:58` | `throw new Error(l10n('m9'));` |
| `extension/background/comics.js:65` | `if (!sender.tab \|\| sender.frameId !== 0 \|\| !['jpn','jpn_vert','kor','eng'].includes(msg.lang)) throw new Error(l10n('ma'));` |
| `extension/background/comics.js:70` | `if (msg.slices.length > 64 \|\| !(msg.width>0 && msg.height>0 && msg.width*msg.height<=24e6)) throw new Error(l10n('mb'));` |
| `extension/background/comics.js:72` | `if (urls.length>4) throw new Error(l10n('mc'));` |
| `extension/background/comics.js:74` | `if(s.unsupported) throw new Error(l10n('md'));` |
| `extension/background/comics.js:75` | `if (![2,4,8].includes(s.args?.length) \|\| !s.args.every(Number.isFinite) \|\| (s.crop && (s.crop.length!==4 \|\| !s.crop.every(Number.isFinite)))) throw new Error(l10n('me'));` |
| `extension/background/comics.js:76` | `if(s.transform && (s.transform.length!==6 \|\| !s.transform.every(Number.isFinite))) throw new Error(l10n('mf'));` |
| `extension/background/handlers.js:36` | `if (!profile) throw new DLError(ERR.CONFIG, l10n('mg', [id]));` |
| `extension/background/handlers.js:43` | `if (!text.trim()) throw new DLError(ERR.CONFIG, l10n('mh'));` |
| `extension/background/handlers.js:44` | `if (text.length > MAX_TEXT_CHARS) throw new DLError(ERR.CONFIG, l10n('mi', [MAX_TEXT_CHARS]));` |
| `extension/background/handlers.js:81` | `if (problem) throw new DLError(ERR.CONFIG, problem);` |
| `extension/background/handlers.js:96` | `if(parsed.missing.length) throw new DLError(ERR.PARSE,l10n('mj'));` |
| `extension/background/mt.js:139` | `try { return JSON.parse(text); } catch { throw new DLError(ERR.PARSE, l10n('mu')); }` |
| `extension/background/mt.js:143` | `if (!Array.isArray(list) \|\| list.length !== n) throw new DLError(ERR.PARSE, l10n('mv'));` |
| `extension/background/mt.js:207` | `if (timedOut) throw new DLError(ERR.NETWORK, l10n('errTimeout'), {category:'timeout'});` |
| `extension/background/mt.js:208` | `throw new DLError(ERR.NETWORK, l10n('errNetwork'), {category:e.category === 'gm' ? 'gm' : 'network'});` |
| `extension/background/mt.js:252` | `if (!key) throw new DLError(ERR.CONFIG, l10n('my'));` |
| `extension/background/mt.js:274` | `if (!key) throw new DLError(ERR.CONFIG, l10n('mz'));` |
| `extension/background/mt.js:281` | `if (res.status === 456) throw new DLError(ERR.CONFIG, l10n('m10'), { status: 456,category:'quota',group:'common' });` |
| `extension/background/mt.js:397` | `if (!isMtEngine(engine)) throw new DLError(ERR.CONFIG, l10n('m14'));` |
| `extension/background/mt.js:403` | `if (!result \|\| result.error) throw new DLError(result?.error?.code \|\| ERR.PROVIDER, result?.error?.message \|\| l10n('m15'), result?.error);` |
| `extension/background/providers.js:168` | `try { event = JSON.parse(data); } catch { throw new DLError(ERR.PARSE, l10n('m1i')); }` |
| `extension/background/providers.js:171` | `if (delta?.refusal \|\| event.choices?.[0]?.finish_reason === 'content_filter') throw new DLError(ERR.PROVIDER, l10n('errRefused'), {category:'refused',service:serviceName(profile)});` |
| `extension/background/providers.js:175` | `if (content.length > 4 * 1024 * 1024) throw new DLError(ERR.PARSE, l10n('m1k'));` |
| `extension/background/providers.js:227` | `if (!done && !finished) throw new DLError(ERR.PROVIDER, l10n('m1l'), { status: 502 });` |
| `extension/background/providers.js:234` | `if (timedOut) throw new DLError(ERR.NETWORK, l10n('m1m', [Math.round(limit / 1000)]), {category:'timeout',service:serviceName(profile)});` |
| `extension/background/providers.js:235` | `throw new DLError(ERR.NETWORK, l10n('errNetwork'), {category:e.category === 'gm' ? 'gm' : 'network',service:serviceName(profile)});` |
| `extension/background/providers.js:286` | `if (model === 'mock-error') throw new DLError(ERR.PROVIDER, l10n('m1r'));` |
| `extension/background/providers.js:291` | `return JSON.stringify({t:data.t.map(t=>'【译】'+t)}); } catch { throw new DLError(ERR.PARSE,l10n('m1t')); }` |
| `extension/background/providers.js:303` | `if (problem) throw new DLError(ERR.CONFIG, problem);` |
| `extension/background/providers.js:304` | `if (profile.requiresKey && !profile.apiKey) throw new DLError(ERR.CONFIG, l10n('m1w'));` |
| `extension/background/providers.js:332` | `if (json?.choices?.[0]?.message?.refusal \|\| json?.choices?.[0]?.finish_reason === 'content_filter') throw new DLError(ERR.PROVIDER, l10n('errRefused'), {category:'refused',service:serviceName(profile)});` |
| `extension/background/providers.js:334` | `if (content == null) throw new DLError(ERR.PARSE, l10n('m1y'));` |
| `extension/background/providers.js:347` | `if (problem) throw new DLError(ERR.CONFIG, problem);` |
| `extension/background/providers.js:357` | `if (!Array.isArray(list)) throw new DLError(ERR.PARSE, l10n('m1z'));` |
| `extension/background/translator.js:57` | `throw new DLError(ERR.CONFIG, l10n('m28'));` |
| `extension/background/translator.js:263` | `if(parsed.invalidJSON) throw new DLError(ERR.PARSE,l10n('mj'),{serverCode:'invalid_translation'});` |
| `extension/background/translator.js:274` | `throw new DLError(ERR.PROVIDER,l10n('m2b'),{status:502,serverCode:'untranslated_items'});` |
| `extension/background/translator.js:580` | `if (!result) throw new DLError(ERR.PROVIDER, l10n('m2e'));` |
| `extension/background/translator.js:581` | `if (result.error) throw new DLError(result.error.code, result.error.message);` |
| `extension/content/comics/controller.js:87` | `if(!this.platform.comics?.recognize) throw new Error(l10n('m2f'));` |
| `extension/content/comics/controller.js:90` | `if(!recognized.ok) throw new Error(recognized.error?.message \|\| l10n('m2f'));` |
| `extension/content/comics/panel.js:28` | `try { if(await onEnableCanvas()) {api.setStatus(l10n('m31'));enable.remove();} else throw new Error(l10n('m32')); }` |
| `extension/content/comics/panel.js:75` | `if(!result.ok) throw new Error(result.error?.message \|\| l10n('m39'));` |
| `extension/content/comics/runtime-resources.js:12` | `if(typeof text!=='string') throw new Error(l10n('m3e'));` |
| `extension/content/comics/runtime-resources.js:14` | `if(bytes.byteLength!==spec.bytes) throw new Error(l10n('m3f'));` |
| `extension/content/comics/runtime-resources.js:17` | `if(hex!==spec.sha256) throw new Error(l10n('m3g'));` |
| `extension/content/comics/sites.js:3` | `if(!Array.isArray(values) \|\| values.length>50) throw new Error(l10n('m3k'));` |
| `extension/content/comics/sites.js:5` | `if(typeof value!=='string') throw new Error(l10n('m3l'));` |
| `extension/content/comics/sites.js:7` | `if(site.length>253 \|\| !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(site) \|\| site.includes('..')) throw new Error(l10n('m3m'));` |
| `extension/content/comics/sites.js:12` | `if(!value \|\| typeof value!=='object' \|\| Array.isArray(value)) throw new Error(l10n('m3n'));` |
| `extension/content/comics/sites.js:15` | `if(!Array.isArray(value.imageHosts) \|\| !value.imageHosts.length \|\| value.imageHosts.length>8) throw new Error(l10n('m3o'));` |
| `extension/content/comics/sites.js:17` | `if(entry.imageHosts.some(h=>h.startsWith('*.'))) throw new Error(l10n('m3p'));` |
| `extension/content/comics/sites.js:19` | `if(!['http:','https:'].includes(url.protocol) \|\| url.username \|\| url.password \|\| url.search \|\| url.hash \|\| url.pathname!=='/' \|\| !matches(url.hostname,host)) throw new Error(l10n('m3q'));` |
| `extension/content/comics/userscript-ocr.js:22` | `const spec=LANGUAGES[lang];if(!spec) throw new Error(l10n('m3r'));` |
| `extension/content/comics/userscript-ocr.js:66` | `if(cancelled) {bitmap.close();throw new Error(l10n('m3y'));}` |
| `extension/content/comics/userscript-ocr.js:67` | `if(bitmap.width*bitmap.height>24e6) throw new Error(l10n('m3z'));` |
| `extension/content/subtitles/files.js:3` | `const invalid = () => { throw new Error(l10n('m5y')); };` |
| `extension/content/subtitles/files.js:21` | `if (typeof text !== 'string' \|\| new TextEncoder().encode(text).length > MAX_SUBTITLE_BYTES) throw new Error(l10n('m5z'));` |
| `extension/content/subtitles/json3.js:36` | `if (!data \|\| !Array.isArray(data.events) \|\| data.events.length > MAX_EVENTS) throw new Error(l10n('m60'));` |
| `extension/content/subtitles/json3.js:46` | `if (event.segs.length > 5000) throw new Error(l10n('m61'));` |
| `extension/content/subtitles/json3.js:73` | `if (list.length > 10000) throw new Error(l10n('m62'));` |
| `extension/content/subtitles/observe.js:35` | `if (!url) throw new Error(l10n('m63'));` |
| `extension/content/subtitles/observe.js:44` | `throw new Error(l10n('m64'));` |
| `extension/content/subtitles/observe.js:55` | `if (bytes > 4 * 1024 * 1024) throw new Error(l10n('m65'));` |
| `extension/content/subtitles/observe.js:64` | `if (!url) throw new Error(l10n('m63'));` |
| `extension/content/subtitles/observe.js:67` | `throw new Error(l10n('m66'));` |
| `extension/offscreen/detector.js:5` | `if (width*height > 1e6) throw new Error(l10n('m68'));` |
| `extension/offscreen/language-store.js:26` | `if (data.byteLength !== spec.bytes) throw new Error(l10n('m3s'));` |
| `extension/offscreen/language-store.js:29` | `if (hex !== spec.sha256) throw new Error(l10n('m6b'));` |
| `extension/offscreen/language-store.js:33` | `if (!spec) throw new Error(l10n('m3r'));` |
| `extension/offscreen/language-store.js:41` | `if (!res.ok) throw new Error(l10n('m6c', [res.status]));` |
| `extension/offscreen/language-store.js:46` | `if (size > spec.bytes) { await reader.cancel(); throw new Error(l10n('m3s')); }` |
| `extension/offscreen/ocr-worker.js:8` | `if (!['eng','jpn','jpn_vert','kor'].includes(lang)) throw new Error('Unknown OCR language');` |
| `extension/offscreen/ocr-worker.js:18` | `if (!record) throw new Error('Missing verified language');` |
| `extension/offscreen/ocr-worker.js:23` | `if (u.origin !== self.location.origin) throw new Error('Remote OCR runtime disabled');` |
| `extension/offscreen/ocr-worker.js:29` | `if(name!=='tesseract-core-simd-lstm.wasm') throw new Error('Unexpected OCR runtime file');` |
| `extension/offscreen/ocr.js:28` | `if (typeof base64 !== 'string' \|\| base64.length > 24*1024*1024) throw new Error(l10n('m6d'));` |
| `extension/offscreen/ocr.js:47` | `if (cancelled) { bitmap.close(); throw new Error(l10n('m3y')); }` |
| `extension/offscreen/ocr.js:52` | `if (!(width > 0 && height > 0) \|\| width*height > 24e6 \|\| bitmaps.some((b) => b.width*b.height>24e6)) throw new Error(l10n('m6e'));` |
| `extension/offscreen/ocr.js:59` | `const bitmap = bitmaps[slice.index]; if (!bitmap) throw new Error(l10n('me'));` |
| `extension/offscreen/ocr.js:66` | `else throw new Error(l10n('m6f'));` |
| `extension/offscreen/ocr.js:76` | `if (cancelled) { await worker.terminate(); throw new Error(l10n('m3y')); }` |
| `extension/offscreen/ocr.js:87` | `if(cancelled) throw new Error(l10n('m3y'));` |
| `extension/offscreen/ocr.js:121` | `if (!manifest[msg.lang]) throw new Error(l10n('m3r'));` |
| `extension/pdf/handoff.js:50` | `if (!valid(token)) throw new Error(l10n('pdfTokenInvalid'));` |
| `extension/pdf/handoff.js:55` | `if (!value \|\| value.expires <= now()) throw new Error(l10n('pdfTokenExpired'));` |
| `extension/pdf/source.js:6` | `if (!data.byteLength \|\| data.byteLength > MAX_PDF_BYTES) throw new Error(l10n('m6k'));` |
| `extension/pdf/source.js:8` | `if (!header.includes('%PDF-')) throw new Error(l10n('m6l'));` |
| `extension/pdf/source.js:13` | `if (!url) throw new Error(l10n('m6m'));` |
| `extension/pdf/source.js:15` | `throw new Error(l10n('m6n'));` |
| `extension/pdf/source.js:22` | `if (!r.ok) throw new Error(l10n('m6o'));` |
| `extension/pdf/source.js:23` | `if (Number(r.headers.get('content-length')) > MAX_PDF_BYTES) throw new Error(l10n('m6k'));` |
| `extension/pdf/source.js:32` | `if (size > MAX_PDF_BYTES) throw new Error(l10n('m6k'));` |
| `extension/pdf/viewer.js:814` | `if (pdf.numPages > 2000) { await task.destroy(); pdf = null; throw new Error(l10n('m7d')); }` |
| `extension/pdf/viewer.js:868` | `if (file.size > MAX_PDF_BYTES) throw new Error('too large');` |
| `extension/platform/extension.js:26` | `if (!url) throw new Error(l10n('m63'));` |
| `extension/platform/extension.js:35` | `if (!result.ok) throw new Error(result.error?.message \|\| l10n('m7m'));` |
| `extension/platform/extension.js:49` | `if (typeof document !== 'undefined') return Promise.reject(new Error('HTTP requires the extension service worker'));` |
| `extension/platform/http.js:51` | `if (!['http:', 'https:'].includes(target.protocol) \|\| target.username \|\| target.password) throw new Error('Invalid URL');` |
| `extension/platform/http.js:83` | `if (text.length > 4 * 1024 * 1024) throw new Error('Response too large');` |
| `extension/platform/userscript.js:38` | `if (!url) return Promise.reject(new Error(l10n('m63')));` |
| `extension/shared/configcrypto.js:13` | `if (!id \|\| ['__proto__', 'prototype', 'constructor'].includes(id) \|\| typeof secret?.apiKey !== 'string') throw new Error(l10n('m7q'));` |
| `extension/shared/configcrypto.js:29` | `if (!/^[A-Za-z0-9_-]+$/.test(text) \|\| text.length % 4 === 1) throw new Error(l10n('m7r'));` |
| `extension/shared/configcrypto.js:36` | `if ([...password].length < 8) throw new Error(l10n('m7s'));` |
| `extension/shared/configcrypto.js:38` | `if (plaintext.length > MAX_BYTES) throw new Error(l10n('m7t'));` |
| `extension/shared/configcrypto.js:50` | `if (typeof text !== 'string' \|\| text.length > MAX_BYTES * 2) throw new Error(l10n('m7u'));` |
| `extension/shared/configcrypto.js:53` | `if (!data \|\| typeof data !== 'object' \|\| Array.isArray(data)) throw new Error(l10n('m7r'));` |
| `extension/shared/configcrypto.js:56` | `if (!password) throw new Error(l10n('m7v'));` |
| `extension/shared/configcrypto.js:59` | `if (bytes.length < 45 \|\| bytes.length > MAX_BYTES + 44) throw new Error(l10n('m7r'));` |
| `extension/shared/configcrypto.js:64` | `if (!data?.settings \|\| typeof data.settings !== 'object' \|\| Array.isArray(data.settings)) throw new Error(l10n('m7r'));` |
| `extension/shared/configcrypto.js:66` | `} catch { throw new Error(l10n('m7w')); }` |
| `extension/shared/destinations.js:46` | `if (destination) throw new DLError(ERR.CONFIRMATION_REQUIRED, destinationMessage(destination), {destination});` |
| `extension/shared/presets.js:26` | `if (!p) throw new Error(l10n('m8q'));` |
| `extension/shared/prompt.js:36` | `if(!Array.isArray(list)\|\|list.length!==idMap.size)throw new Error('length');` |
| `extension/shared/settings.js:199` | `if (typeof id !== 'string' \|\| !id \|\| ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error(l10n('m95'));` |
| `extension/shared/settings.js:210` | `if (!localArea) throw new Error(l10n('m96'));` |
| `extension/shared/settings.js:226` | `if (!['zh-CN','en','auto'].includes(s.uiLanguage)) throw new Error(l10n('uiLanguageInvalid'));` |
| `extension/shared/settings.js:233` | `if (!['http:', 'https:'].includes(u.protocol) \|\| u.username \|\| u.password \|\| u.search \|\| u.hash) throw new Error(l10n('m1d'));` |
| `extension/shared/settings.js:239` | `if (!primary \|\| typeof head.model !== 'string' \|\| !head.model.trim()) throw new Error(l10n('m97'));` |
| `extension/shared/settings.js:330` | `if (!storage?.local) throw new Error(l10n('m98'));` |
| `extension/shared/settings.js:390` | `if (!rules \|\| !['always', 'never', 'custom'].every(k => Array.isArray(rules[k]))) throw new Error(l10n('m99'));` |
| `extension/shared/settings.js:391` | `const valid = p => { if (!parsePattern(p)) throw new Error(l10n('m9a')); };` |
| `extension/shared/settings.js:394` | `if (!r \|\| typeof r !== 'object') throw new Error(l10n('m9b'));` |
| `extension/shared/settings.js:396` | `if (r.page != null && !['always', 'never', 'default'].includes(r.page)) throw new Error(l10n('m9c'));` |
| `extension/shared/settings.js:397` | `for (const f of ['selection', 'hover', 'input']) if (r[f] != null && !['on', 'off', 'default'].includes(r[f])) throw new Error(l10n('m9d'));` |
| `extension/shared/settings.js:402` | `if (typeof s.floatBall?.autoHide !== 'boolean') throw new Error(l10n('m9e'));` |
| `extension/shared/settings.js:404` | `!['source-first', 'translation-first'].includes(s.input?.order)) throw new Error(l10n('m9f'));` |
| `extension/shared/settings.js:409` | `c.profileId && !s.provider?.profiles?.some(p => p.id === c.profileId)) throw new Error(l10n('m9g'));` |
| `extension/shared/stream.js:11` | `if (size > 4 * 1024 * 1024) throw new Error('SSE response too large');` |
| `extension/sidepanel/subtitle-form.js:44` | `if (selected.size > MAX_SUBTITLE_BYTES) throw new Error(l10n('m5z'));` |
| `extension/sidepanel/subtitle-form.js:46` | `if (!format) throw new Error(l10n('ma0'));` |
| `extension/ui/forms/index.js:244` | `catch { throw new Error(COPY.s9); }` |
| `extension/ui/forms/index.js:251` | `if (loadingKey) throw new Error(COPY.s10);` |
| `extension/ui/forms/index.js:256` | `if(platform.kind==='extension' && !await requestMTOrigin(next.translation.mt.engine,platform.permissionAPI))throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:258` | `if(chosen?.baseUrl && platform.kind==='extension' && !await requestOrigin(chosen.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:259` | `if(platform.kind==='extension' && (next.siteRules.always.length \|\| next.siteRules.custom.some(r=>r.page==='always'\|\|['selection','hover','input'].some(f=>r[f]==='on')) \|\| next.autoTranslateLangs.length) && !await requestBroad(platform.permissionAPI)) throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:265` | `if(registration && !registration.ok) throw new Error(registration.error?.message \|\| COPY.s11);` |
| `extension/ui/forms/index.js:290` | `const deleted=await platform.comics.languages(pack.lang);if(!deleted.ok)throw new Error(COPY.s16);row.remove();` |
| `extension/ui/forms/index.js:302` | `if (typeof key !== 'string' \|\| /[^\x20-\x7e]/.test(key.trim())) throw new Error(COPY.s18);` |
| `extension/ui/forms/index.js:312` | `if (typeof key !== 'string' \|\| /[^ -~]/.test(key.trim())) throw new Error(COPY.s21);` |
| `extension/ui/forms/index.js:347` | `const preset = read('providerPreset'); if (!preset) throw new Error(COPY.s25);` |
| `extension/ui/forms/index.js:360` | `if (platform.kind==='extension' && p?.baseUrl && !await requestOrigin(p.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:363` | `if (dirty) throw new Error(COPY.s29);` |
| `extension/ui/forms/index.js:364` | `const r = await service().listModels(pid); if (!r.ok) throw new Error(r.error?.message \|\| COPY.s30); models = r.models; normalized = r.baseUrl;` |
| `extension/ui/forms/index.js:379` | `if (!p?.model) throw new Error(l10n('testNeedsModel'));` |
| `extension/ui/forms/index.js:387` | `if (platform.kind==='extension' && p?.baseUrl && !await requestOrigin(p.baseUrl,platform.permissionAPI)) throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:392` | `if (parsed.results.size!==2 \|\| parsed.missing.length \|\| parsed.invalidJSON \|\| !sample) throw new Error(COPY.s32);` |
| `extension/ui/forms/index.js:395` | `if (dirty) throw new Error(COPY.s33);` |
| `extension/ui/forms/index.js:396` | `const r = await service().testProvider(pid); if (!r.ok) throw new Error(r.error?.message \|\| COPY.s34);` |
| `extension/ui/forms/index.js:401` | `if (!mtProbe) throw new Error(COPY.s35);` |
| `extension/ui/forms/index.js:403` | `if(platform.kind==='extension'&&!await requestMTOrigin(engine,platform.permissionAPI))throw new Error(COPY.s28);` |
| `extension/ui/forms/index.js:425` | `if (!password) throw new Error(COPY.s41);` |
| `extension/ui/forms/index.js:441` | `const text = read('backupText'); if (!text) throw new Error(COPY.s44);` |
| `extension/ui/forms/index.js:462` | `if (!text.startsWith('duallens-config:v1:')) throw new Error(COPY.s51);` |
| `extension/ui/forms/index.js:469` | `if (file.size > 2 * 1024 * 1024) throw new Error(COPY.s52);` |
| `extension/ui/forms/index.js:474` | `if (!platform.clearCache) throw new Error(COPY.s53);` |
| `extension/ui/forms/qrcode.js:7` | `catch { throw new Error(l10n('mi1')); }` |
| `extension/ui/forms/qrcodegen.js:380` | `default: throw new Error("Unreachable");` |
| `extension/ui/forms/qrcodegen.js:619` | `throw new Error("Assertion error");` |
| `extension/ui/options.js:23` | `if (!res.ok) throw new Error(res.error?.message \|\| t('cacheClearFailed'));` |
| `extension/ui/popup.js:29` | `if(!result?.ok)throw new Error(result?.error?.message\|\|TEXT.failed);` |
| `extension/ui/validation.js:12` | `function requireThat(ok, message) { if (!ok) throw new Error(message); }` |
| `extension/userscript/settings-resource.js:17` | `if (typeof source !== 'string' \|\| !source) throw new Error();` |
| `extension/userscript/settings-resource.js:19` | `if (bytes.length !== spec.bytes \|\| await sha256Digest(bytes) !== spec.sha256) throw new Error();` |
| `extension/userscript/settings-resource.js:22` | `if (typeof module?.mountSettingsForm !== 'function') throw new Error();` |
| `extension/userscript/settings-resource.js:25` | `} catch { pending = null; throw new Error(SETTINGS_RESOURCE_ERROR()); }` |

## catch / 日志路径核对

逐点记录 catch / console.warn / console.error 与邻近处理。缓存写入失败、取消、资源释放和能力探测可安静降级；主动操作的失败由对应界面报告。确认异常按拒绝处理，禁止发送。PDF/OCR、字幕及设置的局部兜底仍由各模块拥有者复核。

| 来源 | 现有处理（截取至三行） |
| --- | --- |
| `extension/background/comic-sites.js:38` | `pending=task.catch(()=>{});return task; }}; }` |
| `extension/background/comic-sites.js:58` | `pending=task.catch(()=>{});return task; }}; }` |
| `extension/background/comics.js:55` | `} catch { /* Document is still loading its bundled runtime. */ } await new Promise((resolve)=>setTimeout(resolve,50)); }` |
| `extension/background/frames.js:7` | `catch {return {active:false};} }, async 'frame-publish'(msg,sender) {` |
| `extension/background/frames.js:15` | `try {await api.tabs.sendMessage(sender.tab.id,{type:'frame-state',state:{active,settings,context,confirmedDestinations:acked}});} catch { /* no child listeners */ } return {ok:true}; },` |
| `extension/background/handlers.js:28` | `} catch (e) { return { ok: false, error: toErrorInfo(e) }; }` |
| `extension/background/injection.js:6` | `} catch { return false; } } ` |
| `extension/background/injection.js:11` | `const ready = tabId => api.tabs.sendMessage(tabId, { type: 'tab-ready' }, { frameId: 0 }).catch(() => null); async function inject(tabId) { const tab = await api.tabs.get(tabId);` |
| `extension/background/injection.js:18` | `const state = await api.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 }).catch(() => null); if (state && typeof state.translated === 'boolean') return { ok: true, injected: true }; if (tab.url) return { ok: false, reason: 'restricted' };` |
| `extension/background/injection.js:38` | `const task = inject(tabId).catch(() => ({ ok: false, reason: 'no-access' })).finally(() => pending.delete(tabId)); pending.set(tabId, task); }` |
| `extension/background/media.js:7` | `void api.sidePanel.open({ tabId: tab.id }).catch(() => {}); } else { void api.windows.getCurrent().then(window => api.sidePanel.open({ windowId: window.id })).catch(() => {});` |
| `extension/background/media.js:9` | `void api.windows.getCurrent().then(window => api.sidePanel.open({ windowId: window.id })).catch(() => {}); } };` |
| `extension/background/mt.js:139` | `try { return JSON.parse(text); } catch { throw new DLError(ERR.PARSE, l10n('mu')); } } ` |
| `extension/background/mt.js:204` | `} catch (e) { if(e?.code===ERR.CONFIRMATION_REQUIRED)throw e; if (job.signal?.aborted) throw cancelledError();` |
| `extension/background/mt.js:227` | `} catch { /* keep the default lifetime */ } token = { value, exp }; return value;` |
| `extension/background/mt.js:324` | `} catch (e) { if (isCancelled(e)\|\|e?.code===ERR.CONFIRMATION_REQUIRED) throw e; lastError = e;` |
| `extension/background/mt.js:388` | `} catch (e) { failure = e; } } };` |
| `extension/background/pdf.js:9` | `try { return /\.pdf$/i.test(new URL(value).pathname); } catch { return false; } } export function isPDFType(value) { return /^application\/pdf\s*(?:;\|$)/i.test(value \|\| ''); }` |
| `extension/background/pdf.js:27` | `} catch { /* A failed HEAD gets one bounded Range GET; failed GET declines. */ } finally { clearTimeout(timer);` |
| `extension/background/pdf.js:30` | `if (response?.body) void response.body.cancel().catch(() => {}); ctrl.abort(); }` |
| `extension/background/pdf.js:57` | `} catch { if(token)await handoff.remove(token); return {ok:false,error:{code:'pdf_source',message:TEXT.permission}};` |
| `extension/background/permissions.js:77` | `pending = task.catch(() => {}); return task; } };` |
| `extension/background/providers.js:36` | `} catch { return l10n('m1b'); }` |
| `extension/background/providers.js:81` | `} catch { msg = String(bodyText ?? ''); }` |
| `extension/background/providers.js:113` | `try { return new URL(profile.baseUrl).origin === 'https://openrouter.ai'; } catch { return false; } } ` |
| `extension/background/providers.js:168` | `try { event = JSON.parse(data); } catch { throw new DLError(ERR.PARSE, l10n('m1i')); } if (event.error) throw httpError(profile, {status:502,text:JSON.stringify(event),retryAfter:null}, event); const delta = event.choices?.[0]?.delta;` |
| `extension/background/providers.js:215` | `} catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); } text = '';` |
| `extension/background/providers.js:231` | `} catch (e) { if (signal && signal.aborted) throw cancelledError(); if (e instanceof DLError) throw e;` |
| `extension/background/providers.js:264` | `try { json = JSON.parse(res.text); } catch { /* Discard the payload; errors use authored catalogue copy. */ } if (res.status < 200 \|\| res.status >= 300) throw httpError(profile, res, json); if (isHtml(res) \|\| json === undefined) throw badJSON(profile, res);` |
| `extension/background/providers.js:291` | `return JSON.stringify({t:data.t.map(t=>'【译】'+t)}); } catch { throw new DLError(ERR.PARSE,l10n('m1t')); } } if (!/<seg\s+id=/.test(text)) return `【译】${text}`;` |
| `extension/background/service-worker.js:78` | `} catch { return { ok: false, error: { code: 'unsupported', get message(){return l10n('m20');} } }; } }; function syncPermissions() {` |
| `extension/background/service-worker.js:83` | `getDefaultSettingsStore().onChange(() => { void syncPermissions().catch(() => {}); }); chrome.permissions.onAdded.addListener(() => { void syncPermissions().catch(() => {}); }); chrome.permissions.onRemoved.addListener(() => { void syncPermissions().catch(() => {}); });` |
| `extension/background/service-worker.js:84` | `chrome.permissions.onAdded.addListener(() => { void syncPermissions().catch(() => {}); }); chrome.permissions.onRemoved.addListener(() => { void syncPermissions().catch(() => {}); }); void syncPermissions().catch(() => {});` |
| `extension/background/service-worker.js:85` | `chrome.permissions.onRemoved.addListener(() => { void syncPermissions().catch(() => {}); }); void syncPermissions().catch(() => {}); ` |
| `extension/background/service-worker.js:86` | `void syncPermissions().catch(() => {});  // A pending fetch alone does not stop Chrome from stopping an idle worker after ~30s; any` |
| `extension/background/service-worker.js:95` | `chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000); }` |
| `extension/background/service-worker.js:121` | `} catch { open = false; }` |
| `extension/background/service-worker.js:146` | `.catch((e) => { // unexpected failure: give every item that has no answer yet an error so the page is not left pending const error = toErrorInfo(e);` |
| `extension/background/service-worker.js:186` | `.catch((e) => sendResponse({ ok: false, error: toErrorInfo(e) })) .finally(release); return true;` |
| `extension/background/service-worker.js:196` | `return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => null); } ` |
| `extension/background/service-worker.js:220` | `menuUpdate = menuUpdate.catch(() => {}).then(async () => { const settings = await loadSettings();setUiLanguage(settings.uiLanguage); await new Promise(resolve => chrome.contextMenus.removeAll(() => {` |
| `extension/background/subtitles.js:31` | `} catch { return { ok: false, error: { code: 'network', get message(){return l10n('m27');} } }; } finally { clearTimeout(timer); if (active.get(key) === controller) active.delete(key); } },` |
| `extension/background/translator.js:86` | `try { onCacheChecked?.(hits); } catch { /* the hook must not break translation */ } }; try {` |
| `extension/background/translator.js:113` | `} catch { /* a failing consumer must not break translation */ }` |
| `extension/background/translator.js:165` | `} catch { /* cache trouble is treated as a miss */ }` |
| `extension/background/translator.js:189` | `} catch { /* a full or unavailable cache must not fail the translation */ }` |
| `extension/background/translator.js:280` | `} catch (e) { if(e?.serverCode==='untranslated_items' && batch.length>1)return retryLost(batch.filter(u=>!u.completed)); if (!isCancelled(e)) failUnits(batch, toErrorInfo(e));` |
| `extension/background/translator.js:319` | `} catch (e) { failUnits(list, toErrorInfo(e)); }` |
| `extension/background/translator.js:367` | `} catch { /* cache trouble is treated as a miss */ } } const misses = texts.filter(t => !answered.has(t));` |
| `extension/background/translator.js:381` | `.then(entries => cache.putMany(entries, cacheOpts)).catch(() => {})); } },` |
| `extension/background/translator.js:391` | `try { onPartial(list); } catch { /* a failing consumer must not break translation */ } }; }` |
| `extension/background/translator.js:420` | `} catch (e) { if (!(isCancelled(e) \|\| signal?.aborted)) throw e; return;` |
| `extension/background/translator.js:488` | `.catch((e) => { if (isCancelled(e) \|\| mtCtrl.signal.aborted) return; onMtAnswer([...texts].map(text => ({ text, error: toErrorInfo(e) })));` |
| `extension/content/comics/canvas-hook-runtime.js:30` | `} catch { /* Observing metadata must never change the page's native draw behavior. */ } return result; };` |
| `extension/content/comics/canvas-hook.js:30` | `} catch { /* Observing metadata must never change the page's native draw behavior. */ } return result; };` |
| `extension/content/comics/capabilities.js:7` | `} catch { return { ok: false, get reason(){return l10n('m2g');} }; } } ` |
| `extension/content/comics/capabilities.js:13` | `try { u = new URL(url); } catch { reject(new Error(l10n('m3'))); return; } if (!['http:','https:'].includes(u.protocol) \|\| u.username \|\| u.password) { reject(new Error(l10n('m3'))); return; } let handle;` |
| `extension/content/comics/controller.js:37` | `} catch { /* Page metadata is untrusted. */ } }; element.addEventListener('duallens-comic-source',receive);` |
| `extension/content/comics/controller.js:104` | `} catch(error) { if(alive()) panel.setStatus(error.message,true); } finally { entry.running=false;if(alive()) panel.busy(false); } }` |
| `extension/content/comics/discovery.js:7` | `} catch { return ''; } } ` |
| `extension/content/comics/panel.js:29` | `catch(e) {api.setStatus(e.message,true);enable.disabled=false;} }); details.append(enable);` |
| `extension/content/comics/panel.js:81` | `} catch(e) { api.setStatus(e.message,true); } }); return api;` |
| `extension/content/comics/runtime-resources.js:27` | `} catch { /* Unsupported resource API or failed integrity: use the pinned verified fallback. */ } const key='runtime:'+spec.name; const cached=(await storage.get(key))[key];` |
| `extension/content/comics/runtime-resources.js:31` | `try {return await verifyRuntime(cached,spec);} catch {await storage.remove(key);} } const bytes=await new Promise((resolve,reject)=> {` |
| `extension/content/comics/runtime-resources.js:46` | `if(!pending) pending=Promise.all(OCR_RESOURCES.map(load)).catch(error=>{pending=null;throw error;}); return pending; };` |
| `extension/content/comics/userscript-ocr.js:29` | `catch { await storage.remove(lang);data=null; } } if(!data) {` |
| `extension/content/comics/userscript-ocr.js:99` | `recognize(blob,options) { const task=work.then(()=>recognize(blob,options));work=task.catch(()=>{});return task; }, async languages(lang) { if(lang) { if(!LANGUAGES[lang]) return {ok:false};await work;await storage.remove(lang); }` |
| `extension/content/confirmation.js:67` | `job.promise=serial.then(run).catch(()=>false).finally(()=>waiting.delete(key)); serial=job.promise;waiting.set(key,job); }` |
| `extension/content/controller.js:411` | `const det=await Promise.race([Promise.resolve().then(()=>this.platform.detectLanguage(plain.slice(0,400))).catch(()=>null),new Promise(r=>timer=setTimeout(()=>r(null),50))]);clearTimeout(timer); const top=det && det.reliable && det.lang; if(!top) return false;` |
| `extension/content/floatball.js:25` | `try{const got=await this.p.localArea.get(KEY);this.pos=got[KEY]?.[location.hostname]\|\|this.pos;}catch{} if(!this.on\|\|version!==this.rev)return; if(!this.ui)this.#build();this.ui.attach();this.#layout();this.full();this.refresh();` |
| `extension/content/floatball.js:71` | `async#save(){try{const got=await this.p.localArea.get(KEY);await this.p.localArea.set({[KEY]:{...got[KEY],[location.hostname]:this.pos}});}catch{}} #drag(e){ if(e.button!==0\|\|!e.isPrimary)return;e.preventDefault();this.#reveal();const b=this.ball,r=b.getBoundingClientRect();let moved=false,held=false;` |
| `extension/content/frame-agent.js:54` | `const snapshotOnce=()=>{pushed=false;void platform.frameSnapshot().then(next=>{if(!pushed)receive(next);}).catch(()=>receive(null));}; document.addEventListener('visibilitychange',refresh); window.addEventListener('resize',refresh);` |
| `extension/content/frames.js:3` | `try { return win.parent !== win && !!win.parent.document; } catch { return false; } } ` |
| `extension/content/frames.js:67` | `let child;try{child=el.contentDocument;}catch{continue;} if(child?.body && /html/i.test(child.contentType \|\| 'text/html'))add(child); }` |
| `extension/content/hover.js:129` | `}catch{ return null; }` |
| `extension/content/inputbox.js:129` | `try{write();}catch{ /* unsupported strategy: try the next only if unchanged */ } finally{writing(false);} await new Promise(resolve=>setTimeout(resolve,32));` |
| `extension/content/inputbox.js:248` | `try{acc=inputAccessor(el,selected);}catch{toast(UI.s4,'error');return;} // the first two spaces of a triple-space trigger are already in the field let text=selected?acc.text:acc.text.replace(/[  ]+$/,'');` |
| `extension/content/inputbox.js:288` | `}catch(error){errorToast(error,{retry:()=>this.run(el,selected),openSettings:group=>this.p.openSettings(group)});} finally{ observer.disconnect();` |
| `extension/content/inputbox.js:300` | `copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);copy.textContent=UI.s11;}catch{value.select();}}; close.onclick=()=>ui.detach();actions.append(close,copy);box.append(node('p','',UI.s8),value,actions);ui.el.append(box);ui.attach();this.failure=ui; }` |
| `extension/content/loader.js:26` | `} catch { return false; /* stale extension context or blocked resource: stay silent */ } })(); void globalThis[marker].then(ok => {` |
| `extension/content/main.js:86` | `}).catch(() => {}); }); for (const name of Object.values(P.COMMANDS)) this.platform.registerCommand(name, {` |
| `extension/content/main.js:305` | `})().catch((error) => { ready = null; throw error; }); return ready; }` |
| `extension/content/observer.js:238` | `} catch { /* Navigation events and the visible-only fallback still work. */ } } }` |
| `extension/content/overlay.js:65` | `}catch{ /* no popover support: z-index above is enough for ordinary pages */ }` |
| `extension/content/selection.js:66` | `catch{const range=document.createRange();range.selectNodeContents(v.dst);const sel=this.ui.root.getSelection?.()\|\|getSelection();sel.removeAllRanges();sel.addRange(range);v.copy.textContent=UI.selected;} setTimeout(()=>{v.copy.textContent=UI.copy;},1200); });` |
| `extension/content/selection.js:115` | `const res=await this.p.translator().translateText({text:source,to:s.targetLang,from:s.sourceLang\|\|'auto',purpose:'selection',signal:this.abort.signal,...interactionRequest(this.pick)}).catch(()=>({ok:false})); if(token!==this.rev\|\|!this.open)return; if(res.ok){` |
| `extension/content/selection.js:130` | `const res=await this.p.translator().translateText({text:this.r.source,to:s.targetLang,from:s.sourceLang\|\|'auto',purpose:'selection',mode:'llm',signal:this.abort.signal}).catch(()=>({ok:false})); if(token!==this.rev\|\|!this.open)return;v.ai.textContent=UI.refine; if(res.ok){this.#render(res.text);v.ai.hidden=true;}else{v.ai.disabled=false;v.ai.title=UI.kept;}` |
| `extension/content/subtitles/html5.js:73` | `try { list = track.cues; } catch { return; } if (!list?.length \|\| list.length > 10000) { if (this.cues.length) this.reset(); return; } // Rebuild for loaded/replaced/streamed tracks; normal timeupdate is O(1).` |
| `extension/content/subtitles/observe.js:27` | `} catch { /* Older browsers still use the MAIN notification. */ } for (const entry of win.performance.getEntriesByType('resource')) accept(entry.name); win.postMessage({ channel: 'duallens-timedtext-ready' }, win.location.origin);` |
| `extension/content/subtitles/observe.js:43` | `await response.body?.cancel().catch(() => {}); throw new Error(l10n('m64')); }` |
| `extension/content/subtitles/observe.js:59` | `} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); } } ` |
| `extension/content/subtitles/observer-runtime.js:16` | `} catch { /* Ignore malformed URLs without changing the page request. */ } }; const fetch = window.fetch;` |
| `extension/content/subtitles/observer-runtime.js:21` | `catch { /* A hostile URL getter must not prevent the original request. */ } return Reflect.apply(fetch, this, [input, ...args]); };` |
| `extension/content/subtitles/observer.js:15` | `} catch { /* Ignore malformed URLs without changing the page request. */ } }; const fetch = window.fetch;` |
| `extension/content/subtitles/observer.js:20` | `catch { /* A hostile URL getter must not prevent the original request. */ } return Reflect.apply(fetch, this, [input, ...args]); };` |
| `extension/content/subtitles/scheduler.js:63` | `active.done?.finally(finish).catch(() => {}); } stop() { this.stopped = true; this.epoch++; this.active?.cancel(); this.active = null; }` |
| `extension/content/subtitles/track.js:20` | `} catch { return null; } } ` |
| `extension/content/subtitles/youtube.js:72` | `} catch { if (generation === this.generation && this.enabled) { this.status = 'error'; this.url = ''; } } finally { clearTimeout(timeout); }` |
| `extension/content/util.js:41` | `}catch{ return null; }` |
| `extension/content/util.js:73` | `catch{res={ok:false};} if(!cancelled)partial([res.ok?{id:item.id,text:escapeText(res.text),stage:'final'} :{id:item.id,error:{code:res.error?.code\|\|'PROVIDER',message:UI.hoverError}}]);` |
| `extension/offscreen/language-store.js:38` | `catch { await languageRecord(lang,'delete'); } } const res = await fetchImpl(spec.url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) });` |
| `extension/offscreen/ocr.js:127` | `schedule(async()=>{setUiLanguage(msg.uiLanguage);return task();}).then(reply).catch((e) => reply({ ok:false,error:{ code:'ocr_failed',message: /^(语言包\|本地 OCR\|图片\|画布\|不支持\|无法打开\|OCR 语言\|Language pack\|Local OCR\|Image\|Canvas\|Invalid canvas\|Unsupported\|Could not open\|OCR language)/.test(e?.message) ? l10n('m6h', [e.message]) : l10n('m6i') } })); return true;` |
| `extension/pdf/segment-worker.js:20` | `} catch { self.postMessage({ id: data.id, error: l10n('m6j') }); }` |
| `extension/pdf/source.js:39` | `} finally { clearTimeout(timer); ctrl.abort(); await reader?.cancel().catch(() => {}); } }` |
| `extension/pdf/translate.js:106` | `for (const handle of this.handles.keys()) { try { handle.cancel(); } catch { /* already finished */ } } this.handles.clear(); this.entries.clear();` |
| `extension/pdf/translate.js:118` | `try { handle.cancel(); } catch { /* already finished */ } for (const entry of chunk) { this.entries.delete(entry.id); released.push(entry.id); } }` |
| `extension/pdf/translate.js:209` | `} catch (error) { deliver(chunk.map(entry => ({ id: entry.id, error: { code: ERR.NETWORK, message: String(error?.message \|\| error) } }))); closed = true;` |
| `extension/pdf/viewer.js:111` | `catch (error) { segmentJobs.delete(id); reject(error); } }); }` |
| `extension/pdf/viewer.js:123` | `try { const saved = localStorage.getItem(VIEW_KEY); if (VIEWS.includes(saved)) return saved; } catch { /* storage unavailable */ } if (innerWidth < 600) return 'reflow'; return innerWidth < 900 \|\| settings.displayMode === 'translation-only' ? 'translated' : 'side';` |
| `extension/pdf/viewer.js:257` | `if (proxy) setTimeout(() => { try { proxy.cleanup(); } catch { /* document already closed */ } }, 0); page.canvas = page.copy = page.overlay = page.proxy = null; page.atomGeometry = null;` |
| `extension/pdf/viewer.js:279` | `} catch (error) { if (generation === epoch && error?.name !== 'RenderingCancelledException') { page.orig.replaceChildren(placeholder(l10n('m75')));` |
| `extension/pdf/viewer.js:376` | `try { data = context.getImageData(x0, y0, x1 - x0, y1 - y0); } catch { continue; } const dx = x0 / factor, dy = y0 / factor; const rects = block.cover.map(r => ({ left: r.left - dx, right: r.right - dx, top: r.top - dy, bottom: r.bottom - dy }));` |
| `extension/pdf/viewer.js:397` | `} catch { bold = false; } page.bold.set(block.font, bold); }` |
| `extension/pdf/viewer.js:730` | `try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ } hideHighlight(); const columnsChanged = (previous === 'side') !== (view === 'side');` |
| `extension/pdf/viewer.js:835` | `try { await fn(); } catch { if (request === sourceRequest) message(l10n('m7f'), true); }` |
| `extension/platform/cache.js:20` | `}).catch(() => {}); function prune({ maxEntries, ttlMs }) { const cutoff = ttlMs > 0 ? now() - ttlMs : 0;` |
| `extension/platform/cache.js:33` | `writes = writes.then(run, run).catch(() => {}); return writes; }` |
| `extension/platform/extension.js:16` | `catch { return { ok: false, error: { code: ERR.NETWORK, message: l10n('m7l') } }; } }; const platform = {` |
| `extension/platform/extension.js:75` | `} catch { resolve(null); } }); },` |
| `extension/platform/http.js:36` | `catch (error) { finish(reject, error); handle?.abort(); } }; const finish = (fn, value) => {` |
| `extension/platform/http.js:61` | `} catch { finish(reject, new DLError(ERR.NETWORK, 'Network request failed', {category:'gm'})); } }); }` |
| `extension/platform/http.js:89` | `} catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); } }` |
| `extension/platform/port-client.js:49` | `} catch { /* port already gone: nothing left to cancel */ }` |
| `extension/platform/port-client.js:69` | `} catch { return null; }` |
| `extension/platform/port-client.js:88` | `} catch { this.port = null; }` |
| `extension/platform/port-client.js:123` | `} catch { this.port = null; this.#scheduleReconnect();` |
| `extension/platform/port-client.js:170` | `} catch { /* ignore */ }` |
| `extension/platform/storage.js:27` | `writes = result.catch(() => {}); return result; }` |
| `extension/platform/userscript.js:51` | `} catch(e) { return { ok:false,error:{ code:'image_unavailable',message:e.message } }; } }, languages: (lang) => ocr.languages(lang),` |
| `extension/platform/userscript.js:100` | `} catch { platform.showResourceError(); } }; platform.openSettings = group => { platform.settingsGroup = group \|\| 'common'; void openPanel('settings'); };` |
| `extension/platform/userscript.js:112` | `} catch { // CSP / Trusted Types can reject MAIN installation. The passive resource // observer remains usable; this must not prevent the whole app from booting.` |
| `extension/platform/userscript.js:157` | `}).catch((e) => { if (!ctrl.signal.aborted) onPartial(req.items.filter((i) => !seen.has(i.id)).map((i) => ({ id: i.id, error: toErrorInfo(e) }))); });` |
| `extension/shared/configcrypto.js:66` | `} catch { throw new Error(l10n('m7w')); } } ` |
| `extension/shared/device-state.js:35` | `} catch { return null; }` |
| `extension/shared/device-state.js:45` | `} catch { return false; }` |
| `extension/shared/errors.js:66` | `} catch { return ''; } } ` |
| `extension/shared/i18n.js:76` | `const off = store.onChange?.(() => { void refresh().catch(() => {}); }); await refresh(); return () => { closed = true; off?.(); };` |
| `extension/shared/identifiers.js:16` | `} catch { return false; } }` |
| `extension/shared/pdf-url.js:6` | `} catch { return ''; } }` |
| `extension/shared/permissions.js:21` | `} catch { return null; }` |
| `extension/shared/prompt.js:33` | `let data;try{data=JSON.parse(text);}catch{data=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));} parsedJSON=true; const list=Array.isArray(data)?data:data.t;` |
| `extension/shared/prompt.js:38` | `}catch{ if(parsedJSON)return{results:new Map(),missing:[...idMap.values()],invalidJSON:false}; // Legacy reply compatibility only; outgoing requests always use JSON.` |
| `extension/shared/settings.js:215` | `serial = next.catch(() => {}); return next; };` |
| `extension/shared/settings.js:254` | `catch { status.reason = 'quota-or-unavailable'; } } // The mode marker is device-local. Keep the last valid sync config for other devices.` |
| `extension/shared/settings.js:281` | `} catch { status = { synced: false, reason: 'unavailable' }; } } const combined = got['settings.core'] ? combine(got) : {...structuredClone(DEFAULT_SETTINGS),targetLang:defaultTargetLanguage(browserLanguage)};` |
| `extension/shared/site-adapters.js:26` | `!img.closest('aside,nav,[role="complementary"]'); } catch { return false; } }); }` |
| `extension/shared/site-pattern.js:12` | `try { host = new URL('http://' + rawHost).hostname; } catch { return null; } // Reject URL parser rewrites such as shortened/hex IPv4 addresses. if (host !== rawHost.toLowerCase() \|\| (wild && host.startsWith('['))) return null;` |
| `extension/shared/site-pattern.js:37` | `try { u = new URL(String(url).includes('://') ? url : 'https://' + url); } catch { return false; } if (!['http:', 'https:'].includes(u.protocol)) return false; return (!p.protocol \|\| p.protocol === u.protocol) &&` |
| `extension/shared/stream.js:48` | `} catch { failed = true; return; } stringStart = -1; delimiter = true; } else if (/\s/.test(ch)) continue;` |
| `extension/shared/stream.js:62` | `} catch { return false; } }, };` |
| `extension/sidepanel/subtitle-form.js:49` | `} catch (error) { if (!disposed && token === epoch) fileStatus.textContent = error.message; } }); translate.addEventListener('click', async () => {` |
| `extension/sidepanel/subtitle-form.js:59` | `} catch { if (!disposed && token === epoch) { stop(); translate.disabled = false; fileStatus.textContent = l10n('ma1'); } } }); cancel.addEventListener('click', () => { stop(); translate.disabled = !cues.length; fileStatus.textContent = l10n('ma2'); });` |
| `extension/sidepanel/subtitle-form.js:71` | `const off = platform.settingsStore.onChange(() => { void reload().catch(() => {}); }); form.addEventListener('submit',event=>event.preventDefault()); try { await reload(); } catch { status.textContent = l10n('ma5'); }` |
| `extension/sidepanel/subtitle-form.js:73` | `try { await reload(); } catch { status.textContent = l10n('ma5'); } return { destroy() { disposed = true; version++; off(); stop(); for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); } form.remove(); style.remove(); } }; }` |
| `extension/sidepanel/text-form.js:122` | `} catch (error) { if (!disposed && token === modelSequence) showError(error,()=>load.click()); } finally { if (!disposed && token === modelSequence) load.disabled = false; } });` |
| `extension/sidepanel/text-form.js:139` | `} catch (error) { if (!disposed && token === sequence) showError(error,()=>form.requestSubmit()); } finally { if (!disposed && token === sequence) translate.disabled = false; } });` |
| `extension/sidepanel/text-form.js:144` | `catch { status.textContent = l10n('mak'); } }); speak.addEventListener('click', () => {` |
| `extension/sidepanel/text-form.js:150` | `} catch { status.textContent = l10n('mal'); } }); let settingsSequence = 0;` |
| `extension/sidepanel/text-form.js:164` | `const off = platform.settingsStore.onChange(() => { void reload().catch(() => { status.textContent = l10n('ma5'); }); }); try { await reload(); } catch { status.textContent = l10n('ma5'); }` |
| `extension/sidepanel/text-form.js:166` | `catch { status.textContent = l10n('ma5'); } return { destroy() { disposed = true; pending?.abort(); sequence++; off(); stopSpeech(); service.dispose?.(); form.remove(); style.remove(); } }; }` |
| `extension/ui/common.js:20` | `catch (e) { return { ok:false, error:{message:e.message \|\| String(e)} }; } } export function errorText(res) { return res?.error?.message \|\| l10n('maq'); }` |
| `extension/ui/common.js:25` | `try { return await task(); } catch (e) { notice(e.message \|\| String(e), true); } finally { button.disabled = false; } }` |
| `extension/ui/components.js:20` | `const hostList=[...new Set(providerChain(s).filter(c=>c.profile.kind!=='mock').map(c=>{try{return new URL(c.profile.baseUrl).host;}catch{return c.profile.name;}}))],hosts=hostList.join(l10n('listSeparator')); // `short` is the one-line popup form: name · recipients, the fallback stated as a condition. `full` is the sentence used in Settings. const line=(name,to)=>spaced(`${name} · ${to}`),join=list=>list.filter(Boolean).join(l10n('listSeparator'));` |
| `extension/ui/forms/feedback.js:45` | `catch (error) { if (error instanceof DLError \|\| classify(error).category === 'storage') { const options = {milliseconds:false, retry:()=>run(button,fn,{busy,inline}),` |
| `extension/ui/forms/index.js:244` | `catch { throw new Error(COPY.s9); } if (Array.isArray(next.siteRules.custom)) for (const r of next.siteRules.custom) for (const field of ['include', 'exclude']) { for (const selector of Array.isArray(r[field]) ? r[field] : r[field] ? [r[field]] : []) root.ownerDocument.createDocumentFragment().querySelector(selector);` |
| `extension/ui/forms/index.js:438` | `catch (error) { notice(error.message); } }); action('copy-backup', async () => {` |
| `extension/ui/forms/index.js:445` | `catch { $('backupText').select(); notice(COPY.s47); } }); async function importText(text) {` |
| `extension/ui/forms/index.js:483` | `try { const next=await store.load(); if(closed)return; if(dirty){s={...s,uiLanguage:next.uiLanguage};refreshLanguage();showSync();return;}s=next;await draw(); } catch { notice(COPY.s56, true); } }); return {` |
| `extension/ui/forms/interactions.js:45` | `catch(error){setSettings(before);setDirty(previousDirty);if(n.type==='checkbox')n.checked=!value;n.setAttribute('aria-invalid','true');ui.querySelector('#error-'+n.id)?.remove();const help=el('small',error.message\|\|T.failure,{class:'field-error',id:'error-'+n.id});n.parentElement.append(help);notice(error.message\|\|T.failure,true);} } for(const radio of ui.querySelectorAll('[name=translation-method]'))on(radio,'change',()=>{if(radio.checked){$('translationMode').value=radio.value;void persistFiel` |
| `extension/ui/forms/interactions.js:54` | `on($('copy-origin'),'click',()=>ctx.feedback.run($('copy-origin'),async()=>{const command=`setx OLLAMA_ORIGINS "chrome-extension://${globalThis.chrome?.runtime?.id\|\|l10n('mdu')}"`;try{await win.navigator.clipboard.writeText(command);notice(T.copied);}catch{notice(T.copyFallback+command);}})); function chain(){try{return JSON.parse($('providerChain').value\|\|'[]');}catch{return[];}} function setChain(entries){$('providerChain').value=JSON.stringify(entries,null,2);setDirty(true);drawChain();}` |
| `extension/ui/forms/interactions.js:55` | `function chain(){try{return JSON.parse($('providerChain').value\|\|'[]');}catch{return[];}} function setChain(entries){$('providerChain').value=JSON.stringify(entries,null,2);setDirty(true);drawChain();} function drawChain(){const root=$('chain-list');root.replaceChildren();chain().forEach((entry,i)=>{const row=el('div',null,{class:'chain-row'});row.append(el('span',`${getSettings().provider.profiles.find(p=>p.id===entry.profileId)?.name\|\|entry.profileId} / ${entry.model}`));for(const [label,delta` |
| `extension/ui/forms/qrcode.js:7` | `catch { throw new Error(l10n('mi1')); } const scale = 4, border = 4, size = (qr.size + border * 2) * scale; canvas.width = canvas.height = size;` |
| `extension/ui/forms/site-rules.js:11` | `const draw=()=>{const list=$('site-rule-list');list.replaceChildren();try{const rules=parse();if(!rules.length)list.append(el('p',l10n('polishEmptyRules'),{class:'hint'}));for(const rule of rules){const row=el('div',null,{class:'rule-row'}),edit=el('button',l10n('mic'),{type:'button'});row.append(el('span',rule.match),edit);edit.onclick=()=>show(rule);list.append(row);}}catch{/* The common validator reports malformed advanced JSON. */}}; $('site-rule-new').onclick=()=>show();$('cancel-sites').ad` |
| `extension/ui/forms/site-rules.js:13` | `$('site-rule-add').onclick=()=>{if($('site-rule-editor').hidden){$('save-sites').click();return;}try{const match=$('rule-match').value.trim();if(!parsePattern(match))throw Error();const rules=parse(),rule=rules.find(r=>r.match===match)\|\|{match};for(const f of fields)rule[f]=$('rule-'+f).value;if(!rules.includes(rule))rules.push(rule);json.value=JSON.stringify(rules,null,2);json.dispatchEvent(new Event('input',{bubbles:true}));$('save-sites').click();}catch{$('status').textContent=l10n('mi3');}};` |
| `extension/ui/options.js:30` | `} catch { document.getElementById('startup-status').hidden = false; }` |
| `extension/ui/popup-view.js:25` | `let host='';try{host=new URL(url).hostname;}catch{/* unavailable tab */} async function run(fn){try{for(let retry=0;retry<8;retry++){const result=await fn(),error=result?.error;if(error?.code!=='confirmation-required'){if(error)showError(error,()=>run(fn));return result;} if(!error.destination\|\|!await confirmationCard({...destinationNotice([error.destination]),platform:{...platform,openSettings:onSettings},root:box,group:error.destination.id.startsWith('llm:')?'ai':'common'}))return;` |
| `extension/ui/popup-view.js:28` | `await acknowledge(localArea,error.destination.id);}}catch(error){showError(error,()=>run(fn));}} function showError(error,retry){if(feedback)renderError(feedback,error,{retry,openSettings:onSettings});} const button=(text,fn,attrs={})=>{const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',()=>run(fn));return b;};` |
| `extension/ui/popup-view.js:69` | `async function refresh(){if(closed\|\|refreshing\|\|restricted)return;refreshing=true;let changed=false;try{const next=await pageMessage({type:'get-state'});if(!next){restricted=true;changed=true;}else if(JSON.stringify(next)===JSON.stringify(state))return;else {state=next;changed=true;}}catch{restricted=true;changed=true;}finally{refreshing=false;if(changed&&!closed&&device.onboarded)draw();}} // Focus rings belong to keyboard use. The initial programmatic focus stays silent until a key is pressed.` |
| `extension/ui/popup.js:20` | `}catch{restricted=true;stale=true;} const looksPDF=(()=>{try{return /\.pdf$/i.test(new URL(tab?.url).pathname);}catch{return false;}})(); const pdf=!reader&&tab?.id&&(restricted\|\|looksPDF)?await chrome.runtime.sendMessage({type:'pdf-status',tabId:tab.id}).catch(()=>null):null;` |
| `extension/ui/popup.js:21` | `const looksPDF=(()=>{try{return /\.pdf$/i.test(new URL(tab?.url).pathname);}catch{return false;}})(); const pdf=!reader&&tab?.id&&(restricted\|\|looksPDF)?await chrome.runtime.sendMessage({type:'pdf-status',tabId:tab.id}).catch(()=>null):null; if(pdf?.available)accessError=ERR.RESTRICTED;` |
| `extension/ui/popup.js:22` | `const pdf=!reader&&tab?.id&&(restricted\|\|looksPDF)?await chrome.runtime.sendMessage({type:'pdf-status',tabId:tab.id}).catch(()=>null):null; if(pdf?.available)accessError=ERR.RESTRICTED; const commands=await chrome.commands?.getAll?.()\|\|[];` |
| `extension/ui/popup.js:34` | `}catch{document.body.textContent=TEXT.failed;}` |
| `extension/userscript/menu.js:11` | `} catch { platform.showResourceError(); } }); }` |
| `extension/userscript/panel.js:86` | `} catch { if (token === generation) mount.textContent = TEXT.failed; } }, close,` |
| `extension/userscript/settings-resource.js:25` | `} catch { pending = null; throw new Error(SETTINGS_RESOURCE_ERROR()); } }); return pending;` |

## 范围与待协作

- 当前接入后台 provider / MT 标准错误、页面段落汇总、toast、划词、输入框翻译、popup 错误状态、侧栏的翻译及模型请求；设置页保留局部校验文案，标准服务 / 存储错误接入同一渲染器，并沿用原异步清空、忙碌态与秒级时间戳。
- 页面过大仍采用按需扫描与有界请求；目前没有整页完成时限和「因页面过大停止」事件，因此不凭空声称已翻译整页。PDF 的页数/容量/扫描版限制见上表与 PDF.md；新扫描 OCR/导出文案由 v11-pdf 追加。
- 既有字幕/图片面板、本地配置导入校验、用户脚本资源损坏提示并未全面重写 UI；上表覆盖现有文案和来源，leader 可按功能归属继续接入共享渲染器。
- PRODUCT.md 4.2 已同步「临时错误安静重试、终止失败单一汇总提示」的 v1.1 行为。未新增颜色、卡片、阴影、账号或遥测。
