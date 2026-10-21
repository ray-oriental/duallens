# PDF 双语阅读（P1，待 leader 合并与最终验收）

桌面 Chrome / Edge 弹出页显式点击后，后台使用当前标签页 activeTab 读取 PDF，并打开 `pdf/viewer.html?token=<一次性令牌>`。阅读器从扩展来源 IndexedDB 原子读取并删除字节，同时移除地址栏令牌；未读记录五分钟有效，最多三份。`?file=<URL 编码的地址>` 仍兼容其他来源，缺少授权时先显示来源授权按钮。PDF.js 在设备上解析和渲染，不把 PDF 字节传给翻译服务；只有用户点击“翻译”后，视口内与相邻页的文本块通过 `platform.translator().translateBatch`、service worker、缓存及用户配置的服务链翻译。不发送 PDF URL、文件名、元数据或图片。

## 使用

1. 打开一个 PDF 标签页，在 DualLens popup 点击“用 DualLens 打开此 PDF”。URL 路径以 `.pdf` 结尾（支持查询参数与 fragment），或者按需探测响应的 `Content-Type` 为 `application/pdf` 时可用。未确认 PDF 时可从阅读页选择本地 PDF。
2. 宽屏默认“双栏对照”：左侧原页与可选择文本层，右侧同尺寸译文页。译文页复制原页画布，按原文字块坐标采样背景、逐行抹底、拟合字号并覆盖译文。左右页共用缩放和逐页滚动。可切换“仅译文页”“原文页”“重排阅读”；窄于 600 px 的扩展窗口首次打开默认重排。另有恢复原文、页码跳转和浅色/深色/跟随系统。
3. `file://` 链接需在浏览器扩展详情页开启“允许访问文件网址”。无需该权限也可在阅读页“选择本地 PDF”；选择的字节只在阅读页内存中处理。
4. 需要登录、带 URL 账号密码、重定向的链接不自动代取。先由用户下载，再选择本地文件。匿名 HTTP(S) 请求不带 cookie，不使用 API key。

自动打开 PDF 是可选增强，本轮未实现，保持浏览器原有行为；不添加 declarativeNetRequest 或重定向规则。

## 实现与权限

- `background/pdf.js` 为 `pdf-status` / `pdf-open` 消息提供处理器。消息只使用实际 `tabId` 对应的 URL，不信任消息中的 PDF URL；只支持 HTTP、HTTPS、file，不接受 URL 用户名/密码。
- PDF 工具栏入口使用已有 activeTab，不需常驻 `<all_urls>`；其他来源由阅读器按钮按需 requestOrigin。本地文件选择不需主机权限。不使用 `webRequest`、`webRequestBlocking`、响应观察器或 PDF 标签页切换/更新监听，不扫描访问历史，不在启动或普通导航时探测 PDF。
- 只在 popup 打开时时先检查实际标签页 URL；`.pdf` 后缀无需网络探测。不确定的 HTTP(S) 地址发一次 HEAD；网络/HTTP 失败或没有 Content-Type 时，再发一次带 `Range: bytes=0-1023` 的 GET。每次请求超时 5 秒（两次失败最多约 10 秒），不重试、不跟随重定向、不带 cookie/认证、禁用 HTTP 缓存。读取响应头后立即取消响应体并中止请求，即使服务器忽略 Range 也不读取整份正文。成功的非 PDF HEAD 不触发 GET。不保留探测 URL 或结果缓存。
- PDF 下载 30 秒超时，流式限制 64 MiB；最多 2000 页。字节检查 PDF 标头。pdf.js 禁用 `isEvalSupported` 与 XFA；不创建注释/表单层、不执行 PDF 文档脚本或自动外链。加密 PDF 暂需先在本地解密。
- 页面通过 IntersectionObserver 在视口外 120% 的邻近范围解析/渲染，任务串行；翻译限视口内与前后各一页，不整本预翻译。最多保留五页原页画布/文本层及其译文底图，每张底图最多约四百万像素；远页释放画布，保留轻量分块数据和会话译文。离开范围的尚无结果请求可取消，重新靠近后再请求。
- `segments.js` 依据基线、行距、缩进、字号与栏位合并段落，单独保留目录点引导线、编号与页码；表格单元保守分离。`segment-worker.js` 在本地模块 Worker 中识别文本块；主线程分片创建页面、采样背景和插入译文。`layout.js` 用字符宽度估算断行并二分拟合字号；达到最小字号仍放不下时扩高并加 `data-overflow` 标记。复杂版面仍是启发式识别。
- 公式密集块、图片、页眉页脚、页码、旋转/RTL 字块保持原像素。行内公式作为 `<xN/>` 原子发送，译文中以本地原页裁图嵌回，并按实际字形收紧空白边界。模型若唯一、原样写回某个数学字面量，可据此恢复对应裁图；不猜测常见名字、纯数字、重复或丢失公式的位置。缺失、重复或非法公式占位符不抹掉原文。已有有效草稿时保留草稿，否则仅针对该块自动补试一次，仍失败显示可重试错误。表格线和图像没有被重新绘制，但与文字重叠的复杂图表仍需逐页检查。
- `translate.js: PdfTranslations` 独立于缩放保存状态，请求附加 `draft:true,purpose:'pdf'`。同一 id 的 `stage:'draft'` 可由 `stage:'final'`（或无 stage）替换；迟到草稿不覆盖终稿。精修失败保留草稿并注明。回调只解析为文本与受限公式原子，模型输出不进入 innerHTML。恢复取消请求、清除覆盖层并保留原页；旧请求、重试前的迟到结果不能写入新状态。
- 纯链接、编号链接脚注和作者分组邮箱在本地识别并保留原样，不向服务发送。包含链接的正常正文仍翻译；短句不能仅因字数少就把漏翻当成功。
- 页首在 Abstract 之前且有机构/邮箱证据的短作者组、机构行使用本地 `identity` 分类，保留原像素，不发送翻译。姓名须符合大写词形且字号不大于机构行的 1.15 倍；普通标题与正文中的机构提及仍参与翻译。这是保守启发式，非拉丁作者、复杂合并分块仍需逐页核对。
  作者脚注同时识别 `* ∗ ⋆ † ‡`；包含姓名加邮箱的合并块、Google Brain/Research 机构行也作为证据。有 Abstract 时以其位置为边界，避免遗漏页高中部最后一组作者；无摘要仍用保守页首范围。姓名与机构须邻近，标题不因全为大写词形就被当成作者。
