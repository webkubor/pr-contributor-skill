#!/usr/bin/env python3
"""Standalone Git delivery evidence. Requires Python 3 and Git; no service CLI.

Audit exits 0 for a complete online observation (even when work is pending), 2
for unknown evidence. Verify/receipt exit 1 for pending work, 2 for unknown.
--no-fetch is diagnostic only and can never certify delivery. Ancestry tests
commit identity: squash/rebase equivalence requires separate human evidence.
No command stages, commits, pushes, resets, removes, or finishes worktrees.
"""

import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


class EvidenceError(Exception):
    pass


def git(repo, *args, optional=False):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    # Git output/errors can contain remote credentials. Never surface diagnostics.
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise EvidenceError("Git operation unavailable or timed out; diagnostics withheld") from None
    if result.returncode and not optional:
        raise EvidenceError("Git operation failed; diagnostics withheld to protect credentials")
    return result


def text(result):
    return result.stdout.decode("utf-8", "surrogateescape").strip()


def identity(raw):
    """Return only a validated host and repository path, never a remote URL."""
    try:
        if "://" in raw:
            parsed = urlsplit(raw)
            host, path = parsed.hostname, parsed.path
            if parsed.scheme == "file":
                return {"host": "local", "repo": None}
        else:
            match = re.fullmatch(r"(?:[^/@:]+@)?([^/:]+):(.+)", raw)
            if not match:
                return {"host": "local", "repo": None}
            host, path = match.groups()
        path = path.strip("/")
        if path.endswith(".git"):
            path = path[:-4]
        if not host or not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            return {"host": "unknown", "repo": None}
        if not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+", path):
            path = None
        return {"host": host, "repo": path}
    except ValueError:
        return {"host": "unknown", "repo": None}


def worktree_records(raw):
    """Parse NUL fields and empty record delimiters; preserve literal newlines."""
    records, current = [], {}
    for field in raw.decode("utf-8", "surrogateescape").split("\0"):
        if not field:
            if current:
                records.append(current)
                current = {}
            continue
        key, _, value = field.partition(" ")
        current[key] = value if value else True
    if current:
        records.append(current)
    return records


def status_counts(raw):
    fields = raw.split(b"\0")
    tracked = untracked = 0
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if not entry:
            continue
        code = entry[:2]
        if code == b"??":
            untracked += 1
        else:
            tracked += 1
            if b"R" in code or b"C" in code:
                index += 1  # porcelain -z rename/copy includes a second pathname
    return {"tracked_changes": tracked, "untracked": untracked,
            "clean": tracked == 0 and untracked == 0}


def ancestor(repo, head, base):
    result = git(repo, "merge-base", "--is-ancestor", head, base, optional=True)
    if result.returncode not in (0, 1):
        raise EvidenceError("Ancestry could not be determined")
    return result.returncode == 0


