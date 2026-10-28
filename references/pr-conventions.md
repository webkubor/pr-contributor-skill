> 用途：阶段 1 · 读懂项目时提取上游约定，阶段 4 · 搭好分支与阶段 6 · 开 PR 前复核。

# 上游约定探测方法

先读上游规范，再用历史样本与实际 CI 验证；没有证据的约定标为未知。
在目标仓目录执行。示例 `OWNER/REPO`、`PR_NUMBER` 替换为真实公开目标。

```bash
REPO=OWNER/REPO
git ls-files '*CONTRIBUTING*' '*PULL_REQUEST_TEMPLATE*' '*commitlint*' '*DCO*' '*CLA*'
git log -30 --format='%h %s'
gh pr list -R "$REPO" --state merged --limit 30 --json title,headRefName,baseRefName
```

建立约定记录：`项目 | 规则 | 原文路径/行 | 样本 | 本地命令 | 仍未知项`。
规范与历史冲突时优先当前明确规则；规范互相冲突或方向不明时问用户。

## 提交信息格式

```bash
git log -30 --no-merges --format='%s'
git log -10 --format='%B'
git grep -nEi 'commitlint|conventional|commit message|angular|sign.off' -- . ':!vendor' ':!dist'
```

| 样本 | 判定 | 继续检查 |
|---|---|---|
| `fix(parser): handle empty input` | Conventional Commits 候选 | type/scope 枚举、大小写、长度 |
| `fix(parser): ...` 且规范声明 Angular | Angular 风格候选 | 以本项目规则为准，不能只看形状 |
| `[parser] Handle empty input` | 自定义前缀 | 允许模块、动词及 issue 号位置 |
| `PROJ-123: Handle empty input` | 自定义编号 | 编号真源及是否必须有关联单据 |
| 多种混合 | 无稳定结论 | 查 lint 配置与近期人工提交 |
| 全部为 merge/squash 文案 | 样本不足 | 看 PR commits 与贡献规范 |

不要把 Angular 与 Conventional Commits 当成完全互斥的字符串格式。
`!` 或 `BREAKING CHANGE:` 表示破坏性变更；不能为过 lint 隐去真实影响。
历史 30 条只作采样，不把某个维护者偶然写法提升为强制规则。

## 分支名与 base 分支分开探测

```bash
gh pr list --repo "$REPO" --limit 30 --json title,headRefName --jq '.[].headRefName'
gh pr list --repo "$REPO" --state merged --limit 30 \
  --json title,headRefName,baseRefName
git branch -r
git grep -nEi 'branch|分支|patch-|fix/|feat/' -- '*CONTRIBUTING*' '.github/*'
```

分支命名约定来自 CONTRIBUTING、历史 PR 的 headRefName、现有分支列表。
历史 PR 标题可以提示 issue 前缀，不能单独证明 head 分支必须同名。
已有 `fix/xxx`、`feat/xxx`、`123-xxx` 只说明惯例；若规范无强制要求，选最接近的。
`on.pull_request.branches` 筛选 **base 分支**，不能从它推导 head 分支命名。
上游同时维护 main/develop 时，先确认修复应该进入哪个 base；不要默认 main。
分支始终从 `upstream/<默认分支>` 开；目标分支另有明确要求时先核对主入口与上游规范。

## PR 标题、type 与 scope

```bash
gh pr list -R "$REPO" --state merged --limit 30 --json title --jq '.[].title'
git grep -nEi 'semantic.pull|pull.request.title|commitlint|types:|scopes:|subjectPattern' -- .github
```

| 证据 | 能判定什么 | 不能判定什么 |
|---|---|---|
| 标题 lint 配置 types/scopes | 强制允许值 | 提交也受同一规则约束 |
| squash merge 说明 | PR 标题可能成为最终 commit | 每个中间 commit 可任意写 |
| PR 模板文字 | 正文所需的信息 | 机器人一定强制执行 |
| 历史标题多数带 scope | 惯例 | scope 一定必填 |

看 workflow 使用的 action 参数与被引用配置；仅搜到 action 名称不足以确认规则。
提交 lint 与 PR 标题 lint 分开记录；两者可能有不同最大长度与 scope 限制。

## DCO 与 CLA

```bash
git grep -nEi 'DCO|Signed-off-by|sign.off|CLA|contributor license' -- .github '*CONTRIBUTING*' '*README*'
git log -10 --format='%B' | grep -n 'Signed-off-by:'
gh pr checks PR_NUMBER -R "$REPO"
git config user.name
git config user.email
```

DCO 是贡献来源声明；提交中的 `Signed-off-by:` 通常由下面命令添加。

```bash
git commit -s
```

使用真实作者身份；`-s` 不是密码学签名，不能替代项目要求的 `git commit -S`。
已有提交漏 sign-off 时，先检查是否已共享与上游重写政策；不要擅自强推改历史。
CLA 是独立协议：检查规范、PR 机器人检查的官方链接与适用主体。
若需要登录或本人法律承诺，让用户亲自完成；Agent 不代签、不勾选同意。
签署后重新查看 CLA 检查；DCO 通过不能证明 CLA 已通过，反之亦然。

