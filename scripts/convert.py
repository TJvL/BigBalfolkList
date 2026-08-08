#!/usr/bin/env python3
"""Turn dances.md into dances.json, keeping every slug stable.

Nobody is expected to run this by hand. CI runs it on every push to main and commits
the result, so contributors only ever edit the markdown.

The format, in full:

    ## Region                     a region or tradition; every dance sits under one
    ### Family or suite {tags}    optional grouping, with optional tags
    - Name / Other name {tags}    a dance; names separated by "/" are equals

A group tagged {suite} means its dances are performed as a sequence rather than merely
grouped together. Group tags other than "suite" are inherited by the dances inside it.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "dances.md"
OUTPUT = ROOT / "dances.json"
LOCK = ROOT / "slugs.lock.json"

TAGS = re.compile(r"\{([^}]*)\}")


def fold(value: str) -> str:
    """Normalise a name for comparison: no accents, no case, no punctuation.

    The same folding the consumers use when matching a filename against the list, so
    "Kost ar c'hoad" and "kost ar choad" are one key.
    """
    decomposed = unicodedata.normalize("NFD", value.strip().lower())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", stripped).strip()


def slugify(value: str) -> str:
    return re.sub(r"\s+", "-", fold(value))


def split_tags(text: str) -> tuple[str, list[str]]:
    """Pull a trailing {a, b} off a line, returning the rest and the tags."""
    tags: list[str] = []

    def take(match: re.Match[str]) -> str:
        tags.extend(t.strip() for t in match.group(1).split(",") if t.strip())
        return ""

    return TAGS.sub(take, text).strip(), tags


def split_names(text: str) -> list[str]:
    """Names are separated by "/" and are equals; none of them is the correct one."""
    return [n.strip() for n in text.split("/") if n.strip()]


def parse(markdown: str) -> tuple[list[dict], list[dict]]:
    dances: list[dict] = []
    groups: list[dict] = []

    region: str | None = None
    group: dict | None = None
    body = False

    for number, raw in enumerate(markdown.splitlines(), start=1):
        line = raw.rstrip()

        # Everything above the first horizontal rule is instructions for humans, and it
        # contains bullet points of its own.
        if not body:
            body = line.strip() == "---"
            continue

        if line.startswith("## "):
            region = line[3:].strip()
            group = None
            continue

        if line.startswith("### "):
            if region is None:
                fail(number, "a family or suite appears before any region heading")
            text, tags = split_tags(line[4:])
            names = split_names(text)
            if not names:
                fail(number, "a family or suite has no name")
            group = {
                "slug": "",
                "names": names,
                "kind": "suite" if "suite" in tags else "family",
                "region": region,
                "tags": [t for t in tags if t != "suite"],
                "dances": [],
            }
            groups.append(group)
            continue

        if line.startswith("- "):
            if region is None:
                fail(number, "a dance appears before any region heading")
            text, tags = split_tags(line[2:])
            names = split_names(text)
            if not names:
                fail(number, "a dance has no name")

            dance = {
                "slug": "",
                "names": names,
                "region": region,
                "family": None,
                "suite": None,
                "tags": sorted(set(tags + (group["tags"] if group else []))),
            }

            if group is not None:
                key = "suite" if group["kind"] == "suite" else "family"
                dance[key] = group["names"][0]
                group["dances"].append(dance)

            dances.append(dance)
            continue

    return dances, groups


def fail(line: int, message: str) -> None:
    print(f"dances.md:{line}: {message}", file=sys.stderr)
    raise SystemExit(1)


def lock_keys(entry: dict, kind: str) -> list[str]:
    """The keys an entry is remembered by.

    Scoped by its group, because a name is only unique inside its context: each Breton
    suite has its own "Ton doubl" and they are three different dances. Keying on the bare
    name would silently merge them into one.
    """
    context = entry.get("suite") or entry.get("family") if kind == "dance" else None
    prefix = f"{kind}:{fold(context)}:" if context else f"{kind}:"
    return [prefix + fold(name) for name in entry["names"]]


def assign_slugs(entries: list[dict], kind: str, lock: dict[str, str], taken: set[str]) -> None:
    """Give every entry a slug that never changes once it has one.

    The lock maps every key an entry has ever had to its slug, so renaming a dance,
    fixing an accent or reordering its spellings leaves consumers unaffected.
    """
    for entry in entries:
        keys = lock_keys(entry, kind)
        slug = next((lock[key] for key in keys if key in lock), None)

        if slug is None:
            base = slugify(entry["names"][0])
            slug = base

            # A clash is usually a name that means something different in another suite,
            # so qualify with the group before falling back to counting.
            if slug in taken:
                context = entry.get("suite") or entry.get("family")
                if context:
                    slug = f"{base}-{slugify(context)}"

            suffix = 2
            while slug in taken:
                slug = f"{base}-{suffix}"
                suffix += 1

        entry["slug"] = slug
        taken.add(slug)
        for key in keys:
            lock[key] = slug


def find_ambiguous(dances: list[dict]) -> list[dict]:
    """Names that belong to more than one dance.

    These are real rather than mistakes: "Ton doubl" is a different dance in each Breton
    suite. A consumer matching a filename cannot tell which one is meant, so the name is
    published as ambiguous and callers should treat a hit as "some dance in this set".
    """
    seen: dict[str, list[str]] = {}
    display: dict[str, str] = {}

    for dance in dances:
        for name in dance["names"]:
            key = fold(name)
            display.setdefault(key, name)
            slugs = seen.setdefault(key, [])
            if dance["slug"] not in slugs:
                slugs.append(dance["slug"])

    return [
        {"name": display[key], "dances": slugs}
        for key, slugs in sorted(seen.items())
        if len(slugs) > 1
    ]


def main() -> int:
    if not SOURCE.exists():
        print(f"{SOURCE} not found", file=sys.stderr)
        return 1

    dances, groups = parse(SOURCE.read_text(encoding="utf-8"))

    if not dances:
        print("dances.md contains no dances", file=sys.stderr)
        return 1

    lock: dict[str, str] = {}
    if LOCK.exists():
        lock = json.loads(LOCK.read_text(encoding="utf-8"))

    taken = set(lock.values())
    # Groups first: a dance that has to be qualified needs its group's slug to exist.
    assign_slugs(groups, "group", lock, taken)
    assign_slugs(dances, "dance", lock, taken)

    for group in groups:
        group["dances"] = [d["slug"] for d in group["dances"]]

    ambiguous = find_ambiguous(dances)

    document = {
        "dances": dances,
        "groups": groups,
        "ambiguousNames": ambiguous,
    }

    # No timestamp anywhere on purpose: a generated file that changes on every run would
    # produce a commit on every run.
    OUTPUT.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    LOCK.write_text(
        json.dumps(dict(sorted(lock.items())), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"{len(dances)} dances, {len(groups)} groups, {len(ambiguous)} ambiguous names")
    for entry in ambiguous:
        print(f"  ambiguous: {entry['name']} -> {', '.join(entry['dances'])}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
