---
name: pr-contributor
description: "给任意开源项目提 PR 的完整闭环：读懂上游（CONTRIBUTING / 代码风格 / Issue 模板）→ 从真实信号里挖出值得改的点 → fork + 分支 → 最小改动 → 跑项目自带检查 → 开 PR → 跟 CI 与 review。触发条件: 用户要求给某个仓库或项目提 PR、做上游贡献、fork 后开 PR、按 issue 批量修、修被 CI 打回的 PR 时触发。"
version: 0.1.0
license: MIT
author: webkubor
category: devops
scope: personal
platforms: [linux, macos, windows]
url: https://github.com/webkubor/pr-contributor-skill
# 精确触发短语（整词匹配，不做空格切分）。
# 刻意不收「提」「提交」「review」「ci」这类单字泛词 —— 它们会让
# 「帮我提交代码」「帮我 review 这个 PR」误触发。泛词留在 description 里当语义描述。
trigger:
  - 提 PR
  - 提交 PR
  - 开 PR
  - 开个 PR
  - pull request
  - 贡献上游
  - 开源贡献
  - 给上游提
  - 提个 PR
  - 提一个 PR
  - fork 后
  - fork 一下
  - good first issue
  - help wanted
  - CONTRIBUTING
  - PR 描述
  - PR 正文
  - 上游贡献
  - PR CI
  - CI 挂了
  - CI 失败
  - PR 被打回
  - review 意见
  - review 反馈
  - review 建议
  - PR 评审
metadata:
  openclaw:
    tags: [github, pull-request, open-source, contribution, fork, upstream, ci]
    requires:
      bins: [git, gh]
---

# PR Contributor — 给上游提一个维护者愿意合的 PR

> **这个 skill 解决的不是「怎么调用 gh 提 PR」**（那是一次 `gh pr create` 的事）。
> 它解决的是上游贡献里 90% 真正会失败的地方：**提了个维护者不想要的 PR**。
>
> 区别在于：会写代码 ≠ 会贡献。贡献是**用维护者的标准交付一次小而可验证的改动**，
> 让维护者花 30 秒就能判断「这个该合」。

## 概述

本 skill 覆盖一次完整的上游贡献：从「读懂这个项目要什么」到「PR 被合或被拒之后怎么处理」。

核心主张：**PR 的价值不由改了多少行决定，由「维护者能不能在 30 秒内判断该合」决定。**
所以全流程围绕两件事组织 ——

1. **有信号才动手**（§2）：改动必须对应一个外部可见的理由（issue、失败的 CI、用户报错、文档不一致），
   不是「我路过看到代码可以更优雅」。
2. **最小且可验证**（§4）：只改必须改的，跑项目自己的检查，附上维护者能复现的验证步骤。

## 触发条件

- 用户说「给 X 仓库提个 PR」「给这个项目提 PR」「贡献一下上游」「fork 一下开个 PR」
- 用户给了 issue 链接 / 报错栈 / 功能诉求，目标是把它变成一个上游 PR
- 用户要批量修某个仓库的多个同类问题（需要先做信号筛选，不是无脑扫）
- 已开的 PR CI 挂了、review 提了意见，需要跟进到合

**不适用**：给自己有写权限的仓库提 PR（直接推分支就行，不需要 fork）、
纯本地重构、GitLab 私有仓内部 MR（流程不同）。

## 快速开始

```bash
# 0. 体检：鉴权 / 仓库身份 / 是否 fork 关系 / 速率配额
bash scripts/pr-preflight.sh                      # 在目标仓目录里跑

# 1. 挖信号：open issues / CI 状态 / TODO / 依赖告警 → 候选清单（带排序）
node scripts/scan-contribution-signals.mjs        # 输出候选表，不改任何东西

# 2. 接上游：fork + 加 upstream 远端 + 从上游默认分支开分支
bash scripts/setup-upstream.sh owner/repo         # 幂等，可重复跑

# 3. 开 PR 前机械门禁：标题格式 / 正文结构 / 密钥 / 越界信号
node scripts/pr-lint.mjs --title "fix: ..." --body-file /tmp/pr-body.md --diffstat "3 files changed, 42 insertions(+)"
```

### 版本自检

本 skill 通过软链指向一个 git clone。**各 Agent 读的是本地工作区，不会自动去 GitHub 拉** ——
你在 GitHub 更新了版本，Agent 使用时察觉不到。

两道保险：

1. **维护者的机器有每日自动快进**（launchd `com.webkubor.skill-autoupdate`，07:17 跑，
   只做 fast-forward；本地有未推送提交就跳过并记录）。所以更新后**第二天**自动生效，
   不需要提醒任何人。