## 找出 PR 触发时实际运行的 workflow

先列文件，再查触发器与命令；grep 给导航，完整 YAML 给结论。

```bash
git ls-files '.github/workflows/*.yml' '.github/workflows/*.yaml'
grep -nE 'on:|pull_request|pull_request_target|push:|workflow_dispatch|workflow_call|branches:|paths:|if:|uses:|run:' .github/workflows/*.y*ml
```

文件不存在时 glob 会报错；这是“当前未找到该类文件”，继续检查其他 CI 系统。
用带行号的完整内容确认缩进、数组写法和多行 `run: |`，不能只复制 grep 命中行。
若本机已有 PyYAML，可解析触发器与 job/step；不要为查规则给目标仓添加依赖。

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
for p in sorted(Path('.github/workflows').glob('*.y*ml')):
    d = yaml.safe_load(p.read_text()) or {}
    trigger = d.get('on', d.get(True))  # YAML 1.1 解析器可能把 on 当布尔键
    print(p, 'TRIGGERS', trigger)
    for name, job in d.get('jobs', {}).items():
        print('JOB', name, 'if=', job.get('if'), 'matrix=', job.get('strategy'))
        for step in job.get('steps', []):
            print('STEP', step.get('name'), step.get('uses'), step.get('run'))
PY
```

| 触发器/条件 | 判读 |
|---|---|
| `pull_request` | PR 事件触发；默认 types 仍有限制，检查显式 types |
| `pull_request.branches` | 匹配 base；还要检查 branches-ignore |
| `paths` / `paths-ignore` | 由改动路径决定是否触发，不能只看分支 |
| `push` | 推送事件；可能跑 fork 分支，但不等于 PR 门禁 |
| `workflow_dispatch` | 手动触发；不是 `trigger_dispatch`，也不是自动 PR 触发 |
| `repository_dispatch` | 外部事件触发，查 event type 与调用方 |
| `workflow_call` | 可复用 workflow，沿调用它的 `uses:` 继续找 |
| `pull_request_target` | base 仓上下文；不可在本地照搬特权、密钥或不可信执行 |
| job/step 的 `if:` | 可能按 actor、draft、fork、路径或输出跳过 |

继续展开本地 composite action 的 action.yml、reusable workflow、matrix 与 needs 链。
`working-directory`、`defaults.run`、shell、services、容器和 env 都是命令上下文。
“workflow 存在”不等于“这次 PR 跑过”；用实际 run 的 event、SHA、job 列表确认。

## 提取本地门禁命令

```bash
git grep -nE 'node-version|packageManager|working-directory|npm ci|pnpm |yarn |lint|format|typecheck|test|build' -- .github/workflows package.json
gh run list -R "$REPO" --event pull_request --limit 10 \
  --json databaseId,headSha,workflowName,conclusion
gh run view RUN_ID -R "$REPO" --json jobs
node -p 'JSON.stringify(require("./package.json").scripts,null,2)'
```

记录 lint、format、typecheck、test、build 各自真实命令；缺某项写“未发现”，不自造脚本。
例如 workflow 写 `npm run check:types`，本地就执行它，不能自行替换成 `npx tsc`。
安装使用 workflow 的包管理器与冻结安装方式；禁止为解决本机安装问题提交 lock diff。
format 检查用上游 check 模式；不要未经审阅运行全仓自动修复。

## 多个 CI 系统并存

| 系统 | 找什么 | 本地取舍 |
|---|---|---|
| GitHub Actions | workflow、required checks | 跑适用 job 的真实命令 |
| CircleCI | .circleci/config.yml 的 workflow/filter | 跑对应 job，注意容器和上下文 |
| pre-commit | .pre-commit-config.yaml 的 hooks/stages | 按上游运行 `pre-commit run --all-files` |
| husky | .husky 下 hook 与调用脚本 | 检查 commit/push 入口，不跳过 hook |
| commitlint | 配置 extends/rules 与调用位置 | 用项目已安装的脚本或 hook |

这些系统是并集，不能因本地 hook 绿就宣称远端全绿；重复命令可复用同一次证据。
需要 secret、发布权限或外部服务的步骤标为未本地执行，交维护者检查，不模拟通过。

## 本地复现上游门禁的标准流程

1. 确认 base、HEAD SHA、Node 与包管理器版本，以及干净的安装前状态。
2. 按 workflow 冻结安装；记录命令、工作目录、必要的无敏感环境变量。
3. 运行最小复现，保存修复前失败证据；实现后用同命令证明通过。
4. 顺序跑适用的 lint / format / typecheck / test / build，保留退出码与摘要。
5. 检查完整 diff，确认安装与生成没有产生 lock、生成物或无关变化。
6. 正文逐项列已执行与未执行的检查；远端完成后对照实际 PR checks。
