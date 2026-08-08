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

    This must agree exactly with what consumers do, or a name matches here and not there.
    Ready4Balfolk's StringNormalizer implements the same three rules.

    Apostrophes and hyphens have to be treated differently, and getting either wrong costs
    real matches:

    - An apostrophe joins a word, so it is removed. "Kost ar c'hoad" has to fold to
      "kost ar choad", which is what people type; turning it into a space gives
      "kost ar c hoad", which matches nothing.
    - A hyphen separates words, so it becomes a space. "Pilé-menu" has to fold to
      "pile menu"; removing it gives "pilemenu", which again matches nothing.
    """
    decomposed = unicodedata.normalize("NFD", value.strip().lower())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    joined = re.sub(r"['’ʼ´`]", "", stripped)
    spaced = "".join(c if c.isalnum() or c.isspace() else " " for c in joined)
    return re.sub(r"\s+", " ", spaced).strip()


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
    """The keys an entry is remembered by: every one of its names.

    A bare name is enough because check_names_are_unique guarantees no two dances share
    one. Dances and groups are kept in separate namespaces since a suite and a dance may
    legitimately be called the same thing.
    """
    return [f"{kind}:{fold(name)}" for name in entry["names"]]


def assign_slugs(
    entries: list[dict],
    kind: str,
    lock: dict[str, str],
    taken: set[str],
    assigned: dict[str, dict],
) -> None:
    """Give every entry a slug that never changes once it has one.

    The lock maps every key an entry has ever had to its slug, so renaming a dance,
    fixing an accent or reordering its spellings leaves consumers unaffected.

    `assigned` catches the one way that goes wrong: two entries whose names both hit the
    same lock key take the same slug, which would merge them into one dance in silence.
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

        if slug in assigned:
            print(
                f"dances.md: {entry['names'][0]!r} and {assigned[slug]['names'][0]!r} both "
                f"resolve to the slug {slug!r}. They share a name, so one of them needs a "
                "different one.",
                file=sys.stderr,
            )
            raise SystemExit(1)

        entry["slug"] = slug
        assigned[slug] = entry
        taken.add(slug)
        for key in keys:
            lock[key] = slug


def check_names_are_unique(dances: list[dict]) -> None:
    """A name belongs to exactly one dance, or the build fails.

    This is the guarantee the whole list rests on: a consumer that finds a name in a
    filename can resolve it to one dance without asking anybody anything. Where the same
    word really is used for several dances — "Ton doubl" is a different dance in each
    Breton suite — the entries carry the suite in the name to tell them apart.

    Enforced here rather than published as data, because ambiguity that ships is
    ambiguity every consumer has to model, forever.
    """
    # Keyed by position rather than by slug: two entries that collide hard enough end up
    # sharing a slug, and comparing slugs would then see one dance where there are two.
    seen: dict[str, list[int]] = {}
    display: dict[str, str] = {}

    for index, dance in enumerate(dances):
        for name in dance["names"]:
            key = fold(name)
            display.setdefault(key, name)
            entries = seen.setdefault(key, [])
            if index not in entries:
                entries.append(index)

    clashes = [(display[key], found) for key, found in sorted(seen.items()) if len(found) > 1]
    if not clashes:
        return

    for name, found in clashes:
        where = ", ".join(dances[i]["names"][0] for i in found)
        print(
            f"dances.md: the name {name!r} is used by {len(found)} dances ({where}). "
            "Qualify each one, for example with its suite.",
            file=sys.stderr,
        )
    raise SystemExit(1)


def main() -> int:
    if not SOURCE.exists():
        print(f"{SOURCE} not found", file=sys.stderr)
        return 1

    dances, groups = parse(SOURCE.read_text(encoding="utf-8"))

    if not dances:
        print("dances.md contains no dances", file=sys.stderr)
        return 1

    # Before any slug work: a duplicate name is a property of the markdown, and letting one
    # reach the lock writes a mapping that outlives the run that made it.
    check_names_are_unique(dances)

    lock: dict[str, str] = {}
    if LOCK.exists():
        lock = json.loads(LOCK.read_text(encoding="utf-8"))

    taken = set(lock.values())
    assigned: dict[str, dict] = {}
    # Groups first: a dance that has to be qualified needs its group's slug to exist.
    assign_slugs(groups, "group", lock, taken, assigned)
    assign_slugs(dances, "dance", lock, taken, assigned)

    for group in groups:
        group["dances"] = [d["slug"] for d in group["dances"]]

    document = {
        # Bumped only when the shape changes in a way that would break a consumer, so an
        # application embedding this file can refuse a version it does not understand.
        "formatVersion": 2,
        "dances": dances,
        "groups": groups,
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

    print(f"{len(dances)} dances, {len(groups)} groups")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
