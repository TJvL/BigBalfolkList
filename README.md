# BigBalfolkList

A list of all the Balfolk dances that are being danced in some way on the scene today!

## Contributing

Use the site. It shows the whole list, lets you add a spelling, fix one, tag a dance or add a
dance that is missing, and turns what you did into a proposal for someone to look at. Nothing
you do goes live on its own, and you need nothing installed.

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
```

Nothing to install; any Python 3.11 or newer will do.

## Licence

Two licences, because a list of facts and a script that transforms it are different things.

| File | Licence | Applies to |
| --- | --- | --- |
| [`LICENSE`](LICENSE) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) | The dance list and anything generated from it |
| [`LICENSE-CODE`](LICENSE-CODE) | [MIT](https://opensource.org/licenses/MIT) | The tooling in `scripts/` |

The list is CC0 so that anyone can ship it inside an application without an attribution notice
or a lawyer. CC0 also waives the EU database right, which a code licence says nothing about, so
there is nothing left to wonder about when embedding it.
