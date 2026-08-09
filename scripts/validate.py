#!/usr/bin/env python3
"""Check dances.json, and write it back in the one shape the repository accepts.

Nothing generates the list any more: dances.json is the source, edited through the site or
by hand. This script only ever says yes or no, except with --fix, which reformats.

Run it however you like:

    python3 scripts/validate.py                     check
    python3 scripts/validate.py --fix               reformat in place
    python3 scripts/validate.py --baseline old.json also check no slug went missing

The formatting is not decoration. Everyone edits this single file, so a stray reindent turns
every pull request into a whole-file conflict. One dance per line, sorted by slug, keeps a
conflict down to the dances two people actually both touched.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DANCES = ROOT / "dances.json"

FORMAT_VERSION = 3
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def fold(value: str) -> str:
    """Normalise a name for comparison: no accents, no case, no punctuation.

    This must agree exactly with what consumers do, or a name matches here and not there.
    site/fold.js implements the same three rules for the browser, and every consumer of the
    list implements them again; they all have to stay in step.

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


def render(data: dict) -> str:
    """The canonical text of the file. One dance per line, one tag per line, sorted."""
    tags = sorted(set(data.get("tags", [])))
    dances = sorted(data.get("dances", []), key=lambda d: d["slug"])

    lines = ["{", f'  "formatVersion": {FORMAT_VERSION},', '  "tags": [']
    lines += [f"    {json.dumps(t, ensure_ascii=False)}," for t in tags[:-1]]
    if tags:
        lines.append(f"    {json.dumps(tags[-1], ensure_ascii=False)}")
    lines.append("  ],")
    lines.append('  "dances": [')

    for index, dance in enumerate(dances):
        entry = {
            "slug": dance["slug"],
            "names": list(dance["names"]),
            "tags": sorted(set(dance.get("tags", []))),
        }
        comma = "" if index == len(dances) - 1 else ","
        lines.append("    " + json.dumps(entry, ensure_ascii=False) + comma)

    lines.append("  ]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def check(data: dict, text: str, baseline: dict | None) -> list[str]:
    problems: list[str] = []
    say = problems.append

    if data.get("formatVersion") != FORMAT_VERSION:
        say(f"formatVersion must be {FORMAT_VERSION}, found {data.get('formatVersion')!r}")

    tags = data.get("tags")
    dances = data.get("dances")

    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        return problems + ['"tags" must be a list of strings']
    if not isinstance(dances, list):
        return problems + ['"dances" must be a list']

    for tag in tags:
        if not SLUG.match(tag):
            say(f"tag {tag!r} is not lowercase words joined by single hyphens")
    for tag in sorted({t for t in tags if tags.count(t) > 1}):
        say(f"tag {tag!r} is listed twice")

    known = set(tags)
    seen_slugs: dict[str, int] = {}
    owner: dict[str, str] = {}

    for dance in dances:
        slug = dance.get("slug")
        names = dance.get("names")

        if not isinstance(slug, str) or not SLUG.match(slug or ""):
            say(f"a dance has an unusable slug: {slug!r}")
            continue
        if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.strip() for n in names):
            say(f"{slug}: names must be a non-empty list of non-empty strings")
            continue

        seen_slugs[slug] = seen_slugs.get(slug, 0) + 1

        for name in names:
            key = fold(name)
            if not key:
                say(f"{slug}: the name {name!r} is empty once punctuation is ignored")
                continue
            # The rule the whole list rests on: a consumer that finds a name in a filename
            # must land on exactly one dance and never have to model ambiguity.
            if key in owner and owner[key] != slug:
                say(
                    f"the name {name!r} belongs to both {owner[key]} and {slug}. "
                    f"Qualify one of them, the way Ton doubl carries its suite."
                )
            owner.setdefault(key, slug)

        for tag in dance.get("tags", []):
            if tag not in known:
                say(f"{slug}: carries the tag {tag!r}, which is not in the tags list")

    for slug, count in sorted(seen_slugs.items()):
        if count > 1:
            say(f"the slug {slug!r} is used by {count} dances")

    if baseline is not None:
        gone = {d["slug"] for d in baseline.get("dances", [])} - seen_slugs.keys()
        for slug in sorted(gone):
            say(
                f"the slug {slug!r} has disappeared. A slug is permanent: anything that "
                f"stored it would break. Keep the dance and change its names instead."
            )

    if text != render(data):
        say("the file is not in its canonical shape. Run: python3 scripts/validate.py --fix")

    return problems


def load(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text), text
    except json.JSONDecodeError as error:
        print(f"{path.name}:{error.lineno}: {error.msg}", file=sys.stderr)
        raise SystemExit(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true", help="write the file back in canonical shape")
    parser.add_argument("--baseline", type=Path, help="a previous dances.json, to catch a removed slug")
    parser.add_argument("--file", type=Path, default=DANCES)
    args = parser.parse_args()

    data, text = load(args.file)

    if args.fix:
        canonical = render(data)
        if canonical != text:
            args.file.write_text(canonical, encoding="utf-8")
            print(f"{args.file.name}: reformatted")
        else:
            print(f"{args.file.name}: already canonical")
        text = canonical

    baseline = load(args.baseline)[0] if args.baseline else None
    problems = check(data, text, baseline)

    if problems:
        for problem in problems:
            print(f"{args.file.name}: {problem}", file=sys.stderr)
        return 1

    print(f"{args.file.name}: {len(data['dances'])} dances, {len(data['tags'])} tags, all good")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
