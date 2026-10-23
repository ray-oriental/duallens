# 多平台与通用配置契约（v1.0.0）

界面语言使用同步设置 `uiLanguage: 'zh-CN' | 'en' | 'auto'`，默认简体中文；只有 `auto` 跟随浏览器（中文变体使用简体中文，其余使用英文），与翻译目标语言独立。

状态：2026-10-13 起草，主控维护。本文件与 [SPEC.md](SPEC.md) 同级，接口变更先改这里。

## 目标

DualLens 是**通用浏览器插件**，不是某台电脑上的服务。任何人填入自己的模型服务配置即可使用；
同一份核心代码必须在下列环境里正确、流畅地运行：

| 目标 | 设备与浏览器 | 形态 | 安装 |
| --- | --- | --- | --- |
| `extension` | Windows / macOS / Linux 上的 Chrome、Edge | MV3 扩展（现有） | Edge Add-ons 商店；GitHub Release zip 作为备用 |
| `userscript` | Android 上的 Edge + Tampermonkey（主力移动端）；桌面端 Tampermonkey 也可用 | 单文件 `duallens.user.js` | 在 Tampermonkey 中打开 Release 里的安装链接 |
| `bookmarklet` | Android 上的 Chrome（不支持扩展和用户脚本） | `javascript:` 书签 + 同一个打包产物 | 配置页生成书签（P1，尽力而为，见下文风险） |

Chrome 的 Android 版到 2026 年仍不支持扩展；Edge 的 Android 版只能装商店精选名单里的扩展，但名单里有
Tampermonkey。所以移动端以用户脚本为主。

## 1. 平台适配层 `extension/platform/`

内容脚本与翻译服务只依赖下面这个接口，不直接调用 `chrome.*` 或 `GM_*`。每个目标各实现一份：
`platform/extension.js`、`platform/userscript.js`（bookmarklet 复用 userscript，只换掉 storage 与 http）。

```js
/** @typedef {{ get(keys): Promise<object>, set(items): Promise<void>, remove(keys): Promise<void>,
 *              onChanged(cb: (changes) => void): () => void }} StorageArea */
export interface Platform {
  kind: 'extension' | 'userscript' | 'bookmarklet';
  syncArea: StorageArea;    // 非机密设置；extension 用 chrome.storage.sync，满额或不可用时退回 local
  localArea: StorageArea;   // 机密与本机状态；extension 用 chrome.storage.local，userscript 用 GM_getValue/GM_setValue
  http(req: { url, method, headers, body, timeoutMs, signal, onText? }): Promise<{ status, headers: { get(name) }, text }>;
                            // extension 用 fetch（在 service worker 里，无 CORS 限制）；userscript 用 GM_xmlhttpRequest
  translator(): TranslatorService;  // extension：经端口连 service worker；userscript：在页面内直接实例化
  detectLanguage(text): Promise<{ lang, reliable } | null>;  // extension 用 chrome.i18n；其余回落到 shared/lang.js 启发式
  openSettings(group?: 'common'|'ai'|'enhance'|'sites'|'glossary'|'data'|'about'): void;     // extension：打开 options 页；userscript：打开页内设置面板
  promptSecret(label: string): string | null; // userscript：隔离沙箱原生 prompt，默认空值；取消返回 null
                            // extension：返回 null；其独立 options 页面保留 password 输入框
  registerCommand(id, label, handler): void;  // userscript：GM_registerMenuCommand；extension：commands 已在 manifest
  renderQr?(canvas: HTMLCanvasElement, text: string): void | Promise<void>;
                            // 可选：仅扩展 options 提供本地二维码渲染；内容平台与 userscript 不加载编码器
}

export interface TranslatorService {
  translateBatch({ items, to, from, priority, context, draft?, purpose?, mode? }, onPartial): { cancel(), done? };
  translateText({ text, to, from, purpose, mode?, profileId?, model? }): Promise<{ ok, text?, by?, engine?, error? }>;
  listModels(profileId): Promise<{ ok, models?, baseUrl? }>;
  testProvider(profileId): Promise<{ ok, latencyMs?, sample?, baseUrl?, error? }>;
}
```

### v0.4 双引擎增量契约（未发布）

