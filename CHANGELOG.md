# Changelog

本文件记录本 skill 的版本变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

版本号与本仓 git tag 强同步：**tag `vX.Y.Z` 必须与 `SKILL.md` 的 `version: X.Y.Z` 一致**，
由 CI 校验（见 `.github/workflows/publish.yml`）。

## [0.1.0] - 2026-10-28

首个版本。

### Added

- `SKILL.md` —— 上游贡献七阶段主流程（判定权限 → 读懂项目 → 挖信号 → 价值门禁 → 搭分支 → 写改动 → 开 PR → 跟进到终局），
  含四道价值门（信号门 / 范围门 / 可验证门 / 相关门）与八条硬红线。
- `scripts/pr-preflight.sh` —— 开 PR 前体检：鉴权方式、目标仓权限（是否需要 fork）、仓库是否归档、
  API 速率配额、本地仓状态。阻断项以 `BLOCKER:` 标记并以退出码 1 返回。
- `scripts/setup-upstream.sh` —— 幂等地把本地仓接成可提 PR 状态：必要时创建 fork、配 `upstream` 远端、
  同步上游、**从 `upstream/<默认分支>`** 开分支（避免基于落后的 fork 产生无关 diff）。
- `scripts/scan-contribution-signals.mjs` —— 只读信号扫描：issue 标签（good first issue / help wanted / bug）、
  默认分支 CI 失败、dependabot 安全告警、README 相对链接失效、代码内 TODO/FIXME，
  按打分排序输出候选表，并给出每个候选的「下一步」。
- `scripts/pr-lint.mjs` —— 开 PR 前机械门禁：标题格式、正文五块结构与「怎么验证」小节有效性、
  issue 关联语法、越权文件（CI workflow / 许可证 / 治理文件）、生成物与 lock 文件、
  改动规模阈值、密钥与内部信息泄漏、上游约定探测（DCO / CLA / 标题风格）。
- `references/finding-work.md` —— 信号源清单、挖掘流程、候选打分维度、不值得提的清单。
- `references/guardrails.md` —— 会被拒绝的 PR 模式全集、安全边界、越权文件识别方法。
- `references/pr-conventions.md` —— 上游提交格式 / 分支命名 / PR 标题 / DCO / CLA / 本地门禁的探测方法。
- `references/pr-description.md` —— 标题与正文写法、五块结构、正反例。
- `references/review-and-ci.md` —— CI 排障手册与 review 应对手册。
- `templates/` —— PR 正文、提交信息、PR 标题三份模板。

### Added

- `scripts/check-update.sh` —— 检查本 skill 是否落后于上游（`--update` 可快进更新）。
  软链安装的 skill 读的是本地工作区，Agent 察觉不到 GitHub 上的更新 ——
  这个脚本把「有没有更新」变成可判定的事实（退出码 0=最新 / 1=有更新 / 2=检查失败）。
- SKILL.md「版本自检」小节与「更新与分发」表；README「版本更新说明」章节 ——
  明确写出「不会自动更新、也不会提示」这个边界，避免使用者误以为推了新版本就生效。
- SKILL.md「版本自检」小节与「更新与分发」表补充：维护者机器有每日自动快进（launchd），
  别人 clone 用需手动 `check-update.sh`；README「版本更新说明」同步。