2. **任何机器都能手动查**：

```bash
bash scripts/check-update.sh            # 只查，不改（退出码 1 = 有更新）
bash scripts/check-update.sh --update   # 查 + 快进到最新
```

被问到「这个 skill 是最新版吗」或发现行为与文档不符时，先跑 `check-update.sh`。

**不要擅自 `--update`**：先告知用户有更新、说明更新了什么，等确认后再更新。
本地若改过这个 skill 仓，脚本会拒绝覆盖并报错 —— 那是有意为之。

## 工作流

### 阶段 0 · 判定目标与权限（不要跳过）

先分清三种情况，流程完全不同：

| 情况 | 判定方式 | 动作 |
|---|---|---|
| **A. 无写权限的上游** | `gh api repos/O/R --jq '.permissions.push'` 为 `false` | fork → 走完整流程（§1–§7） |
| **B. 有写权限的仓（含自己的 fork）** | `.permissions.push` 为 `true` | 不 fork，直接开分支推自己的仓 |
| **C. 自己有主权的仓** | 当前 remote 就是主仓且有 maintainer/admin | **不要开 PR**，直接提 commit / issue。给维护者提 PR 是噪音 |

> 情况 C 是最常见的失分点：给自己的项目开 PR，维护者（自己）还得再点一次 merge。
> 除非用户明确要「走 PR 流程留痕」，否则先问一句或直接改。

```bash
gh api repos/OWNER/REPO --jq '{push: .permissions.push, admin: .permissions.admin, fork: .fork, archived: .archived, open_issues: .open_issues_count}'
```

`archived: true` 的仓库**不要提 PR** —— 维护者不会处理，直接放弃并告诉用户。

### 阶段 1 · 读懂项目（决定你要写出什么样的代码）

**在写任何代码之前**，把上游的规矩读出来。这一步决定了你的 PR 会不会被「格式不对」直接关掉。

```bash
# 贡献规范与模板
cat CONTRIBUTING.md 2>/dev/null || gh api repos/O/R/contents/CONTRIBUTING.md --jq '.content' | base64 -d
ls .github/{ISSUE_TEMPLATE,PULL_REQUEST_TEMPLATE}* 2>/dev/null
# 代码风格与门禁（这些决定你必须跑什么才能过）
cat .editorconfig .eslintrc* .prettierrc* 2>/dev/null
ls .github/workflows/ && grep -rn "run:" .github/workflows/ | head -20
# 提交信息约定 —— 直接从历史里学，别猜
git log --oneline -30
```

必须搞清这五件事：

| 要点 | 从哪读 | 违反的后果 |
|---|---|---|
| 提交信息格式 | `git log --oneline -30` | CI 的 commit-lint 直接红 |
| 分支命名 | CONTRIBUTING / workflow 里 `branches:` | workflow 不触发，等于没跑 |
| PR 标题格式 | `.github/PULL_REQUEST_TEMPLATE*` / CI 的 title lint | 标题被改写或 CI 红 |
| 必跑的门禁 | `.github/workflows/*.yml` 里的 `run:` | 本地没跑，CI 才炸 |
| DCO / CLA | CONTRIBUTING 里的 "sign-off" / "CLA" | 机器人直接标 `missing signature` |

**本地必须复现上游门禁**：把 workflow 里 `run:` 那几条在本地跑一遍。CI 跑不过的 PR 基本等于没提。

### 阶段 2 · 挖信号（这是与「随便提个 PR」的分水岭）

**禁止**凭「我读代码觉得这里可以改」起手。可提交的方向只来自**外部可见的信号**：

| 信号源 | 怎么拿 | 适合做什么 |
|---|---|---|
| `good first issue` / `help wanted` / `bug` 标签的 open issue | `node scripts/scan-contribution-signals.mjs` | 认领一个 issue 做修复 |
| 上游默认分支 CI 常年红 | `gh run list --branch main --limit 20` | 修一个可复现的失败 |
| 依赖安全告警 | `gh api repos/O/R/dependabot/alerts` | 升一个有 advisory 的依赖 |
| 文档与代码不一致（README 里的命令跑不通、链接 404） | 对着 README 逐条试 | 修文档（含真跑一遍证明） |
| 代码里的 `TODO/FIXME/XXX` 且有 issue 关联 | `grep -rn "TODO\|FIXME\|XXX" --exclude-dir=.git` | 实现一个有据可依的 TODO |
| 用户报错 / 复现步骤清晰的 bug 报告 | issue 正文 | 写复现测试 + 修复 |

脚本会把这些信号汇成一张带优先级的候选表：

