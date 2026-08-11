# BigBalfolkList

A list of all the Balfolk dances that are being danced in some way on the scene today!

Every dance, every name it goes by, and no opinion about which of those names is the right one.
Free for anything to use.

## Contributing

Use **[the site](https://tjvl.github.io/BigBalfolkList/)**. It shows the whole list, lets you
add a spelling, fix one, tag a dance or add a dance that is missing, and turns what you did
into a proposal for someone to look at. Nothing you do goes live on its own, and you need
nothing installed.

Your work is kept in your own browser as you go, so you can close the tab and come back to it.
When you are ready, the site can open a pull request for you if you have a GitHub account, or
write up what you changed as an issue if you would rather not have one.

You can also read anyone's open suggestion from the same page, and continue your own if
somebody asks you to change something in it.

If you would rather edit [`dances.json`](dances.json) by hand, that works too. It is the only
file the list lives in.

## What a dance looks like

```json
{"slug": "an-dro", "names": ["An dro", "En dro", "Andro"], "tags": ["bretagne", "france"]}
```

**The names are equals.** None of them is the correct spelling; they are simply the names the
dance goes by. Spelling is contested and this list does not take sides. An equivalence set
means *the same dance under different names* — not similar dances, and not dances you happen
to treat as interchangeable when you programme an evening. That is your own business.

**Grammar is not a spelling.** `Bourrée à 3 temps`, `Bourrée in 3`, `Bourrée à trois temps`,
`Bourrée 3t` and `Bourrée 3` are one name written five ways, and writing all five out is how a
dance ends up with a dozen names nobody can read. So two small word lists sit at the top of the
file and names are compared with them applied: a word in `numberWords` becomes its number, and
a word in `ignoredWords` is dropped. Write the name the way it is said and leave the rest to
the lists.

They are in `dances.json` and not in code because they grow with every language somebody adds a
name in, and a consumer that ships the file gets the new words with it. Adding one is an
ordinary edit, and a word that is actually part of a dance's name fails the build, naming the
two dances it just collapsed.

What the lists must not swallow is a real word. `temps`, `times` and `tijden` are the edge of
what belongs in `ignoredWords`: they are there because `Valse à 3 temps` and `Valse 3` are the
same dance, and everything else in that list is pure glue. Plurals are deliberately left alone,
so `Ridée 6 temps` and `Ridées 6 temps` are still two names.

**A name belongs to exactly one dance**, and the build fails if that stops being true. So
anything that finds a name in a filename can resolve it to one dance and never has to model
ambiguity. Where a word really does name several dances — each Breton suite has its own
`Ton doubl` — the entries carry the qualifier: `Ton doubl (montagne)`, `Ton doubl (fisel)`,
`Ton doubl (plinn)`. Do the same when you add one; the error message will tell you if you
forget.

**The slug is the identity**, because no name can be. It is fixed the day a dance is added and
never changes afterwards, however much the spellings are rewritten. That is what lets an app
keep following a dance. A slug is never removed either, and the build enforces that too.

**Everything else is a tag.** Where a dance comes from, which family it belongs to, whether it
is danced as part of a suite: all tags, so a dance can be Breton *and* a gavotte *and* part of
a suite without being filed under one of them. Every tag a dance carries has to appear in the
`tags` list at the top of the file, which is also where a tag can sit with nothing on it yet.

## Using the list

Take the file and ship it. It is CC0, so no attribution notice and no lawyer.

```
https://raw.githubusercontent.com/TJvL/BigBalfolkList/main/dances.json
```

Store the **slug**, never a name. Names get corrected, respelled and added to; slugs do not
move and are never withdrawn.

### Matching a name people typed

Never compare the names as written. Fold first, or you will miss matches that are obviously the
same word to a human. Three rules, and each one costs real matches if you get it backwards:

| Rule | Example |
| --- | --- |
| An apostrophe **joins**, so it is removed | `Kost ar c'hoad` → `kost ar choad` |
| Every other mark **separates**, so it becomes a space | `Pilé-menu` → `pile menu` |
| Accents and case are ignored, runs of space collapse | `Valse à 3 temps` → `valse a 3 temps` |

Removing the hyphen too would give `pilemenu`, and turning the apostrophe into a space would
give `kost ar c hoad`. Neither matches anything anybody types.

Then split the folded name into words and apply the two lists, which is what makes the five
spellings of one bourrée land on one dance:

| Rule | Example |
| --- | --- |
| A word in `numberWords` becomes that number | `bourree a trois temps` → `bourree a 3 temps` |
| A word in `ignoredWords` is dropped | `bourree a 3 temps` → `bourree 3` |
| Nothing left means the name was all glue, so keep the folded form | `in de` → `in de` |

That is the **match key**, and it is what "a name belongs to exactly one dance" is enforced on,
so a key resolves to one dance or to none. Slugs are built from the folded name and never from
the key, which is why a word can be added to either list without a slug moving.

Reference implementations to copy: [`scripts/validate.py`](scripts/validate.py) in Python and
[`site/fold.js`](site/fold.js) in JavaScript. They agree on every name in the list, and
[`scripts/check_fold.mjs`](scripts/check_fold.mjs) runs both on every pull request to keep it
that way.

## The file's shape

`dances.json` is written one dance per line, sorted by slug, with tags sorted inside each
entry. That is not decoration: everybody edits this one file, and the formatting is what
decides whether two people working at once get a conflict on one line or on the whole
document.

The build checks the shape as well as the contents, so if you edit by hand:

```bash
python3 scripts/validate.py --fix    # puts the file back in shape
python3 scripts/validate.py          # says yes or no
python3 scripts/test_validate.py     # the validator's own tests
node scripts/check_canonical.mjs     # the site writes what the validator wants
node scripts/check_fold.mjs          # the site compares names the way the validator does
```

Nothing to install; any Python 3.11 or newer will do.

## What is in here

| Path | What |
| --- | --- |
| `dances.json` | The list. The only file it lives in. |
| `index.html`, `site/` | The site, served from GitHub Pages. No build step and no dependencies. |
| `scripts/` | The validator and its tests, run on every pull request. |
| `worker/` | Twenty lines on Cloudflare that let the site sign someone in to GitHub, and nothing else. |

## Licence

Two licences, because a list of facts and the software around it are different things.

| File | Licence | Applies to |
| --- | --- | --- |
| [`LICENSE`](LICENSE) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) | The dance list and anything generated from it |
| [`LICENSE-CODE`](LICENSE-CODE) | [MIT](https://opensource.org/licenses/MIT) | The code: `scripts/`, `site/` and `worker/` |
| [`site/fonts/`](site/fonts) | [SIL Open Font License](https://openfontlicense.org/) | Source Serif 4 and JetBrains Mono, whose own licences sit beside them |

The list is CC0 so that anyone can ship it inside an application without an attribution notice
or a lawyer. CC0 also waives the EU database right, which a code licence says nothing about, so
there is nothing left to wonder about when embedding it.
