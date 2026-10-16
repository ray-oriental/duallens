# 多平台与通用配置契约（v0.4.0）

状态：2026-10-13 起草，主控维护。本文件与 [SPEC.md](SPEC.md) 同级，接口变更先改这里。

## 目标

DualLens 是**通用浏览器插件**，不是某台电脑上的服务。任何人填入自己的模型服务配置即可使用；
本机网关只是桌面端的可选增强。同一份核心代码必须在下列环境里正确、流畅地运行：

| 目标 | 设备与浏览器 | 形态 | 安装 |
| --- | --- | --- | --- |
| `extension` | Windows / macOS / Linux 上的 Chrome、Edge（两台电脑） | MV3 扩展（现有） | Edge Add-ons 商店；GitHub Release zip 作为备用 |
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
  openSettings(): void;     // extension：打开 options 页；userscript：打开页内设置面板
  promptSecret(label: string): string | null; // userscript：隔离沙箱原生 prompt，默认空值；取消返回 null
                            // extension：返回 null；其独立 options 页面保留 password 输入框
  registerCommand(id, label, handler): void;  // userscript：GM_registerMenuCommand；extension：commands 已在 manifest
  renderQr?(canvas: HTMLCanvasElement, text: string): void | Promise<void>;
                            // 可选：仅扩展 options 提供本地二维码渲染；内容平台与 userscript 不加载编码器
}

