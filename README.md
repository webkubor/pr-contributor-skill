<h1 align="center">🔀 PR Contributor</h1>

<p align="center">
  <a href="https://github.com/webkubor/pr-contributor-skill/releases"><img src="https://img.shields.io/github/v/release/webkubor/pr-contributor-skill?style=for-the-badge&color=3fb950&label=release" alt="release" /></a>
  <a href="https://github.com/webkubor/pr-contributor-skill"><img src="https://img.shields.io/badge/skill-version-0.1.0-646cff?style=for-the-badge" alt="skill version" /></a>
  <img src="https://img.shields.io/badge/license-MIT-777?style=for-the-badge" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/agents-any--agent-purple?style=for-the-badge" alt="any agent" />
</p>

<p align="center">
  <strong>给开源项目提一个维护者愿意合的 PR。</strong><br>
  读懂上游规矩 → 从真实信号里挖出该改的点 → 最小改动 → 跑上游自己的检查 → 开 PR → 跟到合。
</p>

<p align="center">
  <a href="#安装">安装</a> · <a href="#为什么需要它">为什么需要它</a> · <a href="#它做什么">它做什么</a> · <a href="#快速开始">快速开始</a> · <a href="#参考文档">参考文档</a>
</p>

---

## Why This

Agent 写代码很强，但**提 PR 是另一门手艺**。会写代码 ≠ 会贡献。

| | 让 Agent 直接提 PR | **PR Contributor** |
|---|---|---|
| 改什么 | Agent 自己挑「看着能改」的地方 | 只从**外部可见信号**里选（issue / CI 红 / 用户报错 / 文档不一致） |
| 上游规矩 | 提完才知道有 CONTRIBUTING | 动手前先读出来（提交格式 / 分支名 / DCO / 必跑门禁） |
| 改动范围 | 容易夹带无关重构 | 越界文件（CI 配置、许可证、lock）**机械拦下** |
| PR 正文 | 复制 commit message | 五块结构模板，维护者 30 秒能判断 |
| CI 挂了 | 不知道看哪 | 排障手册 + 区分「确定性失败」和「环境抖动」 |
| 被 review 打回 | 不知道怎么回 | 逐条回应模板，给证据不争论 |

**一句话**：把「提了个维护者不想要的 PR」这个最大失败模式，变成流程里可判定、可拦截的环节。

---

## 为什么需要它

真实的上游贡献，失败很少发生在「代码写错了」，绝大多数发生在**提交前的判断**：

- 提了纯格式化 PR —— 维护者直接 close，你在这个 repo 的信誉归零
- 改了 `package-lock.json` —— 噪音，没人想 review
- 没跑上游的 lint/typecheck —— CI 才炸，浪费维护者一轮 CI 配额
- 正文只写「修复了 bug」 —— 维护者得反问「怎么验证的」
- 同一 issue 已经有别人的 PR —— 重复劳动，两边打架
- 分支基于自己 fork 的旧版本 —— diff 里混着无关改动

这些**每一条都能机械判定**。所以本 skill 不写「要善于发现问题」这种废话，而是给出**可执行的判据和可跑的脚本**。

---

## 它做什么

七阶段闭环，每阶段都有可执行的入口：

| 阶段 | 做什么 | 入口 |
|---|---|---|
| **0 · 判定目标与权限** | 你是维护者？有没有写权限？仓归档了没？**没有权限就别急着改代码** | `scripts/pr-preflight.sh` |
| **1 · 读懂项目** | 提交格式 / 分支名 / PR 标题 / 必跑门禁 / DCO·CLA —— 动手前全读出来 | `references/pr-conventions.md` |
| **2 · 挖信号** | issue 标签、CI 失败、依赖告警、文档不一致、TODO —— 汇成带优先级的候选表 | `scripts/scan-contribution-signals.mjs` |
| **3 · 价值门禁** | 信号门 / 范围门 / 可验证门 / 相关门 —— **四道门任一不过就别提** | SKILL.md §阶段 3 |
| **4 · 搭分支** | fork + upstream 远端 + **从 upstream 默认分支**开分支（不夹带旧 diff） | `scripts/setup-upstream.sh` |
| **5 · 写改动** | 同风格、最小、带回归测试、不碰生成物与密钥 | SKILL.md §阶段 5 |
| **6 · 开 PR** | 五块结构正文 + 机械门禁（格式 / 越界 / 密钥 / 规模） | `scripts/pr-lint.mjs` |
| **7 · 跟进到终局** | CI 排障、review 逐条回应、拆分、被 close 的处理 | `references/review-and-ci.md` |