def audit(args):
    report = {"schema_version": 1, "timestamp": datetime.datetime.now(
        datetime.timezone.utc).isoformat(), "phase": "unknown", "remote": None,
        "host": "unknown", "repo": None, "branch": None, "head": None,
        "base": None, "remote_head": None,
        "checks": {"fresh_fetch": False, "all_clean": False,
                   "all_heads_in_base": False}, "worktrees": [], "errors": []}
    repo = Path(args.repo).resolve()
    try:
        # A remote must be a configured name, never an arbitrary URL or option.
        names = text(git(repo, "remote")).splitlines()
        if args.remote not in names or not re.fullmatch(r"[A-Za-z0-9_.-]+", args.remote) or args.remote.startswith("-"):
            raise EvidenceError("Select an existing named remote")
        report["remote"] = args.remote
        report.update(identity(text(git(repo, "remote", "get-url", args.remote))))
        root_head = git(repo, "rev-parse", "--verify", "HEAD^{commit}", optional=True)
        report["head"] = text(root_head) if not root_head.returncode else None
        root_branch = git(repo, "symbolic-ref", "--quiet", "--short", "HEAD", optional=True)
        report["branch"] = text(root_branch) if not root_branch.returncode else None
        records = worktree_records(git(repo, "worktree", "list", "--porcelain", "-z").stdout)
        remote_prefix = "refs/remotes/" + args.remote + "/"
        base = args.base
        if base:
            if base.startswith(remote_prefix):
                base = base[len(remote_prefix):]
            elif base.startswith(args.remote + "/"):
                base = base[len(args.remote) + 1:]
            elif base.startswith("refs/heads/"):
                base = base[len("refs/heads/"):]
            if git(repo, "check-ref-format", "refs/heads/" + base, optional=True).returncode:
                raise EvidenceError("Invalid base branch")
        fresh_error = None
        if args.fetch:
            try:
                git(repo, "fetch", "--prune", "--no-tags", "--", args.remote,
                    "+refs/heads/*:" + remote_prefix + "*")
                report["checks"]["fresh_fetch"] = True
                if not base:
                    symbolic = text(git(repo, "ls-remote", "--symref", "--", args.remote, "HEAD"))
                    for line in symbolic.splitlines():
                        if line.startswith("ref: refs/heads/") and line.endswith("\tHEAD"):
                            base = line[len("ref: refs/heads/"):].split("\t", 1)[0]
                            break
            except EvidenceError:
                fresh_error = "Remote refresh failed; delivery unknown (credential diagnostics withheld)"
                report["checks"]["fresh_fetch"] = False
        else:
            fresh_error = "Fetch disabled; cached refs cannot certify delivery"
        base = base or "main"
        report["base"] = base
        base_ref = remote_prefix + base
        resolved = git(repo, "rev-parse", "--verify", base_ref + "^{commit}", optional=True)
        if not resolved.returncode:
            report["remote_head"] = text(resolved)
        elif fresh_error is None:
            fresh_error = "Remote base branch unavailable; delivery unknown"
        if text(git(repo, "rev-parse", "--is-shallow-repository")) == "true":
            fresh_error = "Shallow history cannot certify complete ancestry"
        refs = text(git(repo, "for-each-ref", "--format=%(refname)", remote_prefix)).splitlines()
        refs = [ref for ref in refs if ref != remote_prefix + "HEAD"]
        for record in records:
            item = {"path": record["worktree"], "branch": None,
                    "detached": "detached" in record, "head": record.get("HEAD"),
                    "upstream": None, "phase": "unknown", "bare": "bare" in record}
            report["worktrees"].append(item)
            if item["bare"]:
                continue
            try:
                location = item["path"]
                item["branch"] = record.get("branch", "").removeprefix("refs/heads/") or None
                head = text(git(location, "rev-parse", "--verify", "HEAD^{commit}"))
                item["head"] = head
                item["status"] = status_counts(git(location, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none").stdout)
                upstream = git(location, "rev-parse", "--symbolic-full-name", "@{upstream}", optional=True)
                item["upstream"] = text(upstream) if not upstream.returncode else None
                if fresh_error:
                    continue
                item["head_in_base"] = ancestor(repo, head, report["remote_head"])
                unpublished = text(git(repo, "rev-list", head, "--not", *refs)).splitlines()
                item["commits_not_on_remote"] = unpublished
                item["remote_commit_scope"] = args.remote
                item["phase"] = ("dirty" if not item["status"]["clean"] else
                                 "main-delivered" if item["head_in_base"] else
                                 "local-only" if unpublished else "published-branch")
            except EvidenceError as exc:
                item["error"] = str(exc)
        if fresh_error:
            report["errors"].append(fresh_error)
        active = [item for item in report["worktrees"] if not item["bare"]]
        report["checks"]["all_clean"] = bool(active) and all(item.get("status", {}).get("clean", False) for item in active)
        report["checks"]["all_heads_in_base"] = bool(active) and all(item.get("head_in_base", False) for item in active)
        phases = {item["phase"] for item in active}
        if not active:
            report["errors"].append("No non-bare worktree to verify")
        if not report["errors"] and "unknown" not in phases:
            report["phase"] = next(phase for phase in ("dirty", "local-only", "published-branch", "main-delivered") if phase in phases)
    except EvidenceError as exc:
        report["errors"].append(str(exc))
    report["verified"] = report["phase"] == "main-delivered" and all(report["checks"].values())
    return report


def atomic_receipt(output, report):
    target = Path(output).absolute()
    descriptor, temporary = tempfile.mkstemp(prefix=".delivery-", suffix=".json", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(report, stream, indent=2, ensure_ascii=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("audit", "verify", "receipt", "create"):
        sub = commands.add_parser(command)
        sub.add_argument("--repo", required=True)
        sub.add_argument("--remote", default="origin")
        sub.add_argument("--base", help="Remote branch; default live remote HEAD, then main")
        sub.add_argument("--fetch", action=argparse.BooleanOptionalAction, default=True)
        sub.add_argument("--format", choices=("json", "text"), default="text")
        sub.add_argument("--json", action="store_true", help="Alias for --format json")
        if command == "receipt":
            sub.add_argument("--output", required=True)
        if command == "create":
            sub.add_argument("--path", required=True)
            sub.add_argument("--branch", required=True)
            sub.add_argument("--start-point", help="Explicit existing local commit/ref; default refreshed remote base")
    args = parser.parse_args(argv)
    report = audit(args)
    if args.command == "create":
        try:
            if report["phase"] == "unknown":
                raise EvidenceError("Creation requires fresh remote evidence")
            if git(args.repo, "check-ref-format", "--branch", args.branch, optional=True).returncode or args.branch.startswith("-"):
                raise EvidenceError("Invalid new branch name")
            destination = Path(args.path).absolute()
            if destination.exists():
                raise EvidenceError("Destination already exists; choose a new explicit path")
            start = args.start_point or report["remote_head"]
            oid = text(git(args.repo, "rev-parse", "--verify", "--end-of-options", start + "^{commit}"))
            git(args.repo, "worktree", "add", "-b", args.branch, "--", str(destination), oid)
            report["created"] = {"path": str(destination), "branch": args.branch, "head": oid}
        except EvidenceError as exc:
            report["phase"] = "unknown"
            report["verified"] = False
            report["errors"].append(str(exc))
    if args.command == "receipt":
        try:
            # A failed receipt is useful evidence too; verified remains false.
            atomic_receipt(args.output, report)
        except OSError:
            report["phase"] = "unknown"
            report["verified"] = False
            report["errors"].append("Receipt output failed; filesystem diagnostics withheld")
    if args.json or args.format == "json":
        print(json.dumps(report, indent=2, ensure_ascii=True))
    else:
        print("Delivery: " + report["phase"])
        print("Fresh remote evidence: " + str(report["checks"]["fresh_fetch"]))
        for item in report["worktrees"]:
            print(json.dumps({key: item.get(key) for key in ("path", "phase", "branch", "detached", "head", "upstream", "status", "head_in_base", "commits_not_on_remote", "error")}, ensure_ascii=True))
        for error in report["errors"]:
            print(error)
    if report["phase"] == "unknown":
        return 2
    if args.command in ("verify", "receipt") and not report["verified"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