- 上述双阶段呈现需翻译服务及运行时端口支持阶段字段；本 PDF 分支不修改共享引擎或端口。仅有旧接口时仍显示普通终稿，实际双引擎链路由集成方验收。
- `pdfjs-dist` 5.4.624 源自 [npm tarball](https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz)，已校验 npm SHA-512，附 SHA-256、Apache-2.0 和 codec 许可证；[上游 release](https://github.com/mozilla/pdf.js/releases/tag/v5.4.624)。只执行打包到扩展内的模块，不从 CDN 执行代码。详见 `extension/vendor/pdfjs/VENDOR.md` 与同内容 `VENDOR.txt`。

## 移动端与已知限制

PDF.js 不进入 `duallens.user.js`。Android Edge + Tampermonkey 的建议路径是网站已经提供的 PDF.js 文本层，使用网页翻译或自行选取文本；本轮没有新增移动端 PDF 功能，也没有验证第三方 PDF.js 站点。Android Chrome 暂用系统 PDF 阅读器或复制文本到可翻译网页；不能声称手机原生 PDF 双语阅读已实现。

扫描 PDF 没有文本层时显示提示；不接入漫画 OCR，也不上传扫描件。本轮最小包省略预打包 CMap 与非内嵌标准字体数据。多数内嵌字体和普通英文文本可读，但依赖外部 CMap 的东亚旧式 PDF 可能无法正确提取/渲染，需后续完整数据版本。复杂版面、极大图片、数千页文件的性能仍需真实文档验收。合成 Chromium 130 测试不能替代两台 Windows 上真实 Chrome / Edge 的验收。

## 离线验证

```powershell
npm test
python -B scripts/check_project.py
python -B scripts/build_release.py
python -B scripts/check_project.py --dist-dir dist
python -B tests/fixtures/generate_pdf.py
python -B -u tests/e2e/run_e2e.py --mock-only
python -B -u tests/e2e/run_pdf_e2e.py
```

PDF runner 复用 canonical staging / Session / run_case，临时 profile、原创八页英文 PDF、数学 PDF、状态和截图位于 `DUALLENS_E2E_OUT`。默认仅 mock：验证同尺寸双栏、文字不越界/互叠、公式裁图、四视图、恢复原页 DOM、草稿到终稿的原位替换、恶意标记、迟到回调、缩放竞态、跳转/主题、画布上限、PDF 探测入口与本地选择器。单测另覆盖分块、字号、颜色与翻译状态机。无匹配用例退出 2，失败退出 1。

真实服务验收统一用 `run_acceptance.py`，见 [E2E README](../tests/e2e/README.md)。需明确授权，结果独立报告。