### 三个脚本

```bash
# 0. 体检：鉴权 / 权限 / 仓库状态 / API 配额
bash scripts/pr-preflight.sh OWNER/REPO

# 2. 挖信号：候选表（纯只读，不改任何东西）
node scripts/scan-contribution-signals.mjs --repo OWNER/REPO

# 4. 接上游：fork + upstream + 从上游开分支（幂等）
bash scripts/setup-upstream.sh OWNER/REPO --branch fix/issue-123

# 6. 开 PR 前机械门禁
node scripts/pr-lint.mjs --title "fix(parser): ..." --body-file body.md --auto
```

脚本都是**只读或幂等**的：不会替你开 PR、不会评论 issue、不会改上游。

---

## 快速开始

```bash
# 1. 放进你的 Agent skill 目录
git clone https://github.com/webkubor/pr-contributor-skill.git
cp -r pr-contributor-skill ~/.claude/skills/pr-contributor

# 2. 体检目标仓
cd /path/to/target-repo && bash ~/.claude/skills/pr-contributor/scripts/pr-preflight.sh OWNER/REPO

# 3. 挖信号，看有哪些值得做的
node ~/.claude/skills/pr-contributor/scripts/scan-contribution-signals.mjs --repo OWNER/REPO
```

### 装到各个 Agent 框架

| 框架 | 位置 | 说明 |
|---|---|---|
| Claude Code | `~/.claude/skills/pr-contributor` | 软链或拷贝都行 |
| Codex CLI | `~/.codex/skills/pr-contributor` | 同上 |
| 通用 agents | `~/.agents/skills/pr-contributor` | 多数新框架读这里 |
| DeepSeek Harness | `~/.dsh/skills/pr-contributor` | 或项目内 `.dsh/skills/` |
| Hermes | 通过 `external_dirs` 指向本仓 | 见其配置 |

规范只有一条：**目录里有 `SKILL.md`，Agent 从这里读起**。所以任何框架都能用，不需要插件。

---

## 参考文档

| 文档 | 何时读 |
|---|---|
| [`references/finding-work.md`](references/finding-work.md) | 不知道该改什么 —— 信号源清单 + 挖掘流程 + 打分表 |
| [`references/guardrails.md`](references/guardrails.md) | 哪些 PR 会被 close，以及越权文件怎么识别 |
| [`references/pr-conventions.md`](references/pr-conventions.md) | 怎么把上游的提交格式 / 分支名 / DCO / 门禁探测出来 |
| [`references/pr-description.md`](references/pr-description.md) | 标题与正文怎么写（含正反例） |
| [`references/review-and-ci.md`](references/review-and-ci.md) | CI 挂了怎么排、review 意见怎么回 |

模板在 [`templates/`](templates/)：PR 正文五块结构、提交信息、标题候选。

---

## 设计原则

1. **只从真实信号起手** —— 没有外部可见理由的改动，不提。
2. **机械能判的交给机器** —— 格式、越界、密钥、规模，让脚本拦，不靠 Agent 自觉。
3. **价值判断留给人和有判断力的 Agent** —— 脚本不替你决定「这个改动值不值得」。
4. **不越权** —— CI 配置、许可证、治理文件、发布流程，一律先在 issue 里问。
5. **每条规则都带命令** —— 规则不能落到命令上，就等于没有。

---

## 许可

MIT © webkubor
