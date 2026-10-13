# 多平台与通用配置契约（v0.2）

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
  http(req: { url, method, headers, body, timeoutMs, signal }): Promise<{ status, headers: { get(name) }, text }>;
                            // extension 用 fetch（在 service worker 里，无 CORS 限制）；userscript 用 GM_xmlhttpRequest
  translator(): TranslatorService;  // extension：经端口连 service worker；userscript：在页面内直接实例化
  detectLanguage(text): Promise<{ lang, reliable } | null>;  // extension 用 chrome.i18n；其余回落到 shared/lang.js 启发式
  openSettings(): void;     // extension：打开 options 页；userscript：打开页内设置面板
  promptSecret(label: string): string | null; // userscript：隔离沙箱原生 prompt，默认空值；取消返回 null
                            // extension：返回 null；其独立 options 页面保留 password 输入框
  registerCommand(id, label, handler): void;  // userscript：GM_registerMenuCommand；extension：commands 已在 manifest
}

export interface TranslatorService {
  translateBatch({ items, to, from, priority, context }, onPartial): { cancel() };
  translateText({ text, to, from, purpose }): Promise<{ ok, text?, error? }>;
  listModels(profileId): Promise<{ ok, models? }>;
  testProvider(profileId): Promise<{ ok, latencyMs?, sample?, error? }>;
}
```

- `content/main.js` 导出 `start(platform)`。扩展的 `loader.js` 构造 extension 平台后调用它；用户脚本的入口构造
  userscript 平台后调用它。内容脚本模块之间传递 `platform`，不读全局。
- background 里已有的 `createTranslator / createProviders({ fetchImpl }) / createCache / createHandlers`
  保持依赖注入；userscript 平台用 `platform.http` 包装出 `fetchImpl`，缓存用内存 LRU 加 `localArea` 持久化
  （上限 2 MB，超过按时间淘汰）。**不要**把译文缓存写进网页自己的 IndexedDB 或 localStorage。
- 用户脚本元数据：`@match *://*/*`、`@run-at document-idle`、`@noframes`、`@grant GM_xmlhttpRequest GM_getValue
  GM_setValue GM_deleteValue GM_registerMenuCommand GM_addValueChangeListener`、`@connect *`、`@downloadURL`/`@updateURL`
  指向 GitHub Release 的最新版地址。

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
