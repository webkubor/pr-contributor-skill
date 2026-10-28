> 用途：阶段 2 · 挖信号时建立候选清单，阶段 3 · 价值门禁时筛到 1～2 个可验证方向。

# 怎么找到值得提的改动

先完成阶段 0 · 判定目标与权限、阶段 1 · 读懂项目；归档仓库直接放弃。
下文在目标仓目录执行；替换示例值，不把占位值当真实仓库请求。

```bash
REPO=OWNER/REPO
DEFAULT=$(gh api "repos/$REPO" --jq '.default_branch')
gh api "repos/$REPO" --jq '{archived,default_branch,permissions}'
node scripts/scan-contribution-signals.mjs --repo "$REPO" --json
```

脚本输出是线索，不代表允许改动；每个候选都要保存原始 issue、运行或文档位置。
`gh` 请求出现 403/404 时先核实权限；不能把“看不到”写成“没有告警”。

## 信号源清单

| 来源 | 获取命令 | 强度 | 适合改动 | 常见误报 |
|---|---|---|---|---|
| good first issue | `gh issue list -R "$REPO" --label "good first issue"` | 中 | 已定义的小修复 | 标签过时、已认领 |
| help wanted | `gh issue list -R "$REPO" --label "help wanted"` | 中高 | 维护者明确需要的修复 | 需要领域知识 |
| bug open issue | `gh issue list -R "$REPO" --label bug` | 中高 | 回归测试与修复 | 配置问题、已修未关 |
| 默认分支长期红 | `gh run list -R "$REPO" --branch "$DEFAULT" --limit 30` | 中 | 可本地复现的失败 | 外部服务或权限失败 |
| dependabot | `gh api "repos/$REPO/dependabot/alerts?state=open"` | 高 | advisory 对应的依赖问题 | 不可达代码、机器人已处理 |
| security advisories | `gh api "repos/$REPO/security-advisories"` | 高 | 已公开且允许处理的漏洞 | 草稿不可见、非当前版本 |
| README 命令失效 | `git show HEAD:README.md` | 高 | 按真实行为修文档 | 漏前提、版本用错 |
| 文档链接 404 | `curl -IL --max-time 20 "$URL"` | 中 | 更新已确认失效的链接 | 防爬、临时故障 |
| TODO/FIXME 有 issue | `git grep -nE 'TODO|FIXME|XXX'` | 中 | 已约定的小功能或修复 | 仅备忘、issue 被否决 |
| 用户报错及复现 | `gh issue view "$ISSUE" -R "$REPO" --comments` | 高 | 先失败后通过的测试 | 私有环境、缺输入 |
| Discussions 重复抱怨 | 下方 GraphQL 查询 | 中 | 已确认的共同症状 | 使用疑问、不接受的功能 |
| stale bot issue | `gh issue list -R "$REPO" --label stale` | 低 | 重新验证仍存在的 bug | 自动关闭不代表需求 |
| good first issue 被抢 | `gh issue view "$ISSUE" -R "$REPO" --json assignees,comments` | 排除信号 | 换候选或协调 | “我想试”后长期未动 |

列表命令默认只查 open；需要完整采样时显式加 `--limit 100`，不要把第一页当全集。
多个标签一次传入通常表示交集；分别查询后按 issue 号去重，避免漏掉候选。

## 每类信号怎么核实

### 标签、用户报错、认领迹象

```bash
ISSUE=123
gh issue list -R "$REPO" --state open --label bug --limit 100
gh issue view "$ISSUE" -R "$REPO" --json title,body,labels,assignees,comments,url
gh api --paginate "repos/$REPO/issues/$ISSUE/timeline" --jq '.[] | {event,source,created_at}'
```

已分配 assignee、近期评论“working on this”、关联 open PR 都说明有人在做。
无 assignee 不能证明无人认领；检查最近评论和关联事件后再决定。
用户报告至少需要版本、最小输入、执行命令、实际与预期；缺关键项先问用户。
不要把未脱敏的用户输入复制为 fixture；先构造等价的合成数据。

### 默认分支 CI 与安全告警

```bash
gh run list -R "$REPO" --branch "$DEFAULT" --event push --limit 30 \
  --json databaseId,workflowName,headSha,conclusion,createdAt
gh run view RUN_ID -R "$REPO" --log-failed
gh api --paginate "repos/$REPO/dependabot/alerts?state=open&per_page=100" \
  --jq '.[] | {number,dependency,security_advisory,security_vulnerability}'
gh api --paginate "repos/$REPO/security-advisories?per_page=100"
```

同一 workflow 在多个不同 SHA 连续失败才是“长期红”的线索；读第一处失败栈。
只在一个 PR 红，不足以认定默认分支问题；区分 push 与 pull_request 的环境。
告警要核对受影响范围、修复版本、项目实际调用；不凭严重等级盲目升级。
本 skill 不提交 lock 文件、生成物或维护者主权文件；需要它们才成立的候选先停下问用户。
未公开漏洞按上游安全报告渠道处理，不在公开 issue/PR 贴利用细节。

