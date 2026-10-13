# 权限说明 / Permission rationale

提交时请按最终商店包中的 `manifest.json` 逐项核对。当前 P0 包的权限用途如下：

- `storage`：保存用户选择的服务设置、本机密钥与翻译缓存；密钥不进入同步区域。
- `unlimitedStorage`：为较长网页的本机翻译缓存提供额外本地容量；不用于上传数据。
- `activeTab`：只对用户当前明确操作的标签页执行即时翻译。
- `contextMenus`：提供用户主动选择的“翻译此页/选中文本”菜单入口。
- `commands`：提供可选的翻译、双语、恢复和输入框快捷键。
- `scripting`：按用户设置的漫画站点名单动态注册 `world: MAIN`、`document_start` 的原创 canvas 来源记录脚本；默认只有 `*.pixiv.net`，不在所有网站改写画布 API。名单增删后刷新生效。
- `offscreen`：按需创建本地图片解码与 OCR 文档；不用于后台浏览或图片上传。
- CSP `wasm-unsafe-eval`：允许打包的 Tesseract WASM 进行本地识别；扩展脚本和 Worker 来源仍限于 `self`，不从 CDN 执行代码。
- `<all_urls>`：网页翻译需要覆盖用户打开的任意普通 HTTP/HTTPS 网站；扩展只在用户触发或按设置唤醒时处理页面，不读取浏览器内部页面、文件或账户数据。

The store package should contain only permissions present in its final manifest. `storage` keeps preferences, local secrets and cache; `unlimitedStorage` also accommodates verified local OCR language data. `activeTab` limits immediate action to the user-operated tab; `contextMenus` adds user-invoked translation entries. `scripting` dynamically registers a MAIN/document_start canvas source hook only on opted-in comic domains (default `*.pixiv.net`), with changes effective after refresh. `offscreen` provides local image decoding and OCR. CSP `wasm-unsafe-eval` permits packaged local WASM; extension scripts/workers stay self-only. The `commands` section exposes optional shortcuts. `<all_urls>` permits ordinary page translation and anonymous image downloads; comic images are processed locally, only OCR text goes to the configured service, and no DNR or cookies permissions are added. Hash-verified fast language data comes from the pinned tessdata_fast URLs documented in COMICS.md and can be deleted on-device.
