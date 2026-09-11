#!/usr/bin/env python3
"""Fail if tracked UTF-8 files contain invisible Unicode.

Default: scan git ls-files from the worktree. Pass --staged to scan
index blobs (git show :path) for the ACMR cached diff instead.

Banned ranges (no path or context exemptions):
- Zero-width: U+200B-200F, U+00AD, U+FEFF, U+2060
- Variation selectors: U+FE00-FE0F, U+E0100-E01EF
- Bidi overrides/isolates: U+202A-202E, U+2066-2069
- Unicode tags: U+E0000-E007F

Visible typographic spaces such as U+202F and U+00A0 are allowed.
Non-UTF-8 or NUL-containing files are skipped so compressed binaries
are not scanned as text. That is not a docs/locale exemption.
"""

from __future__ import print_function

import os
import re
import subprocess
import sys

FORBIDDEN = re.compile(
    "[\u200b-\u200f\u00ad\ufeff\u2060"
    "\ufe00-\ufe0f"
    "\u202a-\u202e\u2066-\u2069"
    "\U000e0100-\U000e01ef"
    "\U000e0000-\U000e007f]"
)


def repo_root():
    return subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"],
        text=True,
    ).strip()


def nul_split_paths(raw):
    for chunk in raw.split(b"\0"):
        if chunk:
            yield chunk.decode("utf-8", "surrogateescape")


def tracked_files(root):
    raw = subprocess.check_output(
        ["git", "-C", root, "ls-files", "-z"],
    )
    return nul_split_paths(raw)


def staged_files(root):
    raw = subprocess.check_output(
        ["git", "-C", root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    )
    return nul_split_paths(raw)


def format_codepoint(cp):
    return "U+%04X" % cp if cp <= 0xFFFF else "U+%06X" % cp


def scan_bytes(relpath, data):
    if b"\x00" in data[:8192]:
        return []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return []

    hits = []
    for line_no, line in enumerate(text.splitlines(), 1):
        for match in FORBIDDEN.finditer(line):
            cp = ord(match.group(0))
            col = match.start() + 1
            hits.append((relpath, line_no, col, format_codepoint(cp)))
    return hits


def scan_file(root, relpath):
    full = os.path.join(root, relpath)
    try:
        with open(full, "rb") as handle:
            data = handle.read()
    except OSError as exc:
        print("%s: failed to read: %s" % (relpath, exc), file=sys.stderr)
        return None
    return scan_bytes(relpath, data)


def scan_staged(root, relpath):
    try:
        data = subprocess.check_output(
            ["git", "-C", root, "show", ":%s" % relpath],
        )
    except subprocess.CalledProcessError as exc:
        print("%s: failed to read staged blob: %s" % (relpath, exc), file=sys.stderr)
        return None
    return scan_bytes(relpath, data)


def main():
    staged = "--staged" in sys.argv[1:]
    root = repo_root()
    hits = []
    paths = staged_files(root) if staged else tracked_files(root)
    scan = scan_staged if staged else scan_file
    for relpath in paths:
        found = scan(root, relpath)
        if found is None:
            return 1
        hits.extend(found)

    for path, line_no, col, code in hits:
        print("%s:%d:%d %s" % (path, line_no, col, code), file=sys.stderr)
        print(
            "::error file=%s,line=%d,col=%d::invisible Unicode %s"
            % (path, line_no, col, code)
        )

    if hits:
        print(
            "invisible Unicode check failed: %d hit(s)" % len(hits),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
