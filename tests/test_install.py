"""Installer integration tests: every mutation uses an isolated temporary HOME."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("install_skill", REPO / "scripts/install_skill.py")
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = dict(os.environ, HOME=str(self.home), PYTHONDONTWRITEBYTECODE="1")

    def run_cli(self, *args, success=True):
        result = subprocess.run(["bash", str(REPO / "install.sh"), *args], env=self.env, text=True, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def backups(self):
        root = self.home / ".local/state/pr-contributor/install-backups"
        return sorted(root.iterdir()) if root.exists() else []

    def test_list_is_read_only_and_unknown_target_fails_closed(self):
        (self.home / ".hermes/profiles/work").mkdir(parents=True)
        result = self.run_cli("--list", "--target", "hermes")
        self.assertIn("hermes:work", result.stdout)
        self.assertFalse((self.home / ".hermes/skills").exists())
        self.assertFalse((self.home / ".hermes/profiles/work/skills").exists())
        self.run_cli("--target", "typo", success=False)
        self.run_cli("--target", success=False)
        self.run_cli("--skills-dir", "relative/skills", success=False)
        self.assertFalse(self.backups())

    def test_existing_frameworks_and_hermes_profiles_duplicate_install(self):
        for relative in installer.FRAMEWORKS.values():
            if relative != ".hermes/skills":
                (self.home / relative).mkdir(parents=True)
        for profile in ("work", "personal"):
            (self.home / f".hermes/profiles/{profile}").mkdir(parents=True)
        (self.home / ".hermes/profiles/not-a-profile").write_text("file")
        self.run_cli()
        paths = [self.home / relative / "pr-contributor" for relative in installer.FRAMEWORKS.values()]
        paths += [self.home / f".hermes/profiles/{profile}/skills/pr-contributor" for profile in ("work", "personal")]
        for path in paths:
            self.assertTrue(path.is_symlink(), str(path))
            self.assertEqual(path.resolve(), REPO)
        self.run_cli()
        self.assertEqual(self.backups(), [])
        self.run_cli("--uninstall")
        self.run_cli("--uninstall")
        for path in paths:
            self.assertFalse(path.is_symlink())

    def test_no_phantom_hermes_home_or_profile_created(self):
        self.run_cli("--target", "hermes")
        self.assertFalse((self.home / ".hermes").exists())

    def test_explicit_alternate_home_overrides_discovery(self):
        (self.home / ".hermes/profiles/work").mkdir(parents=True)
        alternate = self.home / "actual-home/skills"
        self.run_cli("--target", "hermes", "--skills-dir", str(alternate))
        self.assertTrue((alternate / "pr-contributor").is_symlink())
        self.assertFalse((self.home / ".hermes/skills").exists())
        self.run_cli("--skills-dir", str(alternate), "--uninstall")
        self.assertFalse((alternate / "pr-contributor").exists())

    def test_copy_idempotency_git_exclusion_and_backup_preservation(self):
        skills = self.home / ".claude/skills"
        dest = skills / "pr-contributor"
        dest.mkdir(parents=True)
        (dest / "original.txt").write_text("keep me")
        args = ("--target", "claude", "--copy")
        self.run_cli(*args)
        self.assertFalse(dest.is_symlink())
        self.assertTrue((dest / "SKILL.md").is_file())
        self.assertFalse((dest / ".git").exists())
        self.assertEqual(len(self.backups()), 1)
        original = self.backups()[0]
        self.assertEqual((original / "original.txt").read_text(), "keep me")
        self.assertEqual(list(skills.iterdir()), [dest])
        self.run_cli(*args)
        self.assertEqual(len(self.backups()), 1)
        (dest / "local-note").write_text("user edit")
        self.run_cli(*args)
        self.assertEqual(len(self.backups()), 2)
        self.assertTrue(any((entry / "local-note").is_file() for entry in self.backups()))
        self.run_cli("--target", "claude", "--uninstall")
        self.assertFalse(dest.exists())
        self.assertEqual(len(self.backups()), 3)
        self.assertEqual((original / "original.txt").read_text(), "keep me")

    def test_uninstall_preserves_unrelated_link_and_directory(self):
        skills = self.home / ".codex/skills"
        dest = skills / "pr-contributor"
        dest.mkdir(parents=True)
        (dest / "user-file").write_text("untouched")
        self.run_cli("--target", "codex", "--uninstall", success=False)
        self.assertEqual((dest / "user-file").read_text(), "untouched")
        other = self.home / "other-skills"
        other.mkdir()
        link = self.home / "custom/pr-contributor"
        link.parent.mkdir()
        link.symlink_to(other)
        self.run_cli("--skills-dir", str(link.parent), "--uninstall", success=False)
        self.assertTrue(link.is_symlink())

    def test_refuses_source_or_nested_destination_even_on_uninstall(self):
        for action in ((), ("--copy",), ("--uninstall",)):
            self.run_cli("--skills-dir", str(REPO / "nested-skills"), *action, success=False)
        # Test an exact source collision with a fixture whose name matches it.
        source = self.home / "pr-contributor"
        source.mkdir()
        with patch.object(installer, "SOURCE", source):
            (source / "SKILL.md").write_text("---\nname: pr-contributor\n---\n")
            self.assertEqual(installer.main(["--skills-dir", str(self.home)]), 1)
        self.assertTrue((source / "SKILL.md").exists())

    def test_switch_between_link_and_copy_preserves_previous_install(self):
        skills = self.home / "skills"
        args = ("--skills-dir", str(skills))
        dest = skills / "pr-contributor"
        self.run_cli(*args)
        self.run_cli(*args, "--copy")
        self.assertFalse(dest.is_symlink())
        self.assertTrue(self.backups()[0].is_symlink())
        self.run_cli(*args)
        self.assertTrue(dest.is_symlink())
        self.assertEqual(len(self.backups()), 2)
        self.assertTrue(any((path / installer.MARKER).is_file() and not path.is_symlink() for path in self.backups()))

    def test_backup_location_cannot_resolve_inside_discovery(self):
        skills = self.home / ".hermes/profiles/work/skills"
        dest = skills / "pr-contributor"
        dest.mkdir(parents=True)
        (dest / "precious").write_text("keep")
        backup_root = self.home / ".local/state/pr-contributor/install-backups"
        backup_root.parent.mkdir(parents=True)
        backup_root.symlink_to(skills, target_is_directory=True)
        self.run_cli("--target", "hermes", success=False)
        self.assertEqual((dest / "precious").read_text(), "keep")
        self.assertEqual(list(skills.iterdir()), [dest])

    def test_copy_failure_keeps_previous_install(self):
        skills = self.home / "skills"
        dest = skills / "pr-contributor"
        dest.mkdir(parents=True)
        (dest / "precious").write_text("keep")
        with patch.dict(os.environ, self.env), patch.object(installer.shutil, "copytree", side_effect=OSError("simulated copy failure")):
            self.assertEqual(installer.main(["--skills-dir", str(skills), "--copy"]), 1)
        self.assertEqual((dest / "precious").read_text(), "keep")
        self.assertEqual(self.backups(), [])
        self.assertEqual(list(skills.iterdir()), [dest])

    def test_backup_rename_failure_does_not_replace_existing_install(self):
        source = self.home / "source"
        source.mkdir()
        (source / "SKILL.md").write_text("---\nname: pr-contributor\n---\n")
        skills = self.home / "skills"
        dest = skills / "pr-contributor"
        dest.mkdir(parents=True)
        (dest / "precious").write_text("keep")
        real_rename = Path.rename
        def fail_backup(path, target):
            if path == dest:
                raise OSError("simulated backup rename failure")
            return real_rename(path, target)
        with patch.object(installer, "SOURCE", source), patch.dict(os.environ, self.env), patch.object(Path, "rename", fail_backup):
            self.assertEqual(installer.main(["--skills-dir", str(skills), "--copy"]), 1)
        self.assertEqual((dest / "precious").read_text(), "keep")
        self.assertFalse((dest / "SKILL.md").exists())
        self.assertEqual(list(skills.iterdir()), [dest])


if __name__ == "__main__":
    unittest.main()