网页覆盖与排版补充：`translateShortText:true` 默认开启，单字与 1–3 词控件参与合批；关闭后遵循 `minChars` 并跳过 1–3 词短单元。
正文、列表、标题、文章链接及长单元格下方显示块级译文；短控件先使用较小行内译文与细分隔。
仅交互控件或 nav/header 导航链接、≤3 词且 ≤24 字符，并且追加双语后实测溢出、换行或裁切时，才允许回退为替换，原文存于可恢复的 title。
标题、卡片标题及 >3 词内容始终保留原文；正文/标题临时放开自身及邻近容器的裁切/高度限制，并精确恢复原内联样式。控件保留用于隐藏辅助内容的裁切，避免编辑记录等内容扩开后压住邻近作者行。同结构兄弟元素先共同决定呈现方式。
链接文字为全小写或含数字/代码式符号/camelCase 的单 token、且不在 UI 词表时，才采用 href 最后路径段相等的标识符保护；News/Sport 等首字母大写普通词正常翻译。用户名/仓库/文件/分支/话题及语言/许可证专名保持原文；GitHub、问答标签、Reddit 子版块及 API 标识符有本地补充保护。单元首尾的独立标识符子元素不进入翻译请求。
常见英文短 UI 在简体中文目标且用户术语表为空时命中内置小词表，直接在本地生成；其余情况沿用翻译链，保留目标文字变体与自定义术语的处理。HN 元信息追加一条紧凑译文，保留作者和数值，以“2 小时前”等完整短语呈现时间；放不下时译文另起一行。
placeholder、无可见正文的图标按钮 title、原生 option label 及按钮型 input value 独立翻译；不翻译 alt、密码框或用户输入值。
动态属性与展开状态会失效重扫；`translation` 模式/引擎变化会取消旧请求、恢复并重翻。
muted 译文色按 78% 原文字色与 22% 祖先合成的纯色背景调和；结果对比度低于 4.5:1 或偏好更高对比度时回退原文色。原文本身低对比度时保留它的配色；背景图、渐变与祖先 opacity/filter 的最终像素对比度仍需真实页面检查。
Pixiv 的 reader 提示兼容直接包含 `span.text-count` 的 p/div/section/span，穿透手机版 `p > span > span` 行内包装；正文之外的可见导航和标签也参与普通扫描。
覆盖率与首段 ≤3 秒属于真实网页验收指标；标识符及 MT 原样返回的专名计入例外，不进覆盖率分母，也不冒充已生成中文译文；站点拒绝访问须单列失败。
`aria-hidden` 单独不作为视觉排除条件；实际可见文本仍翻译，display/visibility、透明度及裁切隐藏的克隆不翻译。
作者/频道节点、arXiv citation_author、PDF Abstract 前有机构/邮箱证据的作者组保持原文。页面内反复出现在非句首的大写英文词可作为产品术语，在本地转成原子占位符；不把整页文本传给服务，LLM 提示同样要求保留专名。
动态 class/style 变化仅重新测量已有译文和扫描新增可见文本，不为每次高度变化重新翻译。译文撑开局部内容容器，并保留站点之后写入的样式供恢复；图片上的短视频译文附带深色半透明底。
扫描与结果插入使用有界普通任务，避免繁忙 SPA 的 idle 饥饿；原生语言检测只等待 50 ms。新可见 MT 在全局等待槽中优先于预取；已发请求仍正常结束，避免双语扩高后过早取消刚进入视口的段落。HTTP 200 的单批解析错误不触发全引擎冷却；网络/限流仍退避，页面错误最多自动补试两次（16 秒，限流 60 秒），可见错误使用中性小重试标记。

- `translation = { mode:'mt+llm', refineTimeoutMs:90000, mt:{engine:'microsoft',fallback:true,region:''} }`。
  模式为 `mt` / `llm` / `mt+llm` / `auto`。新安装无需模型 key；用户触发翻译时，无可用 LLM 配置的混合模式降级为 MT。
  安装、打开设置本身不发翻译请求。`llm` 模式仍要求有效模型配置，也不会调用免费 MT。
- `mt+llm` 请求带 `draft:true` 时，先检查 LLM 缓存，未命中的项目并行请求 MT 与 LLM。
  `onPartial` 接收 `[{id,text,stage:'draft'|'final',engine?,plain?,refined?}|{id,error}]`；同一 id 可先 draft 再 final。
  draft **不算完成**；final 或 error 才终结 id。无 stage 的旧结果等同 final。取消后不再交付。
  `draft` 缺省时保留旧调用方的一次终结结果语义，只在 LLM 失败/超时时使用 MT 兜底；PDF 调用方须显式启用 draft 并接受同 id 更新。
- MT 失败时继续 LLM；LLM 失败或超过精修预算时，将已有 MT 作为 `stage:'final',refined:false` 返回，不显示精修错误。
  两侧均失败才返回 error。`auto` 先等待 LLM 2.5 秒，仍无结果才请求 MT 草稿。`mt` 只用 MT。
  `selection` / `hover` / `input` 在混合模式下默认 MT，MT 失败可回退 LLM；划词卡片的精修操作显式请求 `mode:'llm'`。
