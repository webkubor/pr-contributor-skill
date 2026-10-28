> 用途：阶段 5 · 写改动后提交时选用；先探测上游约定，替换 <...>，不要把提示文字提交为消息。

# Conventional Commits 提交信息模板

```text
<TYPE>(<SCOPE>): <说明行为变化的简短英文祈使句>

<为什么需要这次改动；症状、约束与必要实现，避免重复标题。>

Refs #<ISSUE_NUMBER>
```

- TYPE 按上游枚举选择：fix / feat / docs / test / perf / refactor / chore / build / revert。
- SCOPE 使用上游已有模块名；可选且无必要时连同括号删除。
- 一次提交只处理本次 PR 的必要改动；类型名不解除 guardrails 的禁止项。
- 没有关联 issue 就删除 Refs 行；完整解决需关闭时可按上游约定使用 Fixes 或 Closes。
- 公共 API 或默认行为的破坏性变化必须明确披露；先确认方向，按上游规则使用 `!` 或 `BREAKING CHANGE:`，不能隐瞒。
- 建议标题不超过 72 字符；上游规定优先。

## DCO sign-off

先确认上游要求以及真实身份：

```bash
git config user.name
git config user.email
git commit -s
```

`git commit -s` 自动添加 `Signed-off-by: <REAL_NAME> <REAL_EMAIL>`，不要照抄占位符或冒用他人身份。
`-s` 是 DCO sign-off，不是密码学签名 `-S`，也不是 CLA 签署。
如果使用消息文件，先把上方纯文本填到仓库外的临时文件，再按实际路径执行：

```bash
git commit -s --file /tmp/commit-message.txt
```

上游未要求 DCO 时按其规则提交；CLA 需要用户本人承诺时不能由 Agent 代签。
AI 参与按上游要求披露，不伪造作者；已共享提交漏 sign-off 时先核对重写历史政策，不擅自强推。
