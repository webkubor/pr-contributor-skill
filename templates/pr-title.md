> 用途：阶段 6 · 开 PR 时按上游允许的 type/scope 选标题候选，替换 <...> 后只保留一行。

# 标题候选模板

| type | 候选 | 使用判据 |
|---|---|---|
| fix | `fix(<SCOPE>): <correct the user-visible failure>` | 已复现的 bug，有回归证据 |
| feat | `feat(<SCOPE>): <add the accepted user capability>` | 上游明确接受的能力 |
| docs | `docs(<SCOPE>): <correct the verified instruction>` | 文档误导已实际验证 |
| test | `test(<SCOPE>): <cover the reported regression>` | 有外部信号的覆盖缺口 |
| perf | `perf(<SCOPE>): <reduce the measured cost>` | 有真实场景与基线测量 |
| refactor | `refactor(<SCOPE>): <describe the agreed local change>` | 已确认必要性，非大范围重写 |
| chore | `chore(<SCOPE>): <describe the issue-backed maintenance>` | 有 issue 依据且不越界 |
| build | `build(<SCOPE>): <describe the verified build fix>` | 无 lock/生成物/发布流程改动 |
| revert | `revert: <describe the behavior being restored>` | 上游认可的回退与影响证据 |

- scope 取自上游已有模块或枚举；可选且无必要时删除括号与占位符。
- 用户可见行为放前面，避免 `update file`、`fix function`、`various fixes`。
- 建议总长不超过 72 字符；上游 lint 规则更严格时按其规则。
- ci/style 可以是上游合法 type，但本 skill 不提交 CI 变更或纯格式化 PR，因此不列可执行候选。
- 有破坏性变化先确认方向，再按上游要求显露 `!` 与影响；不能靠短标题隐藏范围。
- 标题必须对上最终 diff；修改实现后重新检查标题、正文与 issue 关联。
