# BigBalfolkList

A list of all the Balfolk dances that are being danced in some way on the scene today!

## Contributing

Edit [`dances.md`](dances.md). That is the only file to touch, and editing it in the GitHub web
interface is enough; there is nothing to install and no script to run.

A push to `main` regenerates `dances.json` and `slugs.lock.json` automatically and commits them.
On a pull request the same converter runs as a check, so a malformed file is caught before merge.

### The format

- `##` is a region or tradition, and every dance sits under exactly one.
- `###` is a family or a suite, where one exists.
- `-` is a dance. Names separated by `/` are **equals**: none of them is the correct spelling, they
  are the names the dance goes by. Spelling is contested and this list does not take sides.
- `{braces}` hold tags, so a dance can belong to a family, have a formation and sit in a tradition
  without being forced to pick one.
- A `###` tagged `{suite}` means its dances are performed as a sequence, not merely grouped.

An equivalence set means **the same dance under different names**. It does not mean similar dances.
Two distinct dances that you happen to treat as interchangeable is a matter for your own
programming, not for this list.

### Generated files

| File | What it is |
| --- | --- |
| `dances.json` | The list, for consumers. Never edit it; it is overwritten. |
| `slugs.lock.json` | Remembers which slug each dance has, so renaming one or fixing an accent does not change its identity for anything already using it. Never edit it. |

Every dance has a slug and it is the identity, because no name can be: the names are equals by
design. `ambiguousNames` in the JSON lists names that belong to more than one dance, which is real
rather than a mistake. Each Breton suite has its own `Ton doubl`, so a consumer matching that string
should treat it as "one of these" rather than picking.

## Licence

Two licences, because a list of facts and a script that transforms it are different things.

| File | Licence | Applies to |
| --- | --- | --- |
| [`LICENSE`](LICENSE) | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) | The dance list and anything generated from it |
| [`LICENSE-CODE`](LICENSE-CODE) | [MIT](https://opensource.org/licenses/MIT) | The tooling in `scripts/` |

The list is CC0 so that anyone can ship it inside an application without an attribution notice or a
lawyer. CC0 also waives the EU database right, which a code licence says nothing about, so there is
nothing left to wonder about when embedding it.
