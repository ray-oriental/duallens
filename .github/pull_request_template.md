## 问题与结果

说明具体触发场景、修改前后的行为，关联 issue（如有）。

## 验证

- [ ] `npm test`
- [ ] `python -B -m unittest discover -s gateway/tests`
- [ ] `python -B -m unittest discover -s scripts -p "test_*.py"`
- [ ] `python -B scripts/check_project.py`
- [ ] 页面交互变更已用 mock E2E 验证，或说明无法运行的原因
- [ ] 修改后的功能描述与 P0 / ROADMAP 实际范围一致

列出实际执行的检查和结果；无需配置SJTU、Hermes或任何付费订阅。

## 需要审查的边界

接口/权限/存储/提示词或后端调用是否变化？涉及译文插入时请说明如何保持纯文本/安全克隆；涉及网关时请说明Origin/Host限制和是否包含新增外部调用。

## 截图或复现说明（适用时）

只提供公开夹具或脱敏证据。
