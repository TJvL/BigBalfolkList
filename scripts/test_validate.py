#!/usr/bin/env python3
"""Tests for the validator. Run: python3 scripts/test_validate.py

No test framework on purpose: CI installs nothing, and a contributor who wants to run these
should not have to either.
"""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate import DANCES, check, fold, match_key, render, slugify  # noqa: E402


def sample(**overrides) -> dict:
    data = {
        "formatVersion": 4,
        "ignoredWords": ["a", "de", "in", "temps"],
        "numberWords": {"3t": "3", "trois": "3"},
        "tags": ["bretagne", "france"],
        "dances": [
            {"slug": "an-dro", "names": ["An dro", "Andro"], "tags": ["bretagne", "france"]},
            {"slug": "tour", "names": ["Tour"], "tags": ["bretagne", "france"]},
        ],
    }
    data.update(overrides)
    return data


def problems(data: dict, baseline: dict | None = None) -> list[str]:
    return check(data, render(data), baseline)


class Fold(unittest.TestCase):
    """The fold rule is shared with the site and with every consumer of the list. Each case
    here is a name that breaks if the rule drifts, so they are worth more than they look."""

    def test_apostrophe_joins_a_word(self):
        self.assertEqual(fold("Kost ar c'hoad"), "kost ar choad")
        self.assertEqual(fold("Rond de l'Île d'Yeu"), "rond de lile dyeu")

    def test_every_other_mark_separates(self):
        self.assertEqual(fold("Pilé-menu"), "pile menu")
        self.assertEqual(fold("Ton doubl (montagne)"), "ton doubl montagne")

    def test_accents_and_case_are_ignored(self):
        self.assertEqual(fold("Valse à 3 temps"), "valse a 3 temps")
        self.assertEqual(fold("Dañs fisel"), "dans fisel")

    def test_slugify_follows_the_same_rule(self):
        self.assertEqual(slugify("Kost ar c'hoad"), "kost-ar-choad")
        self.assertEqual(slugify("Pilé-menu"), "pile-menu")


class MatchKey(unittest.TestCase):
    """The key two names have to share to be the same name. site/fold.js implements it too,
    and a name matches in one place and not the other the moment they disagree."""

    IGNORED = {"a", "de", "in", "temps"}
    NUMBERS = {"trois": "3", "3t": "3"}

    def key(self, value: str) -> str:
        return match_key(value, self.IGNORED, self.NUMBERS)

    def test_glue_and_shorthand_give_one_name(self):
        for spelling in ["Bourrée 3 temps", "Bourrée à 3 temps", "Bourrée in 3", "Bourrée 3t",
                         "Bourrée à trois temps", "Bourrée 3"]:
            self.assertEqual(self.key(spelling), "bourree 3", spelling)

    def test_different_words_still_differ(self):
        self.assertNotEqual(self.key("Wals in 3"), self.key("Waltz in 3"))
        self.assertNotEqual(self.key("Ridée 6 temps"), self.key("Ridées 6 temps"))
        self.assertNotEqual(self.key("Waltz"), self.key("Waltz in 3"))

    def test_a_name_of_nothing_but_glue_keeps_its_folded_form(self):
        self.assertEqual(self.key("In de"), "in de")

    def test_slugs_are_not_built_from_it(self):
        # A slug is permanent, so adding a word to either list must never move one.
        self.assertEqual(slugify("Bourrée à 3 temps"), "bourree-a-3-temps")


