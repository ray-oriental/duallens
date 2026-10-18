# 网页视频字幕、本地字幕文件与文本侧栏（P1，待主控合并）

本分支支持 YouTube 已有轨道、HTML5 标准字幕轨、用户导入的 SRT/VTT 字幕文件和自由文本翻译。不提供语音识别、私有播放器专用适配或一般文档翻译。扩展保持原生 ES 模块、零构建；用户脚本复用相同核心与用户配置的服务，无需本机网关。所有验证使用离线夹具和 mock，未验证真实服务质量或真机浏览器。

## v0.5 通用字幕与本地文件增量

- 非 YouTube 页面从标准 `video.textTracks` 读取已显示的 subtitles/captions 轨道，也支持网站通过 `addTextTrack` 创建的 hidden/captions 轨道。优先用户当前 showing 轨道；不擅自启用 disabled 轨道。用户需先在播放器打开字幕。没有可读 cue 的视频不创建覆盖层或翻译请求；多个视频分别调度。
- `<track src>` 由浏览器原生加载器执行同源/CORS 校验。跨域不允许或 cues 不可读时保留原播放器，不使用后台/GM 绕过 CORS，也不读取播放器私有接口。后台 `subtitle-track` 仍严格限定 YouTube，无权限和消息协议扩张。
- 复用既有五条一组、当前位置优先、seek 取消并重排的 `SubtitleScheduler`。译文通过 `textContent` 插入。当前 cue 有译文时将选中 showing 轨临时设为 hidden；空档/失败保留原生字幕；关闭、移除视频、换轨和重新配置时恢复由 DualLens 临时修改的 mode。不修改 `<track>` 元素、cue 或播放器样式。原生已 hidden 轨保持 hidden。
- 覆盖层按视频矩形定位，监听滚动/尺寸/全屏事件；容器全屏时移入容器，视频元素全屏时使用浏览器 top-layer popover。关闭移除覆盖层及所有监听。Android 系统原生播放器全屏与实际 Tampermonkey 隔离环境仍须真机验收。
- 字幕页签可选 `.srt` / `.vtt`，先按 File.size 检查 **2 MiB（2,097,152 字节；界面标记 2 MB）**，解析器再按 UTF-8 字节检查；超限显示「字幕文件不能超过 2 MB」。最多 10,000 条 cue，UTF-8 文本支持 BOM/CRLF、多行、样式标签、实体和标准时间格式。丢弃样式、VTT NOTE/STYLE/REGION 与定位元数据，不保留原始 cue ID；导出顺序编号、保留毫秒时间轴。
- 导入只在本地解析并预览前 20 条。点击「翻译字幕文件」才通过当前 TranslatorService 逐组发送 cue 文字和语言，不发送文件名、时间轴或整个文件。可取消、重试失败项；换文件、关闭页签或语言/服务设置变化会取消旧请求并屏蔽迟到结果。语言/服务变化清空旧译文，避免混合导出。缓存仍由既有翻译服务管理。
- 全部条目成功后可下载双语 SRT 或 VTT，每条包含原文、译文，保留原有多行。文本中的 `<>&` 转义，避免导出后被当作样式；导出为本地 Blob，不上传。双语文件可能大于原文件，重新导入同样遵守 2 MiB 限制。标准字幕重叠时显示最后开始的一条，不保留逐词动画或位置样式。

文件分工：`controller.js` 选择 YouTube/HTML5 控制器；原 YouTube 实现迁至 `youtube.js`；`html5.js` 管理标准播放器生命周期，复用原控制器的渲染、取消和状态逻辑；`files.js` 提供纯解析/生成函数；`sidepanel/subtitle-form.js` 在现有字幕表单下加入文件流程。main.js 只更换字幕控制器导入与实例化。

**尚未达成的预算项：** 基线启动包实测 311,939 字节；本增量的完整内联实现超过 +9,000 字节，虽然仍低于总目标 330,000。通用模块按需 `@resource` 打包需要更改分工外的 `scripts/build_userscript.mjs`，以及资源发布/校验白名单和 GM 测试桩；本工作区没有改动这些文件。需 leader 授权或接手资源拆分后才能声称完全达到本轮验收。最终精确字节数见交付报告。

## 使用

- 桌面 Chrome / Edge：Alt+S 或右键「DualLens 文本翻译」打开浏览器侧栏。输入文本，选择语言、服务和模型后翻译；可复制或调用系统朗读。默认使用当前备选链。模型列表只在点击「获取模型」时请求。
- 用户脚本：Tampermonkey 菜单「DualLens 文本翻译」或 Alt+S 打开原有 DualLens 面板的「文本翻译」页签；另有「设置」「视频字幕」页签。手机使用菜单入口，不要求实体键盘。
- 字幕：侧栏的字幕设置、用户脚本的视频字幕页签或既有字幕命令启用。默认关闭。YouTube 打开 CC 选择字幕轨，其他 HTML5 播放器打开可用的标准轨。可设置双语/仅译文、16–48 px 字号和顶部/底部位置。命令、右键菜单（任意网站的 `<video>` 元素，YouTube 为页面级菜单）与 GM 菜单统一为「启用 / 恢复视频双语字幕」。
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
node --test tests/unit/subtitle-files.test.mjs
node scripts/build_userscript.mjs
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_media_e2e.py
```

专项测试复用 canonical runner 的扩展暂存、临时 profile 和清理规则。浏览器 URL 虽为 www/m.youtube.com，但页面请求通过 Playwright route 由 `tests/fixtures/subtitles/youtube.html` 和本地 json3 回应；跨 host 后台取轨通过临时 worker 内的严格 fetch 夹具回应，GM 跨 host 请求通过 anonymous 传输桩回应。Playwright 1.48 的页面路由不涵盖扩展 worker 网络，因此必须在第一次取轨前安装该禁止外网的传输夹具。音频为标准库生成的静音 WAV（含正确的 HTTP 字节范围响应）。覆盖字幕叠加、当前位置优先、seek、全屏、字幕样式、SPA、原字幕可见性与精确恢复；扩展原生侧栏打开、文本翻译/模型选择、复制和朗读调用；用户脚本桌面、375×812 手机与 800×1280 平板文本页签和字幕流程。

测试不注入产品测试钩子；用户脚本等价 GM 桩里的 closed shadow root 由 E2E init script 外部审计，扩展通过既有 get-state 消息核查实际显示状态。合成按键不能触发浏览器系统级扩展 command，Alt+S 的命令分发另用离线后台监听器测试，原生 sidePanel.open 使用扩展手势调用实测。系统朗读调用与按钮验证不等于设备实际有可用中文声音。

真实 YouTube（签名地址、区域限制、广告、字幕格式变化）、两台 Windows Chrome/Edge 及 Android Edge + Tampermonkey 的实际行为仍由 leader / 用户最终验收。Android Chrome 的 bookmarklet 不在本任务内；不宣称支持 Chrome Android 扩展。v0.3 集成已将本文件加入发布文档白名单。

v0.5 专项另含 `html5.html`：本地标准 VTT 与支持 HTTP Range 的静音 WAV，通过真实 currentTime 验证扩展隔离世界与用户脚本 375×812 / 800×1280；测试容器及 video 元素全屏、无轨视频无覆盖层、原生 mode 与 DOM 精确恢复、in-band TextTrack。文件用例在扩展侧栏与用户脚本中实际导入、mock 翻译、下载两种格式并重新导入，检查时间轴、多行与超限中文提示。桌面 Chromium/GM 桩结果不能代替真机兼容结论。
