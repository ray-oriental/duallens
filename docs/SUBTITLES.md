# YouTube 字幕与文本侧栏（P1，待主控合并）

本分支只实现 YouTube 平台已有的字幕轨和自由文本翻译，不提供语音识别、直播字幕服务、其他视频网站或文件翻译。扩展保持原生 ES 模块、零构建；用户脚本复用相同核心与用户配置的服务，无需本机网关。所有验证均使用离线夹具和 mock，未验证真实服务质量或真机浏览器。

## 使用

- 桌面 Chrome / Edge：Alt+S 或右键「DualLens 文本翻译」打开浏览器侧栏。输入文本，选择语言、服务和模型后翻译；可复制或调用系统朗读。默认使用当前备选链。模型列表只在点击「获取模型」时请求。
- 用户脚本：Tampermonkey 菜单「DualLens 文本翻译」或 Alt+S 打开原有 DualLens 面板的「文本翻译」页签；另有「设置」「视频字幕」页签。手机使用菜单入口，不要求实体键盘。
- 字幕：侧栏的字幕设置、用户脚本的视频字幕页签或 YouTube 上的右键菜单启用。默认关闭。启用后打开播放器 CC 选择字幕轨；DualLens 收到轨道请求后开始翻译。可设置双语/仅译文、16–48 px 字号和顶部/底部位置。
- 关闭字幕、字幕恢复命令或网页恢复命令移除覆盖层与遮挡原字幕的样式，取消取轨和未完成批次，保留播放器 CC 开关与原字幕 DOM。播放器容器全屏仍显示覆盖层；Android 的系统原生视频全屏需要真机验收。

## 取轨与安全边界

`content/subtitles/observer.js` 是独立原创的经典 MAIN 世界脚本，仅静态匹配 `https://www.youtube.com/*`、`https://m.youtube.com/*`，在 document_start 观察 fetch/XHR 的 timedtext URL。原请求的参数、Promise 和响应不被替换，也不延迟播放器请求。它只发送 URL 提示并保留最近一个地址用于内容脚本就绪握手，不包含服务设置、密钥、正文或翻译命令。观察器随文档卸载结束；恢复操作移除字幕 UI 和翻译任务，保留无响应改写的取轨观察能力。

`observer-runtime.js` 是同一函数的用户脚本实现，单测确保与经典脚本一致。用户脚本仅在 YouTube 文档将该函数注入页面 MAIN。document-idle 以前的请求和 CSP 拒绝内联注入时，使用 PerformanceObserver 的缓冲资源条目作被动回退。回退不调用网页播放器私有对象。没有任何轨道提示时显示等待状态，用户应打开 CC；不宣称绕过 YouTube CSP。

内容脚本通过注入的 `platform.subtitles` 获取观察与取轨能力，不直接调用 Chrome/GM。桥接消息严格检查 source/origin；URL 再检查精确的 www/m.youtube.com HTTPS host、默认端口、`/api/timedtext`、无 URL 凭据及当前 watch/shorts 视频 ID。移动元数据的轨道可能指向 www，两个 host 间允许取轨，不接受任何其他 host。消息是可伪造的页面数据，因此不能授权通用 HTTP、服务配置或任何模型工具调用。

内容脚本发起取轨，去掉 `tlang`，设置 `fmt=json3`。同源使用隔离世界 fetch，不带 cookies、拒绝重定向、20 秒取消，流式读取上限 4 MiB。跨 www/m 的扩展请求通过专用后台端点避开 CORS，后台再次检查顶层 YouTube sender、当前视频、受限 URL，并按 tab/document/request ID 取消，最多 16 个并行取轨；仍不带 cookies、拒绝重定向、流式限制 4 MiB。用户脚本跨 host 使用既有 anonymous GM HTTP，无 provider Authorization，20 秒超时和取消，下载后检查 4 MiB 字节预算。未持久化签名轨道 URL，不将其发往模型；模型上下文只含页面标题/页面 URL，条目只含字幕文本。字幕与文本译文使用 textContent，不进入可执行标记。译文缓存及备选链均复用现有翻译服务，不使用网页自己的存储。

## 解析、断句与调度

手工字幕合并每条 json3 event 的 segs，保留开始时间与持续时间；无持续时间用下一事件或 2 秒兜底。无文字的定位事件、环境音标注与音乐符号被过滤。

ASR 轨道由 `kind=asr` 判定。保留 tOffsetMs 的词级时间，去除相同时间/文字的滚动重放；第一遍以 1000 ms 间隔、17 词或句末标点拆分，第二遍在非句末且间隔小于 1500 ms、合计不超过 19 词时合并。单句另限 500 字符。没有引入第三方词表；这是启发式分句，语言学质量并非精确转录保证。

每组最多 5 条，先请求当前播放位置所在组，然后下一组、上一组、后续组，最后更早的组。当前/相邻/预取分别传 priority 0/1/2。每次仅保持一组未完成请求，避免一次把整段视频排入队列。timeupdate 更新下一组优先级；seeking 立即取消旧批次并重排。已译条目保留，晚到的旧回包由 generation 丢弃；失败条目不在后台无限重试，重新启用可重试并复用缓存。

