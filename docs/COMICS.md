# 漫画网页翻译第一阶段

本分支提供桌面 MV3 本地 OCR，以及用户脚本的已显示 `<img>` 降级路径。原图不覆盖、不擦字、不重绘。这个阶段不能保证复杂漫画、特效字或 Pixiv 防盗链图片“完美翻译”。公开产品范围与跨平台契约由 leader 更新；本文件描述本分支实际实现。

## 使用与恢复

悬浮球菜单或桌面右键菜单选择“翻译此页漫画”；Tampermonkey 也注册同名菜单命令。原图旁会出现可折叠的原文/译文编号列表；窄于 600px 时放在原图下方。面板可选择日文横排、日文竖排、韩文或英文，再点“识别并翻译”。首次识别会下载所选 fast 语言数据。面板内“语言包”显示本设备已下载的语言、大小及删除按钮。

点击“高亮区域”只绘制临时边框，原图像素、属性和子节点不变；“上移”允许校正阅读顺序。面板中的“恢复原文”关闭当前图的旁列；“恢复漫画原文”菜单或 `restore-comics` 命令移除全部旁列和边框。导航及页面离开也会清理旁列。恢复阻止迟到的 OCR 结果继续发起文字翻译，但已经开始的本地下载/OCR 会在其有界任务内结束。

popup 尚待 UI 同事接入；设置页的语言包管理表单尚待设置同事接入。本分支不修改这些同事负责的表单文件。

## 模块与数据流

1. `content/comics/discovery.js` 发现当前选择的 `img.currentSrc`、懒加载 URL、srcset 后备、单层 CSS 背景及 canvas 来源。一次显式触发最多八张视口图片和下一张，不枚举网站 API，不自动抓后续页。默认图片最小显示尺寸为 280×280；只接受 HTTP(S)，不接受含用户名/密码的 URL、SVG、blob/data URL。
2. `content/comics/canvas-hook.js` 在 MAIN world 用 WeakMap 记录 `drawImage`、`createImageBitmap` 裁剪和 OffscreenCanvas bitmap 的来源。元数据通过有界 DOM 事件查询传回，不写页面 data 属性。普通裁剪/缩放和仿射变换可重建；嵌套 canvas 合成、透明混合、超过 64 片或超过四个来源会明确拒绝，避免给出错误重建。
3. `background/comics.js` 验证顶层扩展发送者，从 sender 取页面 referrer，使用 `fetch(url, {referrer: pageUrl, credentials:'omit', redirect:'error'})` 代取图。全标签页下载/OCR 并发最多二，等待队列最多十六。403 显示站点拒绝；不重试，不改 Referer，不读取 cookies。每个来源上限 16 MiB，OCR 原始解码像素上限 2400 万。
4. offscreen 按需创建，以 ready 握手消除初始化竞态。`language-store.js` 下载固定 commit 的 tessdata_fast，按精确大小和 SHA-256 校验后存到扩展自己的 `duallens-ocr-languages` IndexedDB；缓存读取也校验，错误缓存删除。语言数据不打包。
5. `offscreen/detector.js` 是原创、高对比文字的连通墨迹启发式：剔除大连通边框/画面，按字形尺寸合并横排或竖排列。它不是气泡、panel 或 SFX 模型。最多四十个候选区域；无法找到区域时回退 Tesseract 稀疏/竖排分段。扩展 OCR 图缩放到最多 600 万像素、长边 3200px，用户脚本最多 300 万像素、长边 2400px。
6. 未修改的 Tesseract.js/core 5.1.1 在本地 Worker 中运行 LSTM-only；每项解码/初始化/识别有 20s 总限时，语言数据下载另有 60s 限时。完成或超时均终止 Worker。只把 confidence≥30 的可信、归一化框与清洗文本返回内容模块。
7. `order.js` 按 panel（若将来检测器提供）、相对字高行带和语言方向排序。日文同带右到左，英文/传统韩文左到右，长条图按 y 排序。不具备 panel 检测时，多区域一律提示“顺序可能不确定”。
8. `controller.js` 只向现有 `TranslatorService.translateBatch` 发 OCR 文本；`context.title/host/url` 全为空。图片字节、图片 URL、页面 URL、cookie 不进入翻译请求。`panel.js` 只用 `textContent` 显示原文与模型回复。

## 用户脚本

`platform/userscript.js` 通过匿名 `GM_xmlhttpRequest(responseType:'blob')` 获取已显示图片；固定语言数据使用 `arraybuffer`、大小/SHA-256 校验，持久化到单独的 `duallens:ocr` GM 命名空间。网页的 IndexedDB/localStorage 不存图、OCR 文本、译文或语言数据。

`vendor/tesseract/userscript-sources.js` 是上游 core/worker 原文件的无损 JS 字符串容器，现有零依赖打包器将它们内嵌为单文件。`userscript-ocr.js` 用 Blob Worker 启动内嵌代码，直接通过上游 worker 协议传递校验后的语言字节；不下载或执行 CDN 代码。用户脚本 OCR 串行执行。WASM 或 Worker 被页面策略拦截时显示“此页无法本地识别”，不会回退上传图片。

当前用户脚本约 4.34 MB；这比原来的纯文字脚本大，需要真机验收加载、内存与滚动流畅度。代码不要求某台电脑的本地服务。Chrome Android 的安装入口、书签脚本和平台通用表单属于集成同事。

## 扩展接口（请 leader 纳入 PLATFORMS/SPEC）

新增可选平台成员：