- 自动网页/PDF 精修仅处理至少 6 个词或 12 个 CJK 字符的正文、标题、列表及单元格；内容端可用 item `refine:false` 排除导航、按钮、标签、属性和元信息。其余项目直接以 MT 终稿返回，MT 失败不唤醒 LLM。显式 `llm` 模式不受此筛选限制。
  无法解析的模型正文计为当前链项失败并尝试下一项；有效 JSON 的缺项仍使用有限缩批重试。设置“测试连接”发送两项真实翻译探针，完整解析失败时显示非 JSON/思考型模型提示。
- MT 引擎：`microsoft` / `google`（免费**非官方接口**，可能失效）、`microsoft-api` / `deepl`（用户官方 key）、`mock`（离线）。
  默认 Microsoft → Google，关闭 `fallback` 后只调用选定 MT 引擎。官方 key 使用本机 `secrets['mt-microsoft-api'|'mt-deepl']`，不进入公共设置、明文导出或日志；加密导出可携带。
- 免费 Microsoft 当前使用 `edge.microsoft.com/translate/translatetext` 的批量 POST；401/403 时尝试 `/translate/auth` → `api-edge.cognitive.microsofttranslator.com`，短期 token 只缓存于内存，过期前一分钟刷新。
  2026-10-15 无凭据直连探测中 auth 返回 404，批量路径成功，因此不把 auth 作为唯一路径。
  Google 使用 `clients5.google.com/translate_a/t?client=dict-chrome-ex` 等价批量表单接口；其限流不保证可用性。
- 带占位符的项目采用 HTML/XML 文本模式，但只发送 `<gN>` / `<xN/>` 与文本，不发送真实网页 HTML/属性。
  返回占位符必须数量一致且正确嵌套；否则降为转义纯文本草稿。所有结果仍经安全 DOM 构造，不进入 `innerHTML`。
  MT/LLM 分层缓存，MT 缓存键包含引擎、源/目标语言和源文本。
- 内容脚本复用同一个 `dl-t`，以 `data-dl-stage` 标识草稿/终稿，`data-dl-engine` 区分 MT 与 `llm`；精修失败保留草稿。不同长度译文仍可能改变段落高度；
  不承诺任意页面零布局位移。免费服务的网络耗时也无法保证 ≤1 秒，实际测量与真机验收必须单独报告。

- `content/main.js` 导出 `start(platform)`。扩展的 `loader.js` 构造 extension 平台后调用它；用户脚本的入口构造
  userscript 平台后调用它。内容脚本模块之间传递 `platform`，不读全局。
- background 里已有的 `createTranslator / createProviders({ fetchImpl }) / createCache / createHandlers`
  保持依赖注入；userscript 平台用 `platform.http` 包装出 `fetchImpl`，缓存用内存 LRU 加 `localArea` 持久化
  （上限 2 MB，超过按时间淘汰）。**不要**把译文缓存写进网页自己的 IndexedDB 或 localStorage。
- 用户脚本元数据：`@match *://*/*`、`@run-at document-idle`、`@noframes`、`@grant GM_xmlhttpRequest GM_getValue
  GM_setValue GM_deleteValue GM_registerMenuCommand GM_addValueChangeListener`、`@connect *`、`@downloadURL`/`@updateURL`
  指向 GitHub Release 的最新版地址。

`http.onText(delta,status,headers)` 提供新增文本片段，最终仍返回完整 `text`。扩展用流式 fetch，用户脚本用 GM progress/readystatechange；无增量回调时在 onload 解析。provider `chat({profile,messages,signal,onDelta?})` 的 `onDelta(text)` 只提供脱敏内容，不显示推理字段。请求 `stream:true`，不支持时回退非流式；完整 JSON 验证后才写缓存，恢复/取消后不插入迟到片段。

两种平台按每个正文单元的源节点 Range 判断可见性，避免小说共用高 `<p>` 时触发整篇请求；滚动、模式切换和译文布局变化仍发现该宿主内较远段落。日译中疑似回显在流式显示前检查；漏翻缩批与 JSON 错项恢复共用有限重试预算。请求的等待与流式空闲超时沿用用户配置，输出进展会重置空闲计时器。

