# Edge Add-ons 提交清单 / Submission checklist

由用户本人在 Microsoft Partner Center 完成提交。审核通过前不要把商店安装写成已可用。

1. 在干净工作区运行 `python -B scripts/build_release.py --target edge-store`。
2. 打开生成的 `dist/duallens-edge-store-v<version>.zip`，确认根目录有 `manifest.json`，且没有 `key` 字段。
3. 上传 Edge 商店包 ZIP。
4. 若本次发布包含移动端用户脚本，上传或附加 `dist/duallens.user.js`，并在 Release 中提供其安装链接。
5. 从 `dist/SHA256SUMS` 复制版本化 ZIP 与用户脚本的 SHA-256，留作发布记录。
6. 填写 `listing.zh-CN.md` 与 `listing.en.md` 的标题、短描述、详细描述、分类和关键词。
7. 上传 `dist/store/` 中四张 1280×800 截图和一张 440×280 小宣传图。
8. 在隐私/数据安全表中依据 [docs/PRIVACY.md](../PRIVACY.md) 声明不收集数据，并说明文本只发送到用户选择的模型服务。
9. 逐项核对 [permissions.md](permissions.md)，尤其是 `<all_urls>` 的用途说明。
10. 检查开发者账号、支持链接、隐私政策链接和版本号后提交审核；等待 Microsoft 审核结果。
