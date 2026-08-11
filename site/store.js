// The list, the draft, and the one path by which either changes.
//
// Nothing outside this file mutates a dance. Views call an action, the action records an
// intent and applies it, and the draft is saved. That is why a resumed draft behaves exactly
// like the editing session that produced it.

import { fold, foldIndexed, matchKey } from "./fold.js";
import { apply, describe, IGNORED, replay } from "./intents.js";
import { clearDraft, loadDraft, saveDraft } from "./draft.js";
import { listFrom } from "./github.js";

// Resolved against this module rather than the page, so the site keeps working if it is ever
// served from a subdirectory.
const DATA = new URL("../dances.json", import.meta.url);

const clone = (data) => ({
  ignoredWords: [...(data.ignoredWords ?? [])],
  numberWords: { ...data.numberWords },
  tags: [...data.tags],
  dances: data.dances.map((d) => ({ slug: d.slug, names: [...d.names], tags: [...d.tags] })),
});

/**
 * The list as published, or as one suggestion proposes it.
 *
 * Editing a suggestion means starting from what it actually says, not from the published list
 * with the suggestion's changes replayed on top: only the first shows the contributor what
 * their pull request currently contains, which is what a reviewer is commenting on.
 */
export async function createStore(suggestion) {
  let published;
  let version;

  if (suggestion) {
    published = (await listFrom(suggestion)).list;
    version = `pull-${suggestion.number}`;
  } else {
    const response = await fetch(DATA, { cache: "no-cache" });
    if (!response.ok) throw new Error(`could not load the list (${response.status})`);
    published = await response.json();
    // Whatever the server hands back to identify this version; it is what tells a week-old
    // draft that it is stale.
    version = response.headers.get("etag") || String(published.dances.length);
  }

  const source = suggestion ? `pull-${suggestion.number}` : "main";

  const store = {
    published,
    version,
    source,
    suggestion: suggestion || null,
    list: clone(published),
    intents: [],
    stale: [],
    listeners: new Set(),
  };

  const draft = loadDraft(source);
  if (draft && draft.intents.length) {
    const result = replay(store.list, draft.intents);
    store.intents = result.applied;
    store.stale = result.stale;
    store.resumedAt = draft.savedAt;
    store.wasBasedOn = draft.version;
  }

  const folded = new Map();

  Object.assign(store, {
    subscribe(listener) {
      store.listeners.add(listener);
    },

    /** Run an intent. Returns why it failed, so a field can say so without guessing. */
    run(intent) {
      const result = apply(store.list, intent);
      if (result.ok && !result.already) {
        store.intents.push(intent);
        saveDraft({ source, version: store.version, intents: store.intents });
        store.changed();
      }
      return result;
    },

    changed() {
      folded.clear();
      for (const listener of store.listeners) listener();
    },

    discard() {
      store.list = clone(store.published);
      store.intents = [];
      store.stale = [];
      clearDraft(source);
      store.changed();
    },

    dismissStale() {
      store.stale = [];
      store.changed();
    },

    /** Folded names, cached, for search and highlighting. */
    foldedNames(dance) {
      const key = dance.slug + "|" + dance.names.join("|");
      if (!folded.has(key)) folded.set(key, dance.names.map(foldIndexed));
      return folded.get(key);
    },

    find: (slug) => store.list.dances.find((d) => d.slug === slug),

    tagCount: (tag) => store.list.dances.filter((d) => d.tags.includes(tag)).length,

    /** Every word in either list, with what it means, in one order. */
    words() {
      const all = [
        ...(store.list.ignoredWords || []).map((word) => ({ word, means: IGNORED })),
        ...Object.entries(store.list.numberWords || {}).map(([word, means]) => ({ word, means })),
      ];
      return all.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    },

    /**
     * How many names the word actually turns up in.
     *
     * The count worth showing, because a word that appears in nothing is doing nothing, and a
     * list nobody can see the effect of is one that grows words on a hunch.
     */
    wordCount(word) {
      let count = 0;
      for (const dance of store.list.dances) {
        for (const name of dance.names) {
          if (fold(name).split(" ").includes(word)) count++;
        }
      }
      return count;
    },

    /** Which dance already goes by this name, if any. The rule the list rests on. */
    ownerOf(name, except) {
      const key = matchKey(name, store.list);
      const owner = store.list.dances.find(
        (d) => d.slug !== except && d.names.some((n) => matchKey(n, store.list) === key),
      );
      return owner || null;
    },

    /** A slug nobody has used, derived from the first spelling given. */
    freeSlug(base) {
      let slug = base;
      let n = 2;
      while (store.find(slug)) slug = `${base}-${n++}`;
      return slug;
    },

    changes: () => store.intents.map(describe),

    /** What changed against what is published, for the diff and the pull request. */
    diff() {
      const before = new Map(store.published.dances.map((d) => [d.slug, d]));
      const after = new Map(store.list.dances.map((d) => [d.slug, d]));
      const same = (a, b) =>
        a && b && a.names.join("|") === b.names.join("|") && a.tags.join("|") === b.tags.join("|");

      const rows = [];
      for (const [slug, dance] of after) {
        if (same(before.get(slug), dance)) continue;
        if (before.has(slug)) rows.push({ kind: "del", dance: before.get(slug) });
        rows.push({ kind: "add", dance });
      }
      for (const [slug, dance] of before) {
        if (!after.has(slug)) rows.push({ kind: "del", dance });
      }

      const tagsChanged = store.list.tags.join("|") !== store.published.tags.join("|");
      // Compared sorted, or adding a word back after removing it would read as a change
      // purely because the key landed at the other end of the object.
      const words = (list) =>
        JSON.stringify([
          [...(list.ignoredWords || [])].sort(),
          Object.keys(list.numberWords || {})
            .sort()
            .map((word) => [word, list.numberWords[word]]),
        ]);
      return {
        rows,
        tagsChanged,
        before: store.published.tags,
        after: store.list.tags,
        wordsChanged: words(store.list) !== words(store.published),
        wordsBefore: store.published,
        wordsAfter: store.list,
      };
    },
  });

  return store;
}