漫画名单 `comics.canvasSites` 兼容域名字符串与 `{host,imageHosts?,referer?}`；CDN 最多八个具体域名，Referer 限该站点 HTTP(S) 根地址。旧 Pixiv 字符串项使用 `i.pximg.net` / `https://www.pixiv.net/` 兼容元数据。扩展会话 DNR 规则必须含 `initiatorDomains:[chrome.runtime.id]` 与 `resourceTypes:['xmlhttprequest','other']`，关闭漫画或移出名单即删除，不新增 host 权限。用户脚本匿名 GM 取图按匹配站点设置 Referer，不支持请求头或本地 OCR 时保留原图并明确降级。

### iframe 增量（v0.5 开发中）

v1 按需权限增量：扩展移除静态内容脚本和必需 `<all_urls>`。手动入口先使用 `activeTab` + `scripting` 确保顶层注入；
跨域 frame 只由拥有可选广泛权限、且存在常驻功能 / 自动规则时的动态注册覆盖。注册使用 `allFrames:true` 与
`matchOriginAsFallback:true`，后者是 Chrome 动态 API 中覆盖 about:blank/srcdoc 等派生文档的字段。
`tab-ensure`、撤销设置回退及 UI 通知键见 [SPEC 按需注入](SPEC.md#按需注入与可选网站权限v1-增量)。
用户脚本权限和启动包保持原契约，不引入扩展权限 API。下文旧静态 all_frames / 不新增主机声明由本段取代。

扩展与用户脚本由顶层控制器递归发现同源 iframe（含无 src、about:blank、srcdoc），
复用扫描、变更观察、Range 懒加载与恢复；frame 内临时注入内容 CSS，停止时移除。
监听 load、DOM 变更和 frame 尺寸事件发现 Document/body 替换，以覆盖 document.open/write/close 的邮箱正文；扫描根不使用周期定时器。
Range 按祖先 frame 的视口裁切并映射至控制器视口；隐藏或小于 200×100 的 frame 不参与。

扩展内容脚本 all_frames:true、match_about_blank:true；同源父文档可访问时子脚本退出，避免重复翻译。
跨域子文档只启动无 UI 代理，通过后台按浏览器提供的 tabId/frameId 向 frameId:0 查询顶层状态，
启动请求一次快照，之后只接收翻译/恢复、显示模式和设置变化的推送；站点规则与请求上下文取顶层页面。
代理用 IntersectionObserver 的实际相交区域跳过隐藏、离屏或完全被裁切的 frame，并跳过视口小于 200×100 的 frame。
可见性由 IntersectionObserver、ResizeObserver 和 visibilitychange 本地驱动，不查询后台、不使用过期计时器。
跨域 frame 隐藏（含 display:none）时保留已有译文，不再发起新请求；顶层恢复和显示模式推送不受可见性影响，立即应用。
重新可见且顶层仍在翻译时，依靠 IntersectionObserver/ResizeObserver 事件在 1 秒内继续新可见内容；不增加父子可见性提示通道或定时补查。
顶层通过 frame-publish 广播 frame-state；后台只接受 frameId:0 发布者，顶层忽略广播、子 frame 消费推送。
快照与推送均带 `confirmedDestinations:string[]`；顶层确认当前页面的全部候选去向后才发布可激活状态。
子代理只允许该列表覆盖的去向，不读取本机确认状态来抢先翻译，也不创建确认 UI。
空闲且未翻译时没有周期定时器或周期消息；顶层进度统计包含同源文档，不汇总独立跨域代理计数。
不新增 permissions/host_permissions，不通过网页 postMessage 传递状态或配置。
用户脚本仍保留 @noframes，仅由顶层访问同源文档，**不支持跨域 iframe**。
浏览器禁止注入的特殊页面、非 HTML 文档仍不处理；这不代表真实邮箱页面或物理设备已验收。

开放 ShadowRoot 与同源 iframe 文档共用 FrameRoots 的额外扫描根生命周期，递归发现、注入/移除样式并观察变化。
slot 分配内容只在 light DOM 源位置扫描；存在分配内容时不扫描 slot fallback。动态新增的开放组件也会被发现。
关闭的 shadow root 不可访问，跳过；DualLens 自身 closed-shadow UI 保持原样。

### v1 页面首次发送确认

`content/confirmation.js` 在内容侧包装 `TranslatorService`，扩展与用户脚本共用。
页面、划词、悬停、输入框、字幕与漫画的文字请求在放行前使用 `shared/device-state.js`
检查本机 `ui.device.acked`；本地回环和演示免确认。主引擎与可能的备用去向一并列出，
同意后逐个 `acknowledge`，关闭或 Esc 则本次不发送；不把确认状态写入同步设置。
临时服务选择也参与检查，同一批并发请求共用卡片；取消、服务变更使等待中的请求失效。
`translateBatch` 继续支持可选 `done`，等待期间的取消不得启动迟到的请求。
首次缺少 OCR 语言包时，另行确认下载；已经安装的语言包直接复用。

页面 UI 使用 closed shadow root 内的设计令牌。悬浮按钮为桌面 36px / 触屏 44px，
`floatBall.autoHide !== false` 时空闲 2.5 秒只露出 24px；长按、菜单键和 Shift+F10
可打开菜单。划词临时服务选择收进「更多」，关闭功能会立即卸下其被动监听和界面。
侧边栏及用户脚本文本/字幕文件工具使用同一门禁，在工具内显示相同文案；取消或关闭不会发送等待中的内容。
专项离线验收入口为 `tests/e2e/run_page_ui_e2e.py`；真实设备验收仍按移动清单执行。

## 2. 打包

- 扩展保持零构建：`extension/` 目录可直接加载。
- `scripts/build_userscript.mjs`（Node 标准库，**不引入 npm 依赖**）把用户脚本入口及其静态 `import` 图打包成一个
  IIFE：每个模块包进函数作用域，`import`/`export` 改写成模块表查找。只支持本仓库用到的语法（具名导入导出、
  `export default`、`import * as`）；遇到动态 `import()` 或不支持的语法就报错退出，不要静默生成坏文件。
  CSS 内联成字符串，由平台注入到 `<style>`（`GM_addStyle` 不可用时用 `document.head.append`）。
- 产物 `dist/duallens.user.js`、`dist/duallens.bookmarklet.js` 由 `scripts/build_release.py` 一起生成，并进入
  Release 资产与 SHA-256 校验文件。Edge 商店包由 `build_release.py --target edge-store` 生成：去掉 manifest 里的
  `key` 字段，其余与 zip 相同。
- v0.5 用户脚本将共享设置表单（`ui/forms/**`、`ui/validation.js` 及面板专用依赖）拆为
  `dist/duallens-settings.js`，随 Release 发布并进入 `SHA256SUMS`。启动脚本以 `@resource duallens-settings`
  引用当前 manifest 版本的 `releases/download/v{version}/duallens-settings.js#sha256=…`；
  首次从菜单打开底部弹出页、设置或文本/字幕工具时才读取 `GM_getResourceText`，按启动脚本内嵌的字节数和 SHA-256 校验后在隔离沙箱执行。
  打开面板不联网；缺失、校验或执行失败时按界面语言显示错误与重新安装说明。HTTP 页同样在本地校验。
  已加载表单在当前文档内复用，关闭时仍销毁实例；扩展 options 继续直接导入原生模块。
  v1 中英双语启动包预算 ≤345000 字节；按入口依赖裁剪词典，设置和面板专用文案保留在按需资源中。

## 3. 设置 v3：可同步设置与机密分离

- v1 界面增量：`floatBall.autoHide:boolean` 默认 `true`，随公共设置同步；新安装的 `targetLang` 匹配浏览器界面语言（中文地区/文字变体分别匹配简繁），不支持时回退 `zh-CN`，已有选择保持不变。
- `ui.device` 独立存在 `localArea`，包含 `onboarded`、`acked`、`upgradeNoticeSeen`，不进入设置分片、明文或加密配置；恢复默认保留它和本机密钥。旧版迁移确实关闭过更多功能时，记录本机一次性升级提示。

- `syncArea` 存非机密设置，`localArea` 存 `secrets`：`{ [profileId]: { apiKey } }`。API key **永远**不进同步区、
  不进导出（除非走加密导出）、不进日志、不进页面上下文以外的任何地方。
- `chrome.storage.sync` 单项上限 8 KB、总量 100 KB：设置拆成 `settings.core`、`settings.glossary`、`settings.sites`
  三个键；任何一项超限就整体退回 `localArea`，并在设置页提示「此设备未同步」。
- v1 旧配置先把 `provider.profiles[].apiKey` 移入 `secrets`，已有本机密钥及清除标记优先。
- v2 → v3：旧 `kind:'gateway'` 仅转为 `kind:'openai'`，保留 id/name/baseUrl/model/fallbackModels/jsonMode/maxItems/maxChars/concurrency/timeoutMs 与 chain 引用；同一 secrets 槽中的令牌继续作为 Bearer key。一次性把 floatBall/selection/hover/input/comics 的 enabled 设为 false；其它设置保留。扩展、GM 私有存储及旧版加密导入共用迁移，新版重新开启的功能不再重置。
- 新安装默认不自动翻译网站，floatBall/selection/hover/input/comics/subtitles 默认关闭。用户可在设置中显式开启更多功能。右键仅 page 翻译/显示原文、selection 翻译选中文字、video 视频双语字幕、comics 开启后的 image 翻译图片文字；显式选中文字入口始终可用。
- 统一入口 `createSettingsStore({ syncArea, localArea })`，返回
  `{ load(), save(patch), getSecret(id), setSecret(id, key), onChange(cb) }`。旧的 `loadSettings/saveSettings`
  改为基于默认平台的薄包装，保持现有调用不坏。
- 可选的 `browserLanguage` 注入浏览器界面语言，仅影响新安装默认目标语言；省略时用 navigator.language。默认扩展 UI 存储包装器从 chrome.i18n.getUILanguage 传入，已保存的目标语言始终优先。
- **跨 profile 的备选链**：`provider.chain = [{ profileId, model }, …]`。冷却仍以「profile + 模型」为单位，429/502/503/
  连接失败时立刻换下一项（SPEC §8 的规则不变，只是范围从一个 profile 扩大到整条链）。
- **服务商预设** `extension/shared/presets.js`：OpenAI、DeepSeek、OpenRouter（免费模型发现）、Ollama（`http://localhost:11434/v1`）、LM Studio（`http://localhost:1234/v1`）及自定义。Ollama 需配置 `OLLAMA_ORIGINS` 允许扩展来源。其它设备须使用它们可以访问的服务地址；无需任何固定本机服务。
- **OpenRouter 免费模型**：`GET https://openrouter.ai/api/v1/models`（公开、无需 key），筛出输入输出单价都为 0 的模型，
  按上下文长度和是否支持 `response_format` 排序供用户挑选；请求头带 `X-Title: DualLens`。免费档有每分钟和每日上限，
  所以默认链里放 2 到 3 个不同厂商的免费模型。
- **首次上手**：第一次打开弹出页时显示语言、翻译方式/去向、完成三步，可跳过；完成不触发翻译。确认免费翻译时记录微软和谷歌两个去向，跳过不确认。AI 服务在设置中主动保存并获得来源权限后确认实际来源。
- 设置按 `common/ai/enhance/sites/glossary/data/about` 七组显示，即时字段自动保存，AI、网站规则和术语表使用分组保存/取消。资源入口为 `userscript/ui-resource.js`，提供 `mountSettingsForm.mountPopup`、`createPopupPanel` 与 `createMediaPanel`；手机底部面板、上手/升级卡片、设置及文本/字幕工具均按需加载，启动图只保留页面功能和轻量菜单注册。
- 用户脚本的 key 与备份口令只能通过 `platform.promptSecret` 输入。API key 区只显示「已设置 / 未设置」及设置、清除按钮，
  不创建 key/password 输入框；原生对话框不得预填旧值，也不得调用网页的 `window.prompt`。页面的 composed 输入事件可穿过 closed shadow root，不能依赖圆点编辑器隔离密钥。
  真机验收必须确认 Tampermonkey 启用了隔离世界；[官方 sandbox 文档](https://www.tampermonkey.net/documentation.php?q=sandbox)说明 DOM 模式在隔离上下文未启用时可能使用其他已启用上下文，不能将页面世界运行作为安全配置。
- **加密导出/导入**（在两台电脑和手机之间搬配置）：PBKDF2-SHA256（≥ 310,000 次迭代）派生密钥，AES-GCM 加密，
  格式 `duallens-config:v1:<base64url(salt|iv|密文)>`。不填口令时导出的明文 JSON **不含**任何 key。
- 共享表单通过可选 `platform.renderQr` 显示加密导出二维码；不静态导入二维码模块。缺少该能力时显示可复制的加密文本，导出/导入功能保持可用。
  用户脚本启动产物硬上限收紧到 345000 字节；不包含二维码编码器、PDF.js / PDF 阅读页或扩展侧栏入口；共用的文本/字幕页签仍保留。
- 非机密字幕偏好 `subtitles = { enabled:false, mode:'bilingual', fontSize:22, position:'bottom' }` 随公共设置同步与备份。
  `mode` 为 `bilingual` / `translation-only`，字号为 16–48 的整数，位置为 `top` / `bottom`；旧备份缺少该字段时恢复默认值。

### 自定义 API 地址与操作反馈（v1 修复）

根地址（无路径或 `/`）在模型发现、chat 请求返回 HTML 或 HTTP 404 时，仅加 `/v1` 重试一次；
401/403 直接提示密钥或权限问题，不进行地址重试。显式路径从不补 `/v1`，网络/超时也不触发地址重试。
成功解析后可选 `baseUrl` 返回规范地址，设置表单更新输入并说明自动补全；失败不改输入。
同一 provider 实例记住已证实需补 `/v1` 的根地址，之后直接请求 `/v1`，不再每批先探根地址。
保存当前服务时只移除地址末尾 `/`：部分服务确实在根地址提供接口，未经探测不补 `/v1`。不新增权限或固定服务依赖。
provider 内部 `listModels` 选项及 `chat` 参数接受可选 `onBaseUrl(url)`，仅在成功后回调；
既有模型数组、chat 字符串返回类型保持不变，不原地修改传入 profile。

网页响应提示 API 地址通常以 `/v1` 结尾；其他非 JSON 提示 HTTP 状态和脱敏后的前 80 字符（压成单行），
401/403、404 分别给出可操作提示；设置页「测试连接」缺少模型时引导先获取模型（运行时仍用简短的「尚未选择模型」，以守住用户脚本启动预算）。中英词典由同一同步脚本生成，扩展与用户脚本共用。
共享设置表单的异步按钮立即禁用、替换进行中文案并清空旧结果，结束恢复按钮；
结果在 `aria-live="polite"` 区域显示 `HH:MM:SS · 文案` 并淡入 150ms，减少动效时不播放。
保存成功仍只使用页标题旁的「已保存」。


## 4. 移动端体验

### 站点规则（v0.5 增量）

扩展设置与手机用户脚本面板复用同一个路径/功能编辑器：`settings.sites.siteRules.custom` 中的规则可写
`{match:'example.com/mail/*',page:'never',selection:'off',hover:'off',input:'default'}`。
page 使用 `always/never/default`，其余使用 `on/off/default`，缺省继承全局；旧域名列表与选择器规则无需迁移。
match 可含 HTTP(S) 协议、端口和任意 `*` 路径通配，忽略网页查询串/片段；域名不分大小写，路径区分大小写和末尾斜杠。
最长非通配路径、最少通配符的规则优先，完整排序、旧格式继承和校验约束见 [SPEC §3.1](SPEC.md#31-站点与路径规则v05-增量)。
never 仅阻止自动网页翻译并隐藏悬浮按钮，用户仍能用弹出页、快捷键或用户脚本菜单手动翻译；
这修正了 v0.4 实际代码连手动入口一起禁用的行为。selection/hover/input 关闭时对应被动 UI 与事件禁用；右键选中文字始终可用，
触屏长按受 hover 控制。SPA 路由变化重新判定，独立监听在未翻译状态仍有效。
规则与翻译共用同一窗口/隔离世界的路由检测器：支持 Navigation API 时监听 `navigatesuccess` / `currententrychange`，
并保留 `popstate` / `hashchange`，不轮询；仅不支持时以 1 秒轮询兜底，页面隐藏时暂停，重新可见时立即检查。
弹出页可选整个站点或当前第一段路径；手机面板可直接编辑同样的路径规则和四项开关。
新增字段继续进入非机密同步/明文及加密备份，不改变 GM 私有存储与真机验收边界。

### 输入、划词与悬停（v0.5 增量）

- `input.mode:'replace'|'bilingual'`（默认 replace），`input.order:'source-first'|'translation-first'`（默认 source-first）。
  双语仅组合本次选中文字和译文；textarea/contenteditable 以换行、单行 input 以空格分隔。选区外文本保留。
  原有语言前缀与三空格触发仍可用；三空格产生的尾随空格不保留在翻译结果中。
- `input` 与 `hover` 各增加 `profileId:''`、`model:''`：空 profileId 继承网页链/翻译模式；指定已有 profile 时，
  单次请求带 profileId/model 与 `mode:'llm'`，空模型使用该服务默认模型。继承时忽略 model。
  划词卡片可临时选择已有服务及填写模型，点击“重新翻译”生效；新卡片回到继承，不保存临时选择。
  沿用后台单次覆盖语义：指定候选优先，既有网页链仍可作为备选，但持久链、active 与服务默认模型均不改写。
- 悬停指定服务经控制器私有 client 的服务适配器，按单元使用现有一次性文本接口，返回安全转义的纯文本译文；
  原网页 DOM 与控制器插入/恢复、进度及取消流程不变。取消丢弃迟到结果；一次性接口不支持中止已发 HTTP。
  继承服务时保留原有带格式合批路径。
- 写回依次尝试原生 setter + input（表单）或局部 Range + input（contenteditable）、execCommand、可取消的 beforeinput。
  每次经过一个 32ms 任务等待后读回完整字段，必须与预期一致；编辑器返回成功但未接收结果仍继续尝试。
  非预期内容变化立即停止，不用下一策略覆盖；全部拒绝时显示中文提示和可选的复制译文按钮/只读文本。
  不向编辑器传 HTML。组合输入期间不触发；等待期间任何 input/beforeinput/compositionstart、富文本 DOM 变动、
  功能停用或节点失效都会使旧结果失效（含编辑后撤销）。不保证识别无事件且改回原值的表单脚本改写，或 32ms 后才发生的任意编辑器回滚。
  富文本使用文本节点、BR 与常见块标签的文本视图；无法安全映射的选区拒绝写回。真实编辑器与物理 Android 仍需人工验收。

- 触屏没有 Shift 悬停：「悬停翻译」在触屏上换成**长按段落 500ms**，可在设置里关闭。
- 划词图标放在选区**下方**，避开系统选择菜单；所有触控目标 ≥ 44px；悬浮按钮用 pointer 事件拖动，并避开安全区。
- 设置面板在窄屏（< 600px）上是全屏底部弹出层；扩展的 popup 与 options 也要能在窄窗口里正常用。
- 性能默认值按 `matchMedia('(pointer: coarse)')` 区分：移动端并发 2、每批最多 12 段、`rootMargin` 400px，切段与插入用
  `requestIdleCallback` 分片，单次主线程任务 < 50ms。
- 输入框三连空格在移动输入法下不可靠：用户脚本里同时提供悬浮按钮菜单的「翻译当前输入框」。

## 5. 书签脚本（P1，尽力而为）

- Android 上的 Chrome 只能用书签：配置页（GitHub Pages，纯前端）把配置和 key 内嵌进一个 `javascript:` 书签，
  key 只在本机浏览器里生成，不上传。书签加载与用户脚本相同的打包产物。
- 风险必须在配置页写明：书签代码运行在网页自己的上下文里，网页脚本理论上能截获 key；网页的 CSP 可能挡住请求。
  建议为书签单独建一个**只用免费模型、额度上限设为 0** 的 OpenRouter key。

## 6. Edge Add-ons 上架

- 商店包去掉 manifest 的 `key` 字段，由商店分配扩展 ID；不分发签名私钥。
- 上架材料放 `docs/store/`：中英文简介与详细说明、每项权限（尤其 `<all_urls>`）的用途说明、截图（1280×800，由 mock E2E
  生成）、小宣传图 440×280。隐私政策 `docs/PRIVACY.md`：开发者不接收任何数据；网页文字只发往用户选择的翻译服务（默认微软免费翻译，失败时谷歌），商店按「网站内容」与「身份验证信息」申报。
- **提交由用户本人用自己的开发者账号完成**；我们只准备材料。

## 7. 验收矩阵

| 环境 | 必测 |
| --- | --- |
| 桌面 Chrome、Edge（扩展） | 现有 E2E 全部通过；设置同步与机密不同步；加密导入导出往返 |
| 桌面 Chromium + Tampermonkey 等价的 GM 桩（用户脚本） | 同一套 E2E 夹具用例：翻译、恢复、仅译文、动态内容、划词、设置面板 |
| 移动端模拟（Chromium 设备模拟，375×812 与 800×1280，`pointer: coarse`） | 长按翻译、划词图标位置、悬浮按钮拖动、设置面板可用、长页面滚动无卡顿（主线程长任务 < 50ms 的占比） |
| 真机 Android Edge + Tampermonkey | 用户手动验收（我们提供逐步清单） |
| 真实服务 | OpenRouter 免费模型一条链路（key 由用户放进环境变量 `DUALLENS_OPENROUTER_KEY`，测试从环境变量读取，不落盘） |

配置导入可调用 `store.save(settings, {preserveProvider:true})` 保留服务默认模型与 chain 的独立值；日常保存仍对齐链首项。

## v1 PDF 显式入口

扩展弹出页先 `pdf-status` 检查实际标签页；点「用 DualLens 打开此 PDF」后，`pdf-open` 在后台借当前标签页的 activeTab 权限匿名取回字节。
沿用 30 秒、64 MiB 和签名检查；不向网页申请常驻权限。字节暂存扩展来源 IndexedDB（不进 sync），以随机一次性令牌打开阅读器；
阅读器原子读取并删除，随即从地址栏移除令牌。未读取记录最多保留三份，五分钟后拒绝读取，下次写入清除过期记录。
`pdf-status` / `pdf-open` 仅接受扩展自有页面发送者，忽略消息自带文件 URL。其他 `?file=` 来源先检查授权，缺少时由阅读器按钮手势调用 `requestOrigin`；本地文件仍可直接选择。
