# 在电脑、手机和平板配置 DualLens

DualLens 可以直接连接你自己的 OpenAI 兼容模型服务。电脑网关是可选增强；手机使用直连服务时，电脑可以关机。
API key 和网关配对令牌只保存在当前设备的本地区域，普通设置同步和明文导出不包含它们。

## 第一台电脑：Chrome / Edge

1. 从 [GitHub Releases](https://github.com/ray-oriental/duallens/releases) 下载扩展 ZIP，解压到独立目录并保留。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。开启开发者模式，选择「加载已解压的扩展」，选择包含 `manifest.json` 的目录。
3. 打开 DualLens 设置。首次安装不会自动请求任何模型。选择服务预设，添加服务，填写自己的 key，点击「获取模型列表」，选择模型。
4. 「测试连接」会发送示例翻译文本到所选服务；准备好后手动点击，再「保存设置」。网页正文会发送到你配置的模型链。
5. Edge Add-ons 上架由维护者完成；商店版可用后按 Release 的正式链接安装，不能把本地开发版当成已上架版本。

## 推荐直连：OpenRouter 免费模型

在 [OpenRouter key 设置](https://openrouter.ai/settings/keys) 为 DualLens **单独创建 key**，把消费额度上限明确设置为 **0 美元**，只选择免费模型。
0 必须是明确的数字上限，不要留空成为无限额；保存后再在控制台核对。额度上限字段由 [OpenRouter 官方说明](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys) 定义。

添加 OpenRouter 预设，基础地址为 `https://openrouter.ai/api/v1`。获取模型列表只使用公开目录，并筛选输入和输出价格都为零的模型；
选择模型后，表单会建议不同厂商的免费备选。免费模型有每分钟/每日限额和可用性限制；换模型不能绕过账号限额。
不要只凭模型名字判断免费，也不要把付费模型手动加进免费链。具体限额以 [官方限制说明](https://openrouter.ai/docs/api-reference/limits) 为准。

## 交大 API 直连

添加「交大模型服务」，基础地址为 `https://models.sjtu.edu.cn/api/v1`，填你自己的交大服务 key。
获取当前可用模型并选择、测试、保存。这种连接不依赖 DDL Hub 或电脑网关，可以在手机上直接使用，额度按你的账号规则计算。

## 第二台电脑

在第二台电脑同样安装扩展。设置通常可通过同一浏览器账号同步，但 key 和配对令牌不会同步；Chrome 与 Edge 之间也不要假定自动同步。
可以在第二台电脑分别填写自己的 key，或从第一台电脑导入加密备份：

1. 第一台电脑设置里输入备份口令，点击「导出到手机」或「导出配置」。前者直接显示本地生成的加密文本和可容纳时的二维码。
2. 用你信任的传输方式搬运 `duallens-config:v1:` 开头的文本或加密文件，口令另行传递。
3. 第二台电脑粘贴到「配置文本」，输入同一口令，点击「导入配置文本」；或选择加密文件。
4. 本机网关地址指向运行网关的设备。第二台电脑若自己运行网关，需要自己的后端安装和机器配置；备份不会安装、启动或登录这些后端。

加密备份包含已保存的 API key 和配对令牌；明文导出不含机密，导入明文保留设备已有 key。译文缓存不导出。
很长的术语表/配置可能超出一个二维码的容量，此时复制加密文本或传输加密文件。

## Android 手机与平板：Edge + Tampermonkey

1. 在 Android Edge 的扩展菜单安装 Tampermonkey；支持情况以当前 Edge 菜单为准。
2. 在 [Release](https://github.com/ray-oriental/duallens/releases) 打开 `duallens.user.js`，由 Tampermonkey 安装并启用。脚本只在顶层网页运行。
3. 确认 Tampermonkey 启用了隔离脚本环境；不要以网页主世界作为密钥输入环境。查看 [官方 sandbox 文档](https://www.tampermonkey.net/documentation.php?q=sandbox)。
4. 从 Tampermonkey 菜单或 DualLens 悬浮球打开设置。添加服务；点「设置 key」，在浏览器原生对话框中输入。取消会保留草稿，点击保存才持久化。
5. 从电脑搬配置时，将电脑生成的加密文本粘贴到「配置文本」，点击「从电脑导入」，在原生对话框输入口令。也可选择加密文件。
6. 翻译段落可长按约 500ms；划词后使用选区下方按钮。输入框翻译可用悬浮球菜单，手机输入法三连空格可能不可靠。

Android Chrome 不属于本轮已实现的用户脚本安装路径。书签脚本仍是 P1 计划，受网页 CSP 和网页脚本截获 key 的风险限制；不要把计划当成已经实现。
真机验收按 [Android 清单](../tests/e2e/MOBILE_ACCEPTANCE.md) 操作；桌面模拟通过不能替代真实手机与平板验收。

## 可选电脑网关：已有 DDL Hub、Hermes、Ollama、Claude / Codex

Python 3 的网关只使用标准库，不要求 npm/pip 运行时依赖。从完整源码或包含网关的 portable 包目录执行：

```powershell
python -B gateway/duallens_gateway.py setup
python -B gateway/duallens_gateway.py status
python -B gateway/duallens_gateway.py serve
```

`setup` 探测本机 DDL Hub 的 `/health`、Hermes proxy、Ollama，以及已安装的 Claude/Codex CLI，逐项询问是否启用。
探测不读取或显示凭据、不验证 CLI 登录。配置写入 `%USERPROFILE%\.duallens\gateway.json`，重启网关应用修改。
`status` 显示配置开关与后端探测结果；探测成功不能保证账号有效或模型请求一定成功。

网关不会替你安装/登录/启动模型后端，也不会改代理、浏览器 profile 或计划任务。Hermes 需你独立启动 `hermes proxy start --provider nous`。
DDL Hub 中转需要该机器既有配置；Ollama 需要本机服务和所选模型。Claude/ChatGPT 订阅不能直接当成 API key，
只能在你已登录官方 CLI 的电脑上通过网关的 `claude/*` / `codex/*` 调用，工具执行保持关闭，订阅服务规则仍然适用。

电脑设置中点击「一键接入本机网关」，只探测 `127.0.0.1:18790/health` 与 `/v1/models`，不发送模型请求。
按发现的已启用模型建立 **交大 → 已批准的 Hermes 免费模型 → `ollama/qwen3:4b`** 链；未发现的模型不会进入链。
Claude/Codex 只供手动选择，不进入默认备选。没有推荐模型时需手动选择。最后点击保存。

## 手机配对：Tailscale

1. 电脑和手机/平板安装并登录同一受信任的 Tailscale 网络。电脑在线，Tailscale 正常运行。
2. 在你自己的私密终端执行 `python -B gateway/duallens_gateway.py pair`。命令生成或复用 `%USERPROFILE%\.duallens\remote_token`，
   打印配对串和字符画二维码。配对串包含令牌，视同密钥，不发到群聊、issue、日志、截图或公共网站。
3. 在本机 `gateway.json` 加入或修改下面一项；只在你确实需要远程调用时启用：

```json
"remote": { "enabled": true, "port": 18791 }
```

4. 重启 `serve`。回环服务仍是 `127.0.0.1:18790`，远程服务另开监听，只绑定本机 Tailscale IPv4（`100.64.0.0/10`）的 18791。
   没有该地址或令牌时不会启动网关监听；不会退回 `0.0.0.0`、局域网或 IPv6 通配。按需限制 Tailscale ACL，令牌持有人能调用已启用后端。
5. 在手机设置点击「导入配对串」，在原生对话框粘贴完整 `duallens-pair:v1:` 串，保存。
   有 Tailscale 地址时创建「电脑网关（Tailscale）」与「电脑网关（USB）」；没有时只创建 USB 服务。
6. 获取模型列表，选择想用的模型并保存。远程请求始终带 Bearer 令牌。电脑休眠/离线时无法使用该网关；可另设直连服务。

远程 Host 只接受本机 Tailscale IP:端口或从 Tailscale 发现的本机 MagicDNS 名:端口。配对导入使用 IPv4 地址。
单一来源 IP 一分钟内第 11 次鉴权失败触发 429，冷却 10 分钟。令牌疑似泄漏时运行 `pair --rotate`，旧令牌立即失效；所有已配对设备需要重新导入。
关闭 `remote.enabled` 并重启即可关闭远程监听；不会影响已有回环用途。

## USB 连接：ADB reverse

电脑需已安装 Android platform-tools，手机开启开发者选项与 USB 调试，并由你确认电脑授权。保持 USB 连接：

```powershell
adb devices
adb reverse tcp:18790 tcp:18790
python -B gateway/duallens_gateway.py pair
```

在手机导入配对串，选择「电脑网关（USB）」并保存。手机的 `127.0.0.1:18790` 此时经 ADB 映射到电脑网关。
USB 方式不需要启用远程监听或 Tailscale。配对令牌允许用户脚本的网页 Origin 访问回环服务；没有令牌的网页请求仍被拒绝。
不要用 adb forward 代替 reverse；不要把端口改成公网/局域网监听。多设备连接时用 `adb -s <设备序列号> reverse ...` 指定设备。
断开 USB 或重启设备后可能需要重新执行 reverse。用 `adb reverse --remove tcp:18790` 撤销该映射。

## 常见问题

- **手机连不上 127.0.0.1**：它指向手机自己。使用 Tailscale profile，或先建立 ADB reverse 再选 USB。
- **配对 401**：令牌缺失、复制不完整或已轮换；重新导入。重复错误变成 429 时等待 10 分钟再试。
- **403 Host**：地址与实际监听 IP/端口不一致；不要使用局域网 IP、反向代理域名或任意 Host。
- **模型没有显示**：先启动相应后端，用 setup 显式启用并重启网关；模型必须在配置名单里。CLI 安装探测并不代表已经登录。
- **免费模型 429 / 402**：核对当前免费价格、账号额度、限额和 key 消费上限；不自动改为付费模型。
- **手机原生密钥对话框未出现**：检查 Tampermonkey 隔离环境和脚本权限；不要把 key 粘贴到网页普通输入框。
- **二维码放不下**：保留现有加密文本，用复制文本或加密文件导入；不要改用含 key 的明文。
- **设置同步但服务不可用**：机密只存本机。填写该设备的 key 或导入加密备份；网关端还要检查对应电脑在线状态。

二维码使用本地 MIT 编码器，不请求任何二维码网站。备份口令不会保存；令牌仅由显式 pair 命令在用户终端展示。
