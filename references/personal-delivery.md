# 自有个人仓：从修改到远端交付

适用 GitHub、GitLab 和其他标准 Git 服务上的自有个人项目，包括私有仓。公司仓按公司规则执行，不能套用个人直合。拥有 push 权限不等于拥有改变项目治理规则的权限。

## 开工记录

先读项目自己的 AGENTS、贡献指南、测试与发布要求。记录本次任务对应的主机、仓库、worktree、分支、目标 remote/base 和初始 HEAD。不得把机器昵称、私人地址、凭据写进公开源码。

在仓库外的任务记录中写明：要解决什么问题、用什么输入复现、如何证明已解决。无关 WIP 不属于本任务，不自动 stash、stage 或提交它。

```bash
# SKILL_DIR 是本 skill 的绝对路径，REPO 是目标仓路径。
python3 "$SKILL_DIR/scripts/delivery.py" audit --repo "$REPO" --remote origin --base main
```

audit 在完整取证但仍有待交付项时可返回 0；verify/receipt 只有全部交付才返回 0。阅读具体 worktree 状态；另一任务在途不等于本任务失败，也不能因此宣称全仓干净。远端无法刷新是 unknown，不允许用缓存输出“全部已交付”。

## 隔离修改

```bash
git -C "$REPO" fetch origin
# 先核实路径不存在、分支未占用，再创建；目标分支按项目约定指定。
git -C "$REPO" worktree add -b fix/example /absolute/path/example-wt origin/main
```

也可用 delivery.py 的 create 子命令（先查看 --help）。worktree 必须能通过 `git worktree list --porcelain` 找到，不依赖约定目录深度。任务中禁止将生产目录里的临时改动留作唯一真源：必须带回仓库、验证并提交。

## 验证与提交

1. 运行项目真正要求的检查，记下命令与结果。只跑语法检查不能替代行为验证。
2. 审阅 `git diff`，用明确路径 `git add <files>`，检查 staged diff；不得盲目 `git add -A` 吞掉别人的工作。
3. 按项目要求提交，保留真实作者和 Agent 披露。文件未提交、提交只在本机，都不算完成。
4. 用 `git push -u origin <branch>` 保全远端分支。服务器 SSH 断开前至少完成此步；push 失败就记录主机、worktree、SHA 和错误类别，不能报成功。

## 合入目标主干

自有仓、用户已授权直合、项目门禁通过时，完成合入，不把“要不要推送”重复抛给用户。受保护分支或仓库要求 MR/PR 时走平台评审，不绕保护。

```bash
# 在任务 worktree 内，先确认没有未提交文件。
git fetch origin
git rebase origin/main
# 冲突要逐项解决并重跑受影响检查，不允许 --force 覆盖主干。
git push origin HEAD:main
```

并发推进导致 non-fast-forward：重新 fetch/rebase，复核差异，重跑必要检查，再推；禁止 force push。rebase 后 SHA 会变，回执必须使用最终交付 SHA。squash 合并必须核实平台返回的 merge SHA 和补丁对应关系，不能拿旧 SHA 的祖先检查失败断言代码丢失。

## 远端验收与跨机器可见性

```bash
python3 "$SKILL_DIR/scripts/delivery.py" audit --repo "$REPO" --remote origin --base main --json
python3 "$SKILL_DIR/scripts/delivery.py" verify --repo "$REPO" --remote origin --base main
python3 "$SKILL_DIR/scripts/delivery.py" receipt --repo "$REPO" --remote origin --base main \
  --output /absolute/path/outside-repo/delivery-receipt.json
```

脚本检查所有登记 worktree；其他任务有未交付项时，全仓 verify 不会通过。回执忠实保留这些缺口，不能把生成回执等同于完成。判断当前任务时另行核实最终 SHA 在刷新后的目标主干中：

```bash
git fetch origin
git merge-base --is-ancestor "$DELIVERY_SHA" origin/main
```

从另一台机器验证用 `git fetch origin` 和相同 SHA/主干祖先检查。不要对另一机器的脏主检出自动 pull/rebase。Mac 能 fetch 到分支仅代表远端已保存，Mac 的 main 含该提交才是主干交付。部署另外记录运行版本；“线上已生效”不能替代“源码已交付”。

回执保存在仓库外，可通过已授权的 SSH/SCP 汇总到协调机器；它包含主机和本地路径，属于私有运维数据，不应上传公开 issue。公开工具不承担私有服务器发现和通知通道，也不隐式创建任何定时任务。

## 回收

先保存回执，再逐个确认 worktree 干净、HEAD 已是刷新后目标主干祖先、没有其他任务使用：

```bash
git worktree remove /verified/absolute/path/example-wt
git branch -d fix/example
```

路径必须人工或程序精确核对，不用 `rm -rf`、`--force` 或 `git clean`。仅见于服务器的提交和未跟踪文件先归属，不能为了“目录干净”删除。主干已合入但远端任务分支仍有保留标记、MR、发布或别人在使用时保留，不自动批量删分支。

## 完成回复

说明项目、交付 SHA、远端目标主干、检查结果、部署情况和未完成项。只有发布分支时写“已保存到分支，未合主干”；网络或鉴权失败写“未能核验远端”，绝不写“干净”。不要以“看起来是别人的 WIP”跳过归属核实。
