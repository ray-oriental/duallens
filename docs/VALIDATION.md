# 如何验证

从仓库根目录执行离线检查，不需要账号、密钥或模型服务：

```sh
npm test
python -B -m unittest discover -s scripts -p "test_*.py"
python -B scripts/check_project.py
python -B scripts/build_release.py
python -B scripts/check_project.py --dist-dir dist
```

项目检查覆盖 manifest、模块引用、JavaScript/Python 语法，以及公开文件中的私有设施标识和绝对用户目录（vendor 排除）。构建前也执行同一隐私门禁。发布校验检查归档成员、确定性字节、版本、SHA256SUMS 和用户脚本重建一致性；启动包硬预算 335000 字节。

在工作区外的虚拟环境安装 requirements-dev.txt 和 Playwright Chromium。浏览器缓存使用标准路径或 PLAYWRIGHT_BROWSERS_PATH；DUALLENS_E2E_OUT 指定 profile、截图和报告目录，默认系统临时目录下的 duallens-e2e。安装见 [E2E README](../tests/e2e/README.md)。先构建产物，再执行：

```sh
python -B tests/e2e/run_e2e.py --mock-only
python -B tests/e2e/run_userscript_e2e.py
python -B tests/e2e/run_layout_e2e.py --mock-only
python -B tests/e2e/run_frames_e2e.py
python -B tests/e2e/run_input_e2e.py
python -B tests/e2e/run_media_e2e.py
python -B tests/e2e/run_pdf_e2e.py
python -B tests/dom/run_settings_browser.py
```

交互回归显式开启所测功能；新安装测试验证默认关闭、不自动联网。迁移覆盖同步、本地回退、GM 存储、旧版加密导入、同 id 密钥保留和幂等性。安全与精确恢复断言不能因默认值变化删除。

真实网页统一用 run_acceptance.py，需明确授权并与离线结果分开。默认 --llm none 使用真实免费 MT；--llm https://example.com/v1 使用明确提供的 OpenAI 兼容服务，模型从 DUALLENS_MODEL、可选 key 从 DUALLENS_API_KEY 环境变量读取，不读取或启动固定服务。报告不保存 key。

报告实际汇总、失败、跳过及截图/恢复差异。覆盖与几何只描述观察窗口，不证明语义质量。访问墙单列不可达。桌面 Chromium、GM 桩和触屏模拟不证明物理 Windows Chrome/Edge、Android Edge/Tampermonkey 已验收；见[移动清单](../tests/e2e/MOBILE_ACCEPTANCE.md)。发布由维护者最终审查，检查通过不代表已上架。
