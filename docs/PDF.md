# PDF 双语阅读（P1，待 leader 合并与最终验收）

桌面 Chrome / Edge 扩展内打开 `pdf/viewer.html?file=<URL 编码的地址>`。PDF.js 在设备上解析和渲染，不把 PDF 字节传给厂商阅读器；只有用户点击“翻译附近段落”后，附近文本通过现有 `PageTranslator`、service worker、缓存及用户配置的模型备选链翻译。本机网关是可选配置，不是 PDF 阅读的依赖。

## 使用

1. 打开一个 PDF 标签页，在 DualLens popup 点击“用 DualLens 打开此 PDF”，或使用同名右键菜单。URL 路径以 `.pdf` 结尾（支持查询参数与 fragment），或者按需探测响应的 `Content-Type` 为 `application/pdf` 时可用。右键项对所有页面显示，点击后才判断；未确认 PDF 时打开扩展自有提示页，可从那里选择本地 PDF。
2. 页面提供原版画布与可选择文本层，旁边是按 PDF 文本坐标合成的段落。点击翻译后，原文段落下方出现译文。可切换仅译文、恢复原文、缩放、页码跳转、浅色/深色/跟随系统。
3. `file://` 链接需在浏览器扩展详情页开启“允许访问文件网址”。无需该权限也可在阅读页“选择本地 PDF”；选择的字节只在阅读页内存中处理。
4. 需要登录、带 URL 账号密码、重定向的链接不自动代取。先由用户下载，再选择本地文件。匿名 HTTP(S) 请求不带 cookie，不使用 API key。

自动打开 PDF 是可选增强，本轮未实现，保持浏览器原有行为；不添加 declarativeNetRequest 或重定向规则。

## 实现与权限

- `background/pdf.js` 为 `pdf-status` / `pdf-open` 消息提供处理器。消息只使用实际 `tabId` 对应的 URL，不信任消息中的 PDF URL；只支持 HTTP、HTTPS、file，不接受 URL 用户名/密码。
- PDF 不增加权限，复用已有 `<all_urls>` 和 `contextMenus`。不使用 `webRequest`、`webRequestBlocking`、响应观察器或 PDF 标签页切换/更新监听，不扫描访问历史，不在启动或普通导航时探测 PDF。
- 只在 popup 打开或右键菜单点击时先检查实际标签页 URL；`.pdf` 后缀无需网络探测。不确定的 HTTP(S) 地址发一次 HEAD；网络/HTTP 失败或没有 Content-Type 时，再发一次带 `Range: bytes=0-1023` 的 GET。每次请求超时 5 秒（两次失败最多约 10 秒），不重试、不跟随重定向、不带 cookie/认证、禁用 HTTP 缓存。读取响应头后立即取消响应体并中止请求，即使服务器忽略 Range 也不读取整份正文。成功的非 PDF HEAD 不触发 GET。不保留探测 URL 或结果缓存。
- PDF 下载 30 秒超时，流式限制 64 MiB；最多 2000 页。字节检查 PDF 标头。pdf.js 禁用 `isEvalSupported` 与 XFA；不创建注释/表单层、不执行 PDF 文档脚本或自动外链。加密 PDF 暂需先在本地解密。
- 页面只在距离视口 400 px 内解析文本与渲染，渲染任务串行。最多保留四页画布/原生文本层，画布每页最多约四百万像素；远页的轻量段落 DOM 保留以便恢复和使用现有缓存。翻译懒加载遵循用户已有 lazy 参数。
- `segments.js` 合并同一基线的文字项；以 2.4 倍行高的行距、1.2 倍行高的左缩进变化、130 PDF 单位的前行右缩进与字号变化分段。无缩放坐标下独立处理不重叠列；旋转和 RTL 项保守隔离。复杂跨栏标题、表格与竖排不是精确版面还原。
- DOM 中的段落先用 `textContent` 创建，再复用已有 serializer / injector。模型输出不进入 innerHTML。恢复停止未完成请求并还原段落节点；画布/原生文本层不由翻译修改。
- `pdfjs-dist` 5.4.624 源自 [npm tarball](https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz)，已校验 npm SHA-512，附 SHA-256、Apache-2.0 和 codec 许可证；[上游 release](https://github.com/mozilla/pdf.js/releases/tag/v5.4.624)。只执行打包到扩展内的模块，不从 CDN 执行代码。详见 `extension/vendor/pdfjs/VENDOR.md` 与同内容 `VENDOR.txt`。

## 移动端与已知限制

PDF.js 不进入 `duallens.user.js`。Android Edge + Tampermonkey 的建议路径是网站已经提供的 PDF.js 文本层，使用网页翻译或自行选取文本；本轮没有新增移动端 PDF 功能，也没有验证第三方 PDF.js 站点。Android Chrome 暂用系统 PDF 阅读器或复制文本到可翻译网页；不能声称手机原生 PDF 双语阅读已实现。

扫描 PDF 没有文本层时显示提示；不接入漫画 OCR，也不上传扫描件。本轮最小包省略预打包 CMap 与非内嵌标准字体数据。多数内嵌字体和普通英文文本可读，但依赖外部 CMap 的东亚旧式 PDF 可能无法正确提取/渲染，需后续完整数据版本。复杂版面、极大图片、数千页文件的性能仍需真实文档验收。合成 Chromium 130 测试不能替代两台 Windows 上真实 Chrome / Edge 的验收。

## 离线验证

```powershell
npm test
python -B -m unittest discover -s gateway/tests -t .
python -B scripts/check_project.py
python -B scripts/build_release.py
python -B scripts/check_project.py --dist-dir dist
python -B tests/fixtures/generate_pdf.py
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\SjtuGymAutoBook\browsers"
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_e2e.py --mock-only
& "$env:USERPROFILE\.venvs\duallens-e2e\Scripts\python.exe" -B -u tests/e2e/run_pdf_e2e.py
```

PDF runner 复用 canonical staging / Session / run_case，临时 profile、生成的原创八页英文 PDF、状态和截图位于 `~/.cache/duallens-e2e/`。测试画布、可选择文本层、显式翻译、远页不翻译、双语/仅译文、段落 DOM 完全恢复、缩放、页码跳转、深色主题、画布上限、后缀/HEAD/Range GET 入口、非 PDF 提示及本地选择器。单测另验证超时、失败不重试、无启动/观察请求，以及服务器忽略 Range 时不读取正文。不请求真实模型或登录。

## 合并配合

本页已加入 `scripts/check_project.py:PUBLIC_DOCS`，`build_release.py` 复用同一 allowlist；权限与隐私说明已补充 PDF 行为。leader 合并时仍需把 `docs/SPEC.md` 与 ROADMAP 同步到本轮 PDF 实现状态。当前打包器自动包含 `.js` / `.wasm` / `.txt`，所以核心模块将 `.mjs` 改名为 `.js`；`VENDOR.txt` 同步保留以确保发布包有来源说明（`VENDOR.md` 本身暂未列入通用 allowlist）。源码夹具 `.pdf` 暂不进入 portable zip；其中的标准库生成器仍可重建它。
