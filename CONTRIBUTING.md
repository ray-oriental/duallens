# 参与 DualLens

欢迎提交可复现的问题和边界清晰的改动。首版交付P0网页阅读与输入交互；PDF、字幕、EPUB、OCR等后续阶段见[路线图](docs/ROADMAP.md)。项目是独立实现，不接受复制第三方扩展代码、规则表、品牌素材或解包源码的PR。

## 提交过程

1. Fork仓库，在自己的fork创建功能分支，例如 `fix/selection-position`。
2. 保留改动范围，说明具体问题、结果与验收条件。跨模块接口变更先开issue讨论。
3. 在功能分支提交源码和相关验证，向本仓库 `main` 提交PR。
4. 按PR模板填写实际执行的检查，等CI和审查完成。维护者处理最终合并和release。

## 开发环境与离线验证

Node.js 24、Python 3.12与Chrome/Edge即可参与。扩展是原生ES模块，零构建；发布脚本只用Python标准库。离线验证无需生产依赖、账号、API key或模型服务。

从仓库根目录运行：

```sh
npm test
python -B -m unittest discover -s scripts -p "test_*.py"
python -B scripts/check_project.py
python -B scripts/build_release.py
python -B scripts/check_project.py --dist-dir dist
```

浏览器开发者模式加载 `extension/`。在DualLens设置中选择「Mock测试后端」，模型返回 `【译】` 前缀，适合复现双语/仅译文、恢复、动态页面、悬停、划词和输入框行为。

## 浏览器 E2E

Playwright和浏览器下载放在工作区外。Linux/macOS示例：

```sh
python -m venv "$HOME/.cache/duallens-e2e-venv"
"$HOME/.cache/duallens-e2e-venv/bin/python" -m pip install -r requirements-dev.txt
"$HOME/.cache/duallens-e2e-venv/bin/python" -m playwright install chromium
"$HOME/.cache/duallens-e2e-venv/bin/python" -B -u tests/e2e/run_e2e.py --mock-only
```

Windows PowerShell示例：

```powershell
$testPython = "$env:USERPROFILE\.cache\duallens-e2e-venv\Scripts\python.exe"
python -m venv "$env:USERPROFILE\.cache\duallens-e2e-venv"
& $testPython -m pip install -r requirements-dev.txt
& $testPython -m playwright install chromium
& $testPython -B -u tests/e2e/run_e2e.py --mock-only
```

CI在Ubuntu 24.04/Windows运行单元测试、语法/引用与打包检查；Ubuntu另跑mock Chromium E2E。`--mock-only`不会检查或请求本机真实模型。详细夹具、浏览器版本与测试说明见[E2E README](tests/e2e/README.md)。

## 发布文件

`dist/`只放公开发布成品，版本来自manifest；文本规范化为UTF-8/LF（PS1保留UTF-8 BOM），以消除不同checkout的换行差异：扩展安装包的根目录就是`manifest.json`；portable包含相对目录一致的扩展、源码、文档和测试；`SHA256SUMS`校验两个ZIP。缓存和临时构建工作位于系统临时目录，不提交。

问题反馈只用公开网页、本地夹具或脱敏的错误代码，不提交凭据、浏览器profile、私有原文、运行态、模型或第三方参考包。安全漏洞按[安全说明](SECURITY.md)处理。