```bash
node scripts/scan-contribution-signals.mjs --repo OWNER/REPO --json
```

### 阶段 3 · 价值门禁（提不提，就在这里定）

**每个候选改动都要过这四道门。** 任何一道不过，就别开 PR。

| 门 | 判据 | 不过则 |
|---|---|---|
| **信号门** | 存在外部可见的理由（issue / CI 失败 / 用户报错 / 文档不一致 / advisory） | 直接丢弃，不要「顺手修一下」 |
| **范围门** | 只碰必须碰的文件，无顺带重构、无格式化、无改名 | 拆小，或放弃 |
| **可验证门** | 能用**项目自己的**命令证明修好了（跑得起来、能复现） | 补测试或改到能验证 |
| **相关门** | 维护者会因为「它修好了/加上了什么」而合，而不是因为「它很整洁」 | 换候选 |

**明确该拒绝的 PR**（提了就是给维护者添麻烦）：

- 纯格式化 / 纯改名 / 纯注释 PR（对维护者是纯噪音，会被直接关掉，且拉低你后续 PR 的接受率）
- 改 `package-lock.json` / 自动生成文件 / vendor 目录
- 改 CI 配置、DCO、CODEOWNERS、发布流程（这些是维护者主权，提 PR 会被视为越权）
- 大范围重构（「顺便把 X 重写了」）
- 没有 issue 依据的依赖升级
- AI 一次性生成、没有实测过的批量改动（维护者看不见测试过程，只看见结果）
- 同一 issue 已经有 open PR（重复提交会互相打架）

### 阶段 4 · 搭好分支（不污染上游）

```bash
bash scripts/setup-upstream.sh OWNER/REPO
# 产出：origin = 你的 fork，upstream = 原仓，分支已从 upstream 的默认分支开出
```

要点：

- 分支从 **`upstream/<默认分支>`** 开，不要从你自己的 fork 的默认分支开 —— 你的 fork 可能落后，
  基于旧代码提的 PR 会产生无关 diff。
- 分支名按上游约定来（常见 `fix/xxx`、`feat/xxx`、`<issue号>-xxx`、或上游指定的 `patch-1` 式）。
  约定从 `CONTRIBUTING.md` 和历史 PR 标题里读，**不要从 workflow 的 `on.pull_request.branches` 推** ——
  那个字段筛的是 **base 分支**（PR 往哪个分支提），不是 head 分支的命名规则。
- **base 分支要提对**：workflow 的 `on.pull_request.branches` 写的 base 才是能触发 CI 的目标分支。
  上游若同时维护 `main` 和 `develop`，别默认往 `main` 提。
- **永远不往 upstream 推**。upstream 只用来 fetch。

### 阶段 5 · 写改动（最小 + 同风格 + 自证）

- **同风格**：照着周围代码写（命名、注释密度、错误处理、目录布局）。上游风格 ≠ 你自己的偏好。
- **最小**：一个 PR 一件事。`git diff --stat` 能用一句话说清改了什么，就合格。
- **带测试**：修 bug 必须有**先失败后通过**的回归测试 —— 这是维护者判断可信度最快的证据。
- **不碰**：无关文件、格式化噪音、依赖版本、生成物。
- **不泄露**：日志、截图、fixture 里不能带 token / 内网地址 / 用户数据。提交前扫一遍：

```bash
git diff --cached | grep -nEi "(api[_-]?key|secret|token|password|BEGIN [A-Z ]*PRIVATE KEY)[:=]" 
```

### 阶段 6 · 开 PR（让维护者 30 秒能判断）

标题按上游约定（多数项目是 Conventional Commits）：

```
fix(parser): handle empty input instead of throwing
```

正文结构固定为五块，缺一块维护者就得追问：

```markdown
## 什么变了
一句话说清行为变化（不是「改了点代码」）。

## 为什么
关联 issue：Fixes #123
（没有 issue 时写清用户会遇到什么症状。）

## 怎么验证
- [ ] `npm test -- parser` （或项目真实命令）
- 复现步骤：<最小可复现输入/命令> → 修复前报错，修复后输出 <X>

## 影响面
只影响 <模块/场景>，不改 API 签名 / 不改默认行为。

## 截图 / 日志
（UI 改动贴前后对比；日志改动贴真实日志片段，注意脱敏。）
```

模板在 `templates/` 下，直接改别重写。

**开 PR 前的机械门禁**（挡掉低级失误：格式、越界、密钥）：

```bash
node scripts/pr-lint.mjs --title "..." --body-file /tmp/pr-body.md \
  --diffstat "$(git diff --shortstat upstream/main...HEAD)" \
  --base upstream/main --head $(git branch --show-current)
```

