# Edge Add-ons submission checklist

由用户本人在 Microsoft Partner Center 完成提交。审核通过前不要把商店安装写成已可用。

1. 在干净工作区运行 `python -B scripts/build_release.py --target edge-store`。
2. 检查 `dist/duallens-edge-store-v<version>.zip` 根目录有 `manifest.json`，且没有 `key` 字段。
3. 上传 Edge 商店 ZIP。
4. 若本次发布包含移动端 userscript，上传或附加 `dist/duallens.user.js`，并在 Release 提供安装链接。
5. 从 `dist/SHA256SUMS` 记录 ZIP 与 userscript 的 SHA-256。
6. 填写 `listing.zh-CN.md` 与 `listing.en.md` 的标题、简介、分类和关键词。
7. 上传 `dist/store/` 中的商店图片。
8. 按照 [docs/PRIVACY.md](../PRIVACY.md) 声明不收集数据，并说明网页文本只发往用户选择的模型服务。
9. 逐项核对 [permissions.md](permissions.md)，尤其是 `<all_urls>` 的用途说明。
10. 检查开发者账号、支持链接、隐私政策链接和版本号后再提交审核。

## Store screenshot generation

`python -B scripts/store_assets.py` 会在隔离临时 profile 中加载真实 `extension/`，通过 service worker 选择 Mock 后端，并生成：

- `00-promo.png`：440×280，使用仓库真实图标与功能文字的宣传图。
- `01-bilingual.png`、`02-translation-only.png`、`03-selection-card.png`、`04-settings.png`：1280×800 的真实扩展界面截图。
- `05-mobile.png`：375×812 的可选移动尺寸截图。

这些截图使用演示后端，译文以 `【译】` 开头，仅用于展示界面和交互。若需真实模型截图，可由用户本人在隔离环境中提供 `DUALLENS_OPENROUTER_KEY`，手动注入设置后重新运行；脚本不得读取、保存或打印 key。
