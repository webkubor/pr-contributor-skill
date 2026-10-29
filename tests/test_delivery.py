"""Integration tests use real isolated repositories, never network services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "delivery.py"
spec = importlib.util.spec_from_file_location("delivery", SCRIPT)
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "checkout"
        self.run_git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.run_git(self.root, "clone", str(self.remote), str(self.repo))
        self.run_git(self.repo, "config", "user.name", "Test Author")
        self.run_git(self.repo, "config", "user.email", "test@example.invalid")
        self.commit(self.repo, "initial")
        self.run_git(self.repo, "push", "-u", "origin", "main")

    def run_git(self, repo, *args):
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        result = subprocess.run(["git", "-C", str(repo), *args], env=env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def commit(self, repo, name):
        (repo / name).write_text(name)
        self.run_git(repo, "add", "--", name)
        self.run_git(repo, "commit", "-m", name)
        return self.run_git(repo, "rev-parse", "HEAD")

    def cli(self, command="audit", *args):
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)
        result = subprocess.run([sys.executable, str(SCRIPT), command,
                                 "--repo", str(self.repo), "--json", *args],
                                capture_output=True, text=True, env=env)
        self.assertEqual(result.stderr, "")
        return result.returncode, json.loads(result.stdout)

    def test_clean_ancestor_is_delivered_even_if_main_ahead(self):
        initial = self.run_git(self.repo, "rev-parse", "HEAD")
        self.commit(self.repo, "advance")
        self.run_git(self.repo, "push", "origin", "main")
        self.run_git(self.repo, "checkout", "--detach", initial)
        code, report = self.cli("verify")
        self.assertEqual(code, 0)
        self.assertTrue(report["verified"])
        self.assertTrue(report["worktrees"][0]["detached"])
        self.assertEqual(report["phase"], "main-delivered")

    def test_dirty_and_untracked_outside_root_worktree(self):
        outside = self.root / "elsewhere\nwith spaces"
        self.run_git(self.repo, "worktree", "add", "-b", "task", str(outside))
        (outside / "initial").write_text("changed")
        (outside / "untracked\nfile").write_text("new")
        code, report = self.cli("verify")
        self.assertEqual(code, 1)
        self.assertEqual(report["phase"], "dirty")
        item = next(w for w in report["worktrees"] if Path(w["path"]).resolve() == outside.resolve())
        self.assertEqual(item["status"], {"tracked_changes": 1, "untracked": 1, "clean": False})
        self.assertEqual(len(report["worktrees"]), 2)
        self.assertEqual((outside / "initial").read_text(), "changed")

    def test_local_only_then_published_then_merge_delivered(self):
        self.run_git(self.repo, "checkout", "-b", "feature")
        head = self.commit(self.repo, "feature")
        code, report = self.cli("verify")
        self.assertEqual(code, 1)
        self.assertEqual(report["phase"], "local-only")
        self.assertIn(head, report["worktrees"][0]["commits_not_on_remote"])
        self.run_git(self.repo, "push", "-u", "origin", "feature")
        code, report = self.cli("verify")
        self.assertEqual(code, 1)
        self.assertEqual(report["phase"], "published-branch")
        self.assertEqual(report["worktrees"][0]["commits_not_on_remote"], [])
        self.assertEqual(report["worktrees"][0]["upstream"], "refs/remotes/origin/feature")
        self.run_git(self.repo, "checkout", "main")
        self.commit(self.repo, "main-other")
        self.run_git(self.repo, "merge", "--no-ff", "feature", "-m", "merge")
        self.run_git(self.repo, "push", "origin", "main")
        self.run_git(self.repo, "checkout", "feature")
        code, report = self.cli("verify")
        self.assertEqual(code, 0)
        self.assertTrue(report["verified"])

    def test_divergence_is_not_claimed_commit_loss(self):
        self.run_git(self.repo, "checkout", "-b", "feature")
        self.commit(self.repo, "topic")
        self.run_git(self.repo, "push", "origin", "feature")
        self.run_git(self.repo, "checkout", "main")
        self.commit(self.repo, "main-other")
        self.run_git(self.repo, "push", "origin", "main")
        self.run_git(self.repo, "checkout", "feature")
        code, report = self.cli("verify")
        self.assertEqual(code, 1)
        self.assertEqual(report["phase"], "published-branch")
        self.assertEqual(report["worktrees"][0]["commits_not_on_remote"], [])
        self.assertNotIn("lost", json.dumps(report).lower())

    def test_fetch_failure_and_no_fetch_never_green(self):
        self.cli()
        self.run_git(self.repo, "remote", "set-url", "origin", str(self.root / "missing.git"))
        for args in ((), ("--no-fetch",)):
            code, report = self.cli("verify", *args)
            self.assertEqual(code, 2)
            self.assertEqual(report["phase"], "unknown")
            self.assertFalse(report["verified"])
            self.assertFalse(report["checks"]["fresh_fetch"])

    def test_secret_url_and_failure_diagnostics_are_withheld(self):
        raw = "https://alice:VERY_PRIVATE@example.invalid/team/repo.git?token=HIDDEN"
        self.run_git(self.repo, "remote", "set-url", "origin", raw)
        # Force a deterministic immediate transport failure, with credential URL in diagnostics.
        self.run_git(self.repo, "config", "protocol.https.allow", "never")
        code, report = self.cli("verify")
        self.assertEqual(code, 2)
        output = json.dumps(report)
        for secret in (raw, "alice", "VERY_PRIVATE", "HIDDEN", "https://"):
            self.assertNotIn(secret, output)
        self.assertEqual(report["host"], "example.invalid")
        self.assertEqual(report["repo"], "team/repo")

    def test_live_default_branch_discovery_and_explicit_base(self):
        self.run_git(self.repo, "branch", "-m", "trunk")
        self.run_git(self.repo, "push", "origin", "trunk")
        self.run_git(self.remote, "symbolic-ref", "HEAD", "refs/heads/trunk")
        code, report = self.cli("verify")
        self.assertEqual(code, 0)
        self.assertEqual(report["base"], "trunk")
        code, report = self.cli("verify", "--base", "main")
        self.assertEqual(code, 0)
        self.assertEqual(report["base"], "main")

    def test_receipt_atomic_json_and_failed_receipt(self):
        output = self.root / "receipt.json"
        code, report = self.cli("receipt", "--output", str(output))
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.read_text()), report)
        for key in ("host", "repo", "base", "remote_head", "timestamp", "checks"):
            self.assertIn(key, report)
        self.assertIn("head", report["worktrees"][0])
        (self.repo / "new").write_text("pending")
        code, report = self.cli("receipt", "--output", str(output))
        self.assertEqual(code, 1)
        self.assertFalse(json.loads(output.read_text())["verified"])
        self.assertEqual(list(self.root.glob(".delivery-*")), [])

    def test_safe_create_requires_explicit_new_path_and_branch(self):
        destination = self.root / "new worktree"
        code, report = self.cli("create", "--path", str(destination), "--branch", "new-task")
        self.assertEqual(code, 0)
        self.assertTrue((destination / ".git").is_file())
        self.assertEqual(self.run_git(destination, "branch", "--show-current"), "new-task")
        code, report = self.cli("create", "--path", str(destination), "--branch", "other")
        self.assertEqual(code, 2)
        self.assertTrue((destination / "initial").exists())

    def test_missing_base_unknown(self):
        code, report = self.cli("verify", "--base", "absent")
        self.assertEqual(code, 2)
        self.assertFalse(report["verified"])

    def test_deleted_remote_branch_is_not_publication_evidence(self):
        self.run_git(self.repo, "checkout", "-b", "temporary")
        self.commit(self.repo, "temporary")
        self.run_git(self.repo, "push", "origin", "temporary")
        self.run_git(self.remote, "update-ref", "-d", "refs/heads/temporary")
        code, report = self.cli("verify")
        self.assertEqual(code, 1)
        self.assertEqual(report["phase"], "local-only")

    def test_default_falls_back_main_when_remote_head_missing(self):
        self.run_git(self.remote, "symbolic-ref", "HEAD", "refs/heads/nonexistent")
        code, report = self.cli("verify")
        self.assertEqual(code, 0)
        self.assertEqual(report["base"], "main")

    def test_unborn_worktree_unknown_and_no_raw_remote_argument(self):
        unborn = self.root / "unborn"
        self.run_git(self.root, "init", "--initial-branch=main", str(unborn))
        self.run_git(unborn, "remote", "add", "origin", str(self.remote))
        original = self.repo
        self.repo = unborn
        code, report = self.cli("verify")
        self.assertEqual(code, 2)
        self.assertFalse(report["verified"])
        self.repo = original
        raw = "https://user:SECRET@example.invalid/team/repo"
        code, report = self.cli("audit", "--remote", raw)
        self.assertEqual(code, 2)
        self.assertNotIn("SECRET", json.dumps(report))

    def test_parsers_preserve_newlines_and_rename_pair(self):
        records = delivery.worktree_records(b"worktree /tmp/a\nb\0HEAD abc\0detached\0\0worktree /tmp/c\0bare\0\0")
        self.assertEqual(records[0]["worktree"], "/tmp/a\nb")
        self.assertTrue(records[1]["bare"])
        self.assertEqual(delivery.status_counts(b"R  new\0old\0?? x\0"),
                         {"tracked_changes": 1, "untracked": 1, "clean": False})


if __name__ == "__main__":
    unittest.main()