轨道切换、语言/服务/提示词/术语更改会重新翻译。SPA 换视频与播放器节点替换清除旧数据，移除监听与样式后重新挂载。原字幕仅在当前 cue 已有译文时被局部 CSS 隐藏；译文缺失时仍可阅读原生字幕，不改 CC 开关。

## 接口接入，供 leader 更新公共契约

- 非机密 `settings.subtitles`：`{ enabled:false, mode:'bilingual', fontSize:22, position:'bottom' }`，存入 `settings.core`。v0.3 集成已纳入共享默认 schema 与导入校验；公共同步、完整 / 紧凑备份保留字幕偏好，旧备份缺少该字段时使用默认值。
- 平台新增 `subtitles: { observe(callback): unsubscribe, fetchTrack(url,{signal}): Promise<json3> }` 和 `openTextTranslation()`。用户脚本平台通过原有 `createSettingsPanel({ mountForm })` 接口添加页签，复用原表单，不改 userscript/entry.js 或 ui/forms。
- `translate-text` / TranslatorService.translateText 增加可选 `profileId`、`model` 和 `purpose:'text'`。只选择已有 profile；模型为非空字符串、最长 256 字符。选择仅作用于本次请求，作为原备选链的首项，不保存、不改网页翻译配置。既有订阅模型显式选择约束由 providerChain 继续执行；缓存使用实际服务/模型身份。
- 内容命令新增 `toggle-subtitles`、`restore-subtitles`；`get-state` 增加 `subtitles`，包含 enabled/status/cues/translated/failed/order/overlay/visible/current/display，供侧栏和离线测试核查。display 是实际覆盖层的可见性、原文隐藏、字号与位置；状态不含轨道 URL 或服务密钥。
- 扩展内部 `subtitle-track` / `subtitle-track-cancel`：仅限顶层 YouTube 内容脚本的跨 www/m 轨道 GET，携带受限 url 与 request ID。取消键隔离 tab/document，不能成为通用 HTTP 请求入口。
- 用户脚本 `openSettings` 使用同一个带页签的现有设置对话框。`openTextTranslation` 直接选中文本页签，Alt+S 由平台层注册；原 GM 菜单和设置表单仍可用。

## manifest 变动

- 增加 `sidePanel` 权限，用于浏览器原生侧栏；增加 `side_panel.default_path = sidepanel/index.html`。
- 增加 `open-sidepanel` 命令，默认 Alt+S；连同已有 Alt+A / Alt+W / Alt+I 共四个建议快捷键，不超过 Chrome 的默认快捷键数量限制。
- 增加上述两个 HTTPS YouTube host 的 MAIN / document_start / 顶层 content script。通用网站 loader 仍为 ISOLATED；没有向其他网站扩展 MAIN matches。
- web_accessible_resources 增加 `content/subtitles/*.js` 供 loader 静态导入。侧栏页面、MAIN 注入无需开放为网页资源；host_permissions、CSP 和 minimum_chrome_version 不变。

API 行为依据 [Chrome sidePanel 文档](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[content_scripts manifest 文档](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)。侧栏打开在用户手势内直接调用；不通过定时器打开。

## 离线验证

常规命令与 canonical E2E 同 CONTRIBUTING.md。专项运行：

```powershell
node --test tests/unit/subtitles.test.mjs
node scripts/build_userscript.mjs
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_media_e2e.py
```

专项测试复用 canonical runner 的扩展暂存、临时 profile 和清理规则。浏览器 URL 虽为 www/m.youtube.com，但页面请求通过 Playwright route 由 `tests/fixtures/subtitles/youtube.html` 和本地 json3 回应；跨 host 后台取轨通过临时 worker 内的严格 fetch 夹具回应，GM 跨 host 请求通过 anonymous 传输桩回应。Playwright 1.48 的页面路由不涵盖扩展 worker 网络，因此必须在第一次取轨前安装该禁止外网的传输夹具。音频为标准库生成的静音 WAV（含正确的 HTTP 字节范围响应）。覆盖字幕叠加、当前位置优先、seek、全屏、字幕样式、SPA、原字幕可见性与精确恢复；扩展原生侧栏打开、文本翻译/模型选择、复制和朗读调用；用户脚本桌面、375×812 手机与 800×1280 平板文本页签和字幕流程。

测试不注入产品测试钩子；用户脚本等价 GM 桩里的 closed shadow root 由 E2E init script 外部审计，扩展通过既有 get-state 消息核查实际显示状态。合成按键不能触发浏览器系统级扩展 command，Alt+S 的命令分发另用离线后台监听器测试，原生 sidePanel.open 使用扩展手势调用实测。系统朗读调用与按钮验证不等于设备实际有可用中文声音。

真实 YouTube（签名地址、区域限制、广告、字幕格式变化）、两台 Windows Chrome/Edge 及 Android Edge + Tampermonkey 的实际行为仍由 leader / 用户最终验收。Android Chrome 的 bookmarklet 不在本任务内；不宣称支持 Chrome Android 扩展。v0.3 集成已将本文件加入发布文档白名单。