### 文档与代码、TODO

```bash
git grep -nE 'https?://|npm |pnpm |yarn ' -- README.md docs
git grep -nE '(TODO|FIXME|XXX).*#[0-9]+' -- ':!vendor' ':!dist'
git log --all --oneline --grep="#$ISSUE"
URL=https://example.org/documentation
curl -IL --max-time 20 "$URL"
```

路径不存在时改用项目真实文档目录；`git grep` 返回 1 表示未匹配，不是命令故障。
逐条执行 README 的前提、安装与运行步骤，记录版本和退出码。
链接用浏览器或 GET 二次确认；HEAD 返回 403/405 不能判定 404。
TODO 中的 `#N` 必须打开 issue 核对；issue 已关闭或维护者拒绝时不实现。

### Discussions 与 stale

```bash
OWNER=${REPO%/*}
NAME=${REPO#*/}
gh api graphql -f owner="$OWNER" -f name="$NAME" -f query='
query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
 discussions(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){
 nodes{number title body url comments(first:10){nodes{body}}}}}}'
gh issue list -R "$REPO" --state all --label stale --limit 100
```

此查询只采样最近 30 个讨论、每个 10 条评论；需要更多时按 cursor 分页。
反复抱怨要归并为同一可复现症状，并检查维护者是否已解释产品取舍。
stale bot 的提醒、自动开单或自动关闭只是时间信号，不能替代有效复现。

## 从广撒网到只选 1～2 个

1. 分别采样标签、默认分支 CI、文档和讨论，建立 5～10 个候选。
2. 每项写：原始链接、用户症状、预期改动文件、验证命令、重复检索结果。
3. 逐项过四道门；任何一道不过就丢弃、拆小或补证据。
4. 只给过门候选打分，按总分排序；同分优先验证成本低、改动面小的。
5. 只选 1～2 个方向供决策；一次执行一个 PR，不批量刷 PR。
6. 对“值不值得提”或方向仍不确定时问用户，禁止猜着推。

| 门 | 通过判据 | 不通过动作 |
|---|---|---|
| 信号门 | 有 issue / CI / 用户报错 / 文档不一致 / advisory | 丢弃审美偏好 |
| 范围门 | 只碰必要文件，无格式化、改名、顺带重构 | 拆小或放弃 |
| 可验证门 | 项目自己的命令能证明修复前失败、修复后通过 | 补复现或测试 |
| 相关门 | 合入理由是修好了什么，且符合项目主线 | 换候选 |

## 候选评分

每维 0～2 分，共 10 分；分数不能覆盖四道门的失败。

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 影响用户数 | 只有猜测 | 一个有效报告 | 多个独立报告或核心路径 |
| 复现确定性 | 无复现 | 条件明确但待补 | 最小测试稳定失败 |
| 改动面 | 跨多模块 | 单模块多文件 | 局部实现与回归测试 |
| 验证成本 | 依赖不可得环境 | 本地可跑但耗时 | 项目命令快速稳定 |
| 与项目主线相关度 | 被拒或偏离目标 | 接受方向尚不明确 | 维护者明确支持 |

候选表格式：`信号链接 | 症状 | 四门结果 | 五维分数 | 必要文件 | 验证命令 | 重复检查时间`。
7～10 分优先，4～6 分补证据，0～3 分换候选；这只是排序建议，不是自动授权。

## 避免已经修过或已有 PR

```bash
gh pr list -R "$REPO" --state all --search "#$ISSUE" --limit 100
gh pr list -R "$REPO" --state all --search 'empty input' --limit 100
gh issue view "$ISSUE" -R "$REPO" --comments
git fetch upstream
git log "upstream/$DEFAULT" --oneline --grep='empty input' -i
git log "upstream/$DEFAULT" -S 'suspectExpression' -- path/to/file
```

关键词检索会漏掉未关联的 PR；同时查症状、模块名、错误文本和 timeline。
已 merged 时在最新 `upstream/<默认分支>` 重跑复现；仍失败再判断是否是另一问题。
已有 open PR 就换候选；不要另开竞争 PR。已关闭 PR 要读关闭原因再决定。

## 不值得提的候选

| 候选 | 放弃原因 |
|---|---|
| 纯格式化、纯改名、纯注释 | 没有外部行为收益，增加审阅成本 |
| “顺便统一全仓风格” | 范围门失败，掩盖必要修复 |
| 只因版本旧而升级 | 无 issue/advisory 依据，引入兼容风险 |
| 只有 AI 推断的 bug | 缺复现与项目命令验证 |
| 维护者明确拒绝的功能 | 相关门失败，绕过项目决策 |
| 需要 CI、发布、权限或生成物变更 | 超出本 skill 的贡献边界 |
| stale 标签但当前版本正常 | 自动化噪音，不是未解决需求 |
| 同一 issue 已有 open PR | 重复劳动，增加维护者负担 |
