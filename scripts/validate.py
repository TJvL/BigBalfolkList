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

FORMAT_VERSION = 4
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
WORD = re.compile(r"^[a-z0-9]+$")
NUMBER = re.compile(r"^[0-9]+$")


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


def match_key(value: str, ignored: set[str], numbers: dict[str, str]) -> str:
    """What two names have to share to be the same name.

    Folding alone leaves the list carrying the same name several times over, because the
    difference between "Bourrée à 3 temps", "Bourrée in 3", "Bourrée 3t" and "Bourrée 3" is
    grammar and shorthand, not a different dance. So after folding:

    - a word that spells a number becomes the number, "trois" and "3t" both giving "3";
    - a word that is only glue is dropped.

    Both word lists live in dances.json rather than here, because they grow with every
    language somebody adds a name in, and a consumer that ships the file then gets the new
    words with it instead of having to ship code. Neither list may hold a word that is part
    of a dance's name: the check that a name belongs to exactly one dance runs on this key,
    so a word that does not belong fails the build and says which dances it collapsed.

    Slugs are not built from this. They come from fold(), so no slug moves when a word is
    added here.
    """
    tokens = [numbers.get(token, token) for token in fold(value).split()]
    kept = [token for token in tokens if token not in ignored]
    # A name made of nothing but glue keeps its folded form, rather than becoming empty and
    # colliding with every other such name.
    return " ".join(kept) or fold(value)


def word_lists(data: dict) -> tuple[set[str], dict[str, str]]:
    ignored = data.get("ignoredWords")
    numbers = data.get("numberWords")
    ignored = set(ignored) if isinstance(ignored, list) else set()
    numbers = dict(numbers) if isinstance(numbers, dict) else {}
    return ignored, numbers


def render(data: dict) -> str:
    """The canonical text of the file. One dance per line, one tag per line, sorted."""
    tags = sorted(set(data.get("tags", [])))
    dances = sorted(data.get("dances", []), key=lambda d: d["slug"])
    ignored, numbers = word_lists(data)

    def rows(values: list[str]) -> list[str]:
        """One value per line, the last without a comma. Same reason as one dance per line."""
        return [f"    {v}," for v in values[:-1]] + ([f"    {values[-1]}"] if values else [])

    lines = ["{", f'  "formatVersion": {FORMAT_VERSION},', '  "ignoredWords": [']
    lines += rows([json.dumps(w, ensure_ascii=False) for w in sorted(ignored)])
    lines.append("  ],")
    lines.append('  "numberWords": {')
    lines += rows(
        [f"{json.dumps(w, ensure_ascii=False)}: {json.dumps(numbers[w], ensure_ascii=False)}"
         for w in sorted(numbers)]
    )
    lines.append("  },")
    lines.append('  "tags": [')
    lines += rows([json.dumps(t, ensure_ascii=False) for t in tags])
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
    if not isinstance(data.get("ignoredWords"), list) or not all(
        isinstance(w, str) for w in data["ignoredWords"]
    ):
        return problems + ['"ignoredWords" must be a list of strings']
    if not isinstance(data.get("numberWords"), dict) or not all(
        isinstance(w, str) and isinstance(v, str) for w, v in data["numberWords"].items()
    ):
        return problems + ['"numberWords" must map strings to strings']

    ignored, numbers = word_lists(data)

    for word in sorted(ignored):
        if not WORD.match(word):
            say(f"ignored word {word!r} is not a single lowercase word without accents")
    for word in sorted({w for w in data["ignoredWords"] if data["ignoredWords"].count(w) > 1}):
        say(f"ignored word {word!r} is listed twice")
    for word, number in sorted(numbers.items()):
        if not WORD.match(word):
            say(f"number word {word!r} is not a single lowercase word without accents")
        if not NUMBER.match(number):
            say(f"the number word {word!r} must give digits, not {number!r}")
        if word in ignored:
            say(f"the word {word!r} is both ignored and a number; it cannot be both")

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

        mine: dict[str, str] = {}

        for name in names:
            key = match_key(name, ignored, numbers)
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
            # Within one dance the same collision is not ambiguity, it is clutter: two
            # spellings the list cannot tell apart, which is the thing the word lists exist
            # to stop being written out by hand.
            if key in mine and mine[key] != name:
                say(
                    f"{slug}: {name!r} and {mine[key]!r} are the same name once the word "
                    f"lists are applied. Keep one of them."
                )
            owner.setdefault(key, slug)
            mine.setdefault(key, name)

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
    parser.add_argument(
        "--keys",
        action="store_true",
        help="print every name with its folded form and match key, for scripts/check_fold.mjs",
    )
    args = parser.parse_args()

    data, text = load(args.file)

    if args.keys:
        ignored, numbers = word_lists(data)
        keys = {
            name: [fold(name), match_key(name, ignored, numbers)]
            for dance in data["dances"]
            for name in dance["names"]
        }
        print(json.dumps(keys, ensure_ascii=False, sort_keys=True))
        return 0

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