### 阶段 7 · 跟进到终局（提了 ≠ 结束）

| 情况 | 动作 |
|---|---|
| **CI 红** | 看真实日志：`gh run view <id> --log-failed`。本地复现 → 修 → 推。**不要靠重跑 CI 解决真 bug**（重跑掩盖不了确定性失败） |
| **CI 红但看不出问题** | 区分「确定性失败」和「网络/依赖抖动」。抖动可重跑一次；确定性失败必须改 |
| **维护者要求改** | 逐条回应：认同的直接改并说明怎么改的；不认同的**给理由不争论**（给出数据或复现）。一次回复对应一个评审点，别 lump |
| **要求拆 PR** | 拆。小的先合，别赌 |
| **长期无响应** | 一次礼貌跟进（7–14 天），之后不再刷。维护者不欠你时间 |
| **被 close** | 问清原因；如果是「不该这么改」，记录教训，换下一个候选 |

**不要做的事**：自己给自己的 PR approve / merge；用 `--admin` 强行推；连续催；改 PR 标题到看不出改了什么。

## 硬红线

1. **不往 upstream 推** —— 只推自己的 fork
2. **不用 `--admin` / 不改别人 PR** / 不 merge 自己的 PR
3. **不伪造作者、不冒充人** —— commit 用真实身份，AI 参与按上游要求披露
4. **不碰维护者主权**（CI 配置、发布流程、权限、CODEOWNERS、DCO）
5. **不提交密钥 / 内部地址 / 用户数据**
6. **不批量刷 PR** —— 一个 repo 的 PR 数量本身就是维护者的负担
7. **不隐瞒范围** —— 改动大于预期就拆开或提前说
8. **不确定就问用户，不要猜着推** —— 尤其是「值不值得提」「改哪个方向」

## 环境要求

| 依赖 | 必需性 | 缺失怎么办 |
|---|---|---|
| `git` | 必需 | — |
| `gh` (GitHub CLI) | 强烈建议 | 脚本会退回 `curl` + `GITHUB_TOKEN`；PR 创建仍需 `gh` 或 REST |
| `node` ≥ 18 | 建议（跑两个 `.mjs` 脚本） | 手动执行脚本里的等价命令，SKILL.md 每处都给了原命令 |
| `GITHUB_TOKEN` | `gh` 不可用时 | 从密钥库取，**不要写进仓库或命令行历史** |

## 更新与分发

| 场景 | 怎么做 |
|---|---|
| **本 skill 怎么装到各 Agent** | `./install.sh`（建软链到 claude / codex / agents / dsh / magpie 五个目录）；`--copy` 用拷贝、`--list` 只检测、`--uninstall` 卸载 |
| **GitHub 上更新了版本，本地怎么跟上** | `bash scripts/check-update.sh --update`（只快进，不覆盖本地改动） |
| **Agent 使用时会不会自己提示更新** | **不会主动提示**。软链指向本地 clone，Agent 读的是工作区快照，没有版本感知。两道保险：① 维护者的机器有每日自动快进任务（launchd，07:17，只做 fast-forward）② 任何机器都能手动跑 `check-update.sh` |
| **别人怎么用这个 skill** | clone 后按 README 的「装到各个 Agent 框架」一节，或直接拷 `SKILL.md` + `scripts/` + `references/` + `templates/` 进自己的 skill 目录 |

> **给 Agent 的提示**：如果你觉得某个脚本行为和文档不符，可能是本地版本旧了。
> 先跑 `bash scripts/check-update.sh`（退出码 1 = 有更新），**告知用户有更新并说明差了什么**，
> 确认后再 `--update`。不要擅自更新 —— 本地可能有未推送的改动。

## 相关 Skills

- `github-pr-workflow` — 自己仓的 PR 生命周期（分支/commit/合并）细节
- `github-code-review` — review 别人 PR 的 diff 与行内评论
- `github-issues` — 建单、打标签、认领 issue
- `github-repo-management` — clone / fork / 远端管理
- `task-board` — 公司侧 GitLab 看板的拉单/交单流程

## 参考文档

- `references/finding-work.md` — 怎么系统地找到值得提的改动（信号源清单 + 挖掘流程）
- `references/guardrails.md` — 会被拒绝的 PR 模式全集 + 安全边界
- `references/pr-conventions.md` — 上游约定探测方法（提交信息 / 分支 / 标题 / DCO / CLA）
- `references/pr-description.md` — 标题与正文的写法（含五块结构 + 反例）
- `references/review-and-ci.md` — CI 排障与 review 应对手册
