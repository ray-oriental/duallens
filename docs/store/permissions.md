# 权限说明 / Permission rationale

提交时请按最终商店包中的 `manifest.json` 逐项核对。当前 P0 包的权限用途如下：

- `storage`：保存用户选择的服务设置、本机密钥与翻译缓存；密钥不进入同步区域。
- `unlimitedStorage`：为较长网页的本机翻译缓存提供额外本地容量；不用于上传数据。
- `activeTab`：只对用户当前明确操作的标签页执行即时翻译。
- `contextMenus`：提供用户主动选择的“翻译此页/选中文本”菜单入口。
- `commands`：提供可选的翻译、双语、恢复和输入框快捷键。
- `scripting`：在用户主动触发翻译时读取网页文本并安全插入译文，保留原始 DOM 状态。
- `activeTab`：对用户当前明确操作的标签页执行翻译，不用于后台浏览。
- `<all_urls>`：网页翻译需要覆盖用户打开的任意普通 HTTP/HTTPS 网站；扩展只在用户触发或按设置唤醒时处理页面，不读取浏览器内部页面、文件或账户数据。

The store package should contain only permissions present in its final manifest. `storage` keeps preferences, local secrets, and translation cache; `unlimitedStorage` provides room for local cache only; `activeTab` limits immediate action to the tab the user is operating; `contextMenus` adds user-invoked translation menu entries; `scripting` reads page text and inserts validated translations only after the user requests translation. The `commands` manifest section exposes optional keyboard shortcuts. `<all_urls>` is required because users may translate arbitrary ordinary HTTP/HTTPS webpages; it is not used for background browsing or browser-internal pages.