class Rules(unittest.TestCase):
    def test_the_real_list_passes(self):
        text = DANCES.read_text(encoding="utf-8")
        self.assertEqual(check(json.loads(text), text, None), [])

    def test_a_clean_file_passes(self):
        self.assertEqual(problems(sample()), [])

    def test_a_name_cannot_belong_to_two_dances(self):
        data = sample()
        data["dances"][1]["names"].append("Andro")
        self.assertTrue(any("belongs to both" in p for p in problems(data)))

    def test_spelling_variants_of_one_name_still_collide(self):
        data = sample()
        data["dances"][1]["names"].append("an-dro")
        self.assertTrue(any("belongs to both" in p for p in problems(data)))

    def test_one_dance_may_not_hold_the_same_name_twice(self):
        data = sample()
        data["dances"][0]["names"] = ["Bourrée à 3 temps", "Bourrée 3t"]
        self.assertTrue(any("Keep one of them" in p for p in problems(data)))

    def test_the_word_lists_are_checked(self):
        self.assertTrue(any("single lowercase word" in p
                            for p in problems(sample(ignoredWords=["à 3 temps"]))))
        self.assertTrue(any("must give digits" in p
                            for p in problems(sample(numberWords={"trois": "three"}))))
        self.assertTrue(any("cannot be both" in p
                            for p in problems(sample(ignoredWords=["de", "trois"]))))

    def test_a_word_that_collapses_two_dances_fails_the_build(self):
        # The check that keeps either list from swallowing a word that names a dance.
        data = sample(ignoredWords=["dro"])
        data["dances"][1]["names"] = ["An"]
        self.assertTrue(any("belongs to both" in p for p in problems(data)))

    def test_a_tag_must_be_declared(self):
        data = sample()
        data["dances"][0]["tags"].append("gavotte")
        self.assertTrue(any("not in the tags list" in p for p in problems(data)))

    def test_a_slug_may_not_disappear(self):
        before = sample()
        after = sample()
        after["dances"] = [after["dances"][0]]
        self.assertTrue(any("permanent" in p for p in problems(after, before)))

    def test_renaming_every_spelling_is_fine(self):
        before = sample()
        after = sample()
        after["dances"][0]["names"] = ["En dro"]
        self.assertEqual(problems(after, before), [])

    def test_a_slug_must_look_like_a_slug(self):
        data = sample()
        data["dances"][0]["slug"] = "An Dro"
        self.assertTrue(any("unusable slug" in p for p in problems(data)))

    def test_a_dance_needs_a_name(self):
        data = sample()
        data["dances"][0]["names"] = []
        self.assertTrue(any("non-empty" in p for p in problems(data)))

    def test_a_duplicate_slug_is_caught(self):
        data = sample()
        data["dances"][1]["slug"] = "an-dro"
        data["dances"][1]["names"] = ["Something else"]
        self.assertTrue(any("used by 2 dances" in p for p in problems(data)))


class Formatting(unittest.TestCase):
    def test_the_real_list_is_canonical(self):
        text = DANCES.read_text(encoding="utf-8")
        self.assertEqual(render(json.loads(text)), text)

    def test_render_is_stable(self):
        once = render(sample())
        self.assertEqual(render(json.loads(once)), once)

    def test_the_word_lists_are_written_one_per_line_and_sorted(self):
        lines = render(sample(ignoredWords=["temps", "de", "in"])).splitlines()
        self.assertEqual(lines[2:6], ['  "ignoredWords": [', '    "de",', '    "in",', '    "temps"'])

    def test_render_sorts_dances_and_tags(self):
        data = sample()
        data["dances"].reverse()
        data["dances"][1]["tags"] = ["france", "bretagne"]
        lines = render(data).splitlines()
        self.assertLess(lines.index('    {"slug": "an-dro", "names": ["An dro", "Andro"], "tags": ["bretagne", "france"]},'),
                        next(i for i, l in enumerate(lines) if '"slug": "tour"' in l))

    def test_one_dance_per_line(self):
        # What keeps a git conflict down to the dances two people both edited.
        body = [l for l in render(sample()).splitlines() if l.startswith('    {"slug"')]
        self.assertEqual(len(body), 2)

    def test_names_keep_the_order_they_were_written_in(self):
        data = sample()
        data["dances"][0]["names"] = ["Andro", "An dro"]
        self.assertIn('["Andro", "An dro"]', render(data))

    def test_uncanonical_input_is_reported(self):
        data = sample()
        self.assertTrue(any("canonical" in p for p in check(data, json.dumps(data), None)))

    def test_accents_survive_a_round_trip(self):
        data = sample()
        data["dances"][0]["names"] = ["Pilé-menu"]
        self.assertIn("Pilé-menu", render(data))


if __name__ == "__main__":
    unittest.main(verbosity=2)
