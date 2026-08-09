# Rework: implementation plan

Turning the list into a tags-only JSON file with a web editor in front of it. The decisions
behind each step are settled; this is the order to build them in.

Everything below assumes the rule that outranks the rest: **a slug, once published, never
changes and is never removed.** Any step that would break that is wrong, however convenient.

---

## Stage 1 — the data

The list itself changes shape before any tooling does, so every later step has something real
to work against.

1. **Convert the headings to tags.** Regions split into their parts (`Bretagne (France)` →
   `bretagne` + `france`), `Common` → `pan-scene`, `Modern, neo-folk and undetermined` →
   `unplaced`, suites keep `suite` plus an identity tag (`suite-fisel`). 34 tags over 113
   dances. Which tags exist is Thomas's call and is edited in the app afterwards like any
   other tag; it is not a thing for the tooling to have an opinion about.
2. **Write the new `dances.json`.** Top-level `formatVersion`, `tags` array, and `dances`,
   each entry `{slug, names, tags}`. Every slug identical to today's, taken from
   `slugs.lock.json` before that file goes away.
3. **Fix the canonical format now, not later:** one dance per line, dances sorted by slug,
   tags sorted, stable key order, trailing newline. Everyone edits this one file, so the
   formatting is what decides whether a git conflict is one line or the whole document.

## Stage 2 — the repo

4. **Replace `scripts/convert.py` with `scripts/validate.py`.** It stops generating and
   starts checking: every name unique across all dances, every tag on a dance present in the
   `tags` array, no slug removed or altered against `main`, and the file byte-identical to its
   canonical formatting. Keep `fold()` exactly as it is — every consumer of the list folds
   names the same way, apostrophes joining and everything else separating. Add `--fix` so it
   can write the canonical form rather than only complaining about it.
5. **Delete `dances.md` and `slugs.lock.json`.** The lock only existed to remember slugs that
   the markdown did not store.
6. **Replace the `Generate` workflow with `Validate`**, running `validate.py` on pull requests
   only. No bot commits, no bot-authored pull request, and therefore none of the Actions
   ruleset trouble that could not be solved on a free plan.
7. **Rewrite the README** around the editor: what the file means, what a tag is, and that
   changes are proposed through the site rather than by hand.
8. **Tests for the validator**: name collision, unknown tag, removed slug, mis-sorted file,
   and a fold-rule table (`Kost ar c'hoad` → `kost ar choad`, `Pilé-menu` → `pile menu`)
   that would catch the rule drifting.

## Stage 3 — the app, offline

The mockup at `https://claude.ai/code/artifact/00f62200-ed0a-41c7-88fe-178b714c133b` is the
reference for behaviour and layout. It is one file with the data inlined; the real one is not.

9. **Lay it out for maintenance**: `index.html`, `app.css`, and ES modules (`data.js`,
   `browse.js`, `edit.js`, `tags.js`, `draft.js`, `github.js`). No bundler, no build step —
   GitHub Pages serves it as-is.
10. **Fetch `dances.json` at runtime** rather than inlining it, so the page and the data
    stay one source.
11. **Browse mode**: tag cloud weighted by count, any/all combining, search across every
    spelling with the fold rule, cards showing names as equals.
12. **Edit mode**: expand a card in place, name tokens validated live against every other
    dance's names, tag picker where existing tags are cheap and new ones cost a deliberate
    click, bulk tagging from selection, the tags screen with rename and merge, and
    make-a-tag for a dance that turns out to be a family. Renaming and merging tags is open
    to everyone through the ordinary pull request flow — no maintainer-only path, and no
    special casing for a rename that happens to touch many dances. The diff shows what it
    touches, which is what review is for.
13. **Drafts.** Record every edit as an intent — `{op, slug, value}`, ops `name.add`,
    `name.remove`, `tag.add`, `tag.remove`, `dance.add`, `dance.remove`, `tag.rename`,
    `tag.merge` — and keep them in localStorage with the commit SHA they were made against.
    On load, fetch the current file, replay, and report any intent that no longer applies
    rather than silently dropping it. Never store a snapshot of the whole list: it would
    quietly revert whatever was merged while the draft sat.
14. **Publish to GitHub Pages** from `main`, so the site is live and useful before any
    authentication exists. Up to here it is a browser and a draft editor, which is already
    worth having.

## Stage 4 — proposing changes

15. **Register an OAuth app**, scope `public_repo` and nothing more.
16. **Cloudflare Worker for the code exchange.** GitHub's token endpoint sends no CORS
    headers, so a static page cannot do this itself. The Worker holds the client secret,
    accepts only the Pages origin, and does nothing else. Free plan, `*.workers.dev`.
17. **The pull request path**: regenerate the file by replaying intents onto the `main` that
    is live at that moment — never the version the contributor started from — then fork if
    needed, branch, commit, and open a pull request whose body lists the changes in plain
    language. Show the link, clear the draft, remember the number.
18. **The no-account path**, which most dancers will take: a second button that opens a
    pre-filled GitHub issue describing the change in words, for a maintainer to apply. It
    needs no login and no fork.

Consumers of the list are reworked separately, on their own schedule. This repo publishes the
new format and stops there.