```js
platform.comics = {
  recognize({url, slices?, width?, height?, lang}) => Promise<{
    ok, regions?: [{text, confidence, bbox:{x0,y0,x1,y1}}],
    width?, height?, metrics?, error?
  }>,
  languages(langToDelete?) => Promise<{ok, languages?: [{lang,bytes}], error?}>
};
```

`bbox` 坐标归一到识别图的 0..1 范围。新增内容命令 `translate-comics`、`restore-comics`；`get-state` 增加 `comics: [{status, items:[{original,translation}], language, metrics}]`。新增后台消息 `comic-ocr`、`comic-languages-list`、`comic-languages-delete`。内部 offscreen 消息带 `target:'comics-offscreen'`，只接受同扩展的后台发送者；普通 content tab 不能提交原始 OCR 字节给 offscreen。

`DEFAULT_SETTINGS` 只新增 `comics:{language:'jpn',visionEnabled:false}` 子对象。视觉模型目前没有实现，`visionEnabled` 不启用任何上传路径；`imageInput` 服务商能力标记、明确选择免费视觉模型及裁剪区域上传应另立接口。

## manifest 变更与来源

- 新增 `offscreen` 权限，理由是本地解码/Worker OCR；已有最低 Chrome 120 足够。
- 新增 `world:'MAIN'`、`document_start`、仅顶层 HTTP(S) 的原创 canvas 记录钩子，不扩大 host 权限。
- WAR 增加 `content/comics/*.js`，供隔离内容脚本的模块导入；未暴露 OCR worker、offscreen 或语言缓存。
- 扩展页 CSP 增加 `'wasm-unsafe-eval'`；`script-src/worker-src` 仍限定 `'self'`。
- 没有添加 DNR、cookies、webRequest 或任何远程代码权限。

来源/版本/许可证/每文件 SHA-256 和同名参考文件的纯哈希比对见 [VENDOR.md](../extension/vendor/tesseract/VENDOR.md)。npm 上游 worker 与独立 WASM 同参考文件哈希一致；两个 JS 分发文件不一致。本分支保留 npm 原件，没有用参考内容替换。API 行为依据 [上游 v5.1.1 文档](https://github.com/naptha/tesseract.js/blob/v5.1.1/docs/api.md)。

现有 release 白名单会遗漏 `VENDOR.md`、独立 `.wasm`、本文件及 portable 中的漫画 PNG 夹具；LICENSE.txt 均能打包，实际执行的 wasm.js 内嵌了同一 WASM，因此当前运行链路不依赖独立 .wasm。请集成同事审查 provenance 文档、测试图及独立资产的打包白名单，并保留许可证。当前 `check_project.py --dist-dir dist` 还因构建器加入用户脚本而校验器只接受两个 ZIP 的基线差异，报 `SHA256SUMS does not match expected versioned assets`；不能把构建成功等同于完整 release 校验成功。

## 验证与当前限制

从仓库根目录运行 `npm test`、`python -B -m unittest discover -s gateway/tests -t .`、`python -B scripts/check_project.py` 和 `python -B scripts/build_release.py`。现有浏览器回归使用 `tests/e2e/run_e2e.py --mock-only`。

漫画专项使用相同 canonical Session/staging/cleanup：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH="$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B tests/fixtures/comics/generate.py
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_comics_e2e.py
```

专项 E2E 的 fixed URL 响应用外部缓存中的原始上游 traineddata 离线替代，运行仍做 SHA-256 校验。首次准备数据时须将 `offscreen/languages.json` 指定的四个文件放到 `%USERPROFILE%\.cache\duallens-e2e\comics-data`；专项不会调用模型或登录网站。它验证日/韩/英真实本地 OCR、阅读顺序、只发文本的 loopback mock 请求体、原图 DOM/像素和恢复、语言包查看/删除/重下载/复用、窄屏、高亮/调序、GM blob/arraybuffer 和 CSP 失败、canvas 切片及 Referer 403。

已观察到清晰日文夹具把「こんにちは」识别为「こんにちちは」，其余五条韩/英/日文夹具文字正确。专项以文字相似度≥0.8 检查区域对应/顺序，同时保留完整实际识别结果，不把它记成 OCR 逐字完美。最近测量单图 OCR p50 约 2.25s；首次离线语言包加载+校验+持久化约 0.58–1.94s（不是网络下载 benchmark）。采样的 offscreen JS 堆约 32.7 MiB；这不包含 Worker WASM、图片原生解码或浏览器进程 RSS，不能视作总峰值内存。

未验证真实 Pixiv、用户的两台 Windows Chrome/Edge、Android Edge/Tampermonkey 真机或 Android Chrome。没有气泡/面板模型、可靠 SFX 分类、复杂混合方向自动识别、云视觉或真实服务测试。背景图的复杂 background-size/object-fit/页面 CSS 变换可能使高亮边框不精确；嵌套 bitmap/canvas 合成会明确拒绝。动态阅读器应在新图片显示后再次显式触发，不后台连续抓取。

集成时还需迁移当前 `platform/settings-store.js` 的 v1 兼容 seam 到公共 v2 store（现有基线遗留，未擅改）、接入 popup/设置表单、更新公共契约与隐私/商店说明，并完成跨设备及安全最终验收。

本轮回归记录：Node 202/202，gateway unittest 20 项、scripts unittest 16 项（1 SKIP），项目源码检查通过；漫画专项 5 PASS。现有 canonical 全量回归为 23 PASS、1 FAIL（`hover_shift`）、1 INFO。单独从只读 HEAD 快照运行 `--only hover` 也失败，证实该问题存在于当前集成基线，未修改其他同事负责的 hover 实现。它需要 leader 协调解决后重新完成全量验收。