export interface TranslatorService {
  translateBatch({ items, to, from, priority, context, draft?, purpose?, mode? }, onPartial): { cancel(), done? };
  translateText({ text, to, from, purpose, mode? }): Promise<{ ok, text?, by?, engine?, error? }>;
  listModels(profileId): Promise<{ ok, models? }>;
  testProvider(profileId): Promise<{ ok, latencyMs?, sample?, error? }>;
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
译文颜色按原文字色与祖先纯色背景调和，计算对比度至少 4.5；背景图、渐变与祖先 opacity/filter 的最终像素对比度仍需真实页面检查。
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

两种平台按每个正文单元的源节点 Range 判断可见性，避免小说共用高 `<p>` 时触发整篇请求；滚动、模式切换和译文布局变化仍发现该宿主内较远段落。日译中疑似回显在流式显示前检查；漏翻缩批与 JSON 错项恢复共用有限重试预算。SJTU 请求的空闲等待上限为 12 秒，输出进展会重置，其它端点保留用户配置。

漫画名单 `comics.canvasSites` 兼容域名字符串与 `{host,imageHosts?,referer?}`；CDN 最多八个具体域名，Referer 限该站点 HTTP(S) 根地址。旧 Pixiv 字符串项使用 `i.pximg.net` / `https://www.pixiv.net/` 兼容元数据。扩展会话 DNR 规则必须含 `initiatorDomains:[chrome.runtime.id]` 与 `resourceTypes:['xmlhttprequest','other']`，关闭漫画或移出名单即删除，不新增 host 权限。用户脚本匿名 GM 取图按匹配站点设置 Referer，不支持请求头或本地 OCR 时保留原图并明确降级。

## 2. 打包

- 扩展保持零构建：`extension/` 目录可直接加载。
- `scripts/build_userscript.mjs`（Node 标准库，**不引入 npm 依赖**）把用户脚本入口及其静态 `import` 图打包成一个
  IIFE：每个模块包进函数作用域，`import`/`export` 改写成模块表查找。只支持本仓库用到的语法（具名导入导出、
  `export default`、`import * as`）；遇到动态 `import()` 或不支持的语法就报错退出，不要静默生成坏文件。
  CSS 内联成字符串，由平台注入到 `<style>`（`GM_addStyle` 不可用时用 `document.head.append`）。
- 产物 `dist/duallens.user.js`、`dist/duallens.bookmarklet.js` 由 `scripts/build_release.py` 一起生成，并进入
  Release 资产与 SHA-256 校验文件。Edge 商店包由 `build_release.py --target edge-store` 生成：去掉 manifest 里的
  `key` 字段，其余与 zip 相同。

## 3. 设置 v2：可同步设置与机密分离

- `syncArea` 存非机密设置，`localArea` 存 `secrets`：`{ [profileId]: { apiKey } }`。API key **永远**不进同步区、
  不进导出（除非走加密导出）、不进日志、不进页面上下文以外的任何地方。
- `chrome.storage.sync` 单项上限 8 KB、总量 100 KB：设置拆成 `settings.core`、`settings.glossary`、`settings.sites`
  三个键；任何一项超限就整体退回 `localArea`，并在设置页提示「此设备未同步」。
- v1 → v2 迁移：把 `provider.profiles[].apiKey` 移入 `secrets`，`version` 改为 2，迁移幂等。
- 统一入口 `createSettingsStore({ syncArea, localArea })`，返回
  `{ load(), save(patch), getSecret(id), setSecret(id, key), onChange(cb) }`。旧的 `loadSettings/saveSettings`
  改为基于默认平台的薄包装，保持现有调用不坏。
- **跨 profile 的备选链**：`provider.chain = [{ profileId, model }, …]`。冷却仍以「profile + 模型」为单位，429/502/503/
  连接失败时立刻换下一项（SPEC §8 的规则不变，只是范围从一个 profile 扩大到整条链）。
- **服务商预设** `extension/shared/presets.js`：OpenRouter（默认推荐，`https://openrouter.ai/api/v1`，可获取免费模型）、
  DeepSeek、硅基流动、智谱、月之暗面、OpenAI、Google Gemini（OpenAI 兼容端点）、Groq、交大
  （`https://models.sjtu.edu.cn/api/v1`，填你自己的 key）、Ollama（可填局域网地址）、DualLens 本机网关、自定义。
  每个预设给出 `baseUrl`、是否需要 key、获取 key 的说明链接、`jsonMode` 默认值和推荐批量参数。
- **OpenRouter 免费模型**：`GET https://openrouter.ai/api/v1/models`（公开、无需 key），筛出输入输出单价都为 0 的模型，
  按上下文长度和是否支持 `response_format` 排序供用户挑选；请求头带 `X-Title: DualLens`。免费档有每分钟和每日上限，
  所以默认链里放 2 到 3 个不同厂商的免费模型。
- **首次使用向导**：设置页第一次打开、或当前链里没有一个可用 profile 时显示：选预设 → 填 key → 获取模型 → 测试连接 →
  保存。用户脚本的页内设置面板用同一组表单组件。
- 用户脚本的 key 与备份口令只能通过 `platform.promptSecret` 输入。API key 区只显示「已设置 / 未设置」及设置、清除按钮，
  不创建 key/password 输入框；原生对话框不得预填旧值，也不得调用网页的 `window.prompt`。页面的 composed 输入事件可穿过 closed shadow root，不能依赖圆点编辑器隔离密钥。
  真机验收必须确认 Tampermonkey 启用了隔离世界；[官方 sandbox 文档](https://www.tampermonkey.net/documentation.php?q=sandbox)说明 DOM 模式在隔离上下文未启用时可能使用其他已启用上下文，不能将页面世界运行作为安全配置。
- **加密导出/导入**（在两台电脑和手机之间搬配置）：PBKDF2-SHA256（≥ 310,000 次迭代）派生密钥，AES-GCM 加密，
  格式 `duallens-config:v1:<base64url(salt|iv|密文)>`。不填口令时导出的明文 JSON **不含**任何 key。
- 共享表单通过可选 `platform.renderQr` 显示加密导出二维码；不静态导入二维码模块。缺少该能力时显示可复制的加密文本，导出/导入功能保持可用。
  用户脚本启动产物硬上限仍为 400000 字节，本轮构建目标及检查收紧到不超过 360000 字节；不包含二维码编码器、PDF.js / PDF 阅读页或扩展侧栏入口；共用的文本/字幕页签仍保留。
- 非机密字幕偏好 `subtitles = { enabled:false, mode:'bilingual', fontSize:22, position:'bottom' }` 随公共设置同步与备份。
  `mode` 为 `bilingual` / `translation-only`，字号为 16–48 的整数，位置为 `top` / `bottom`；旧备份缺少该字段时恢复默认值。

## 4. 移动端体验

- 触屏没有 Shift 悬停：「悬停翻译」在触屏上换成**长按段落 500ms**，可在设置里关闭。
- 划词图标放在选区**下方**，避开系统选择菜单；所有触控目标 ≥ 44px；悬浮球用 pointer 事件拖动，并避开安全区。
- 设置面板在窄屏（< 600px）上是全屏底部弹出层；扩展的 popup 与 options 也要能在窄窗口里正常用。
- 性能默认值按 `matchMedia('(pointer: coarse)')` 区分：移动端并发 2、每批最多 12 段、`rootMargin` 400px，切段与插入用
  `requestIdleCallback` 分片，单次主线程任务 < 50ms。
- 输入框三连空格在移动输入法下不可靠：用户脚本里同时提供悬浮球菜单的「翻译当前输入框」。

## 5. 书签脚本（P1，尽力而为）

- Android 上的 Chrome 只能用书签：配置页（GitHub Pages，纯前端）把配置和 key 内嵌进一个 `javascript:` 书签，
  key 只在本机浏览器里生成，不上传。书签加载与用户脚本相同的打包产物。
- 风险必须在配置页写明：书签代码运行在网页自己的上下文里，网页脚本理论上能截获 key；网页的 CSP 可能挡住请求。
  建议为书签单独建一个**只用免费模型、额度上限设为 0** 的 OpenRouter key。

## 6. Edge Add-ons 上架

- 商店包去掉 `key`，商店分配的扩展 ID 与开发版不同：网关默认的 Origin 白名单要同时允许商店 ID（写进
  `gateway.example.json` 的说明，用户在本机配置里加）。
- 上架材料放 `docs/store/`：中英文简介与详细说明、每项权限（尤其 `<all_urls>`）的用途说明、截图（1280×800，由 mock E2E
  生成）、小宣传图 440×280。隐私政策 `docs/PRIVACY.md`：不收集任何数据；网页文本只发往用户自己选的模型服务。
- **提交由用户本人用自己的开发者账号完成**；我们只准备材料。

## 7. 验收矩阵

| 环境 | 必测 |
| --- | --- |
| 桌面 Chrome、Edge（扩展） | 现有 E2E 全部通过；设置同步与机密不同步；加密导入导出往返 |
| 桌面 Chromium + Tampermonkey 等价的 GM 桩（用户脚本） | 同一套 E2E 夹具用例：翻译、恢复、仅译文、动态内容、划词、设置面板 |
| 移动端模拟（Chromium 设备模拟，375×812 与 800×1280，`pointer: coarse`） | 长按翻译、划词图标位置、悬浮球拖动、设置面板可用、长页面滚动无卡顿（主线程长任务 < 50ms 的占比） |
| 真机 Android Edge + Tampermonkey | 用户手动验收（我们提供逐步清单） |
| 真实服务 | OpenRouter 免费模型一条链路（key 由用户放进环境变量 `DUALLENS_OPENROUTER_KEY`，测试从环境变量读取，不落盘） |

2026-10-14 授权探测中，Hermes ling-3.1-flash 与 longcat-2.0:free 返回 404，solar-mini4:free 返回中文成功。因此默认 allowlist 与一键接入仅自动选入 Solar，仍须出现在实时目录中；其它模型可由用户显式配置并手选，不更改现有设备配置。
