// Every edit is an intent, and an intent is the only way the list changes.
//
// Editing live and resuming a draft are then the same operation: apply(list, intent). A draft
// is a list of intents replayed onto whatever dances.json says now, so anything other people
// merged in the meantime survives. Storing edited dances instead would quietly revert their
// work the moment a stale draft was proposed.
//
// apply() never throws. It returns why it could not be applied, which is what lets a resumed
// draft say "this one no longer fits" instead of silently dropping it.

import { fold } from "./fold.js";

export const OPS = [
  "dance.add",
  "dance.remove",
  "name.add",
  "name.remove",
  "tag.add",
  "tag.remove",
  "tag.rename",
  "tag.merge",
  "tag.delete",
];

const ok = () => ({ ok: true });
const already = (reason) => ({ ok: true, already: true, reason });
const no = (reason) => ({ ok: false, reason });

const find = (list, slug) => list.dances.find((d) => d.slug === slug);

const ownerOf = (list, name, except) => {
  const key = fold(name);
  const owner = list.dances.find(
    (d) => d.slug !== except && d.names.some((n) => fold(n) === key),
  );
  return owner ? owner.slug : null;
};

const sorted = (values) => [...new Set(values)].sort();

/**
 * Apply one intent to a list, in place.
 *
 * `already` means the list is in the state the intent wanted, so replaying it changed
 * nothing and that is fine. `ok: false` means it cannot be applied at all, which on a
 * resumed draft is a conflict worth showing.
 */
export function apply(list, intent) {
  const dance = intent.slug ? find(list, intent.slug) : null;

  switch (intent.op) {
    case "dance.add": {
      if (find(list, intent.slug)) return already("that dance already exists");
      const clash = intent.names.find((n) => ownerOf(list, n, intent.slug));
      if (clash) return no(`the name "${clash}" now belongs to another dance`);
      list.dances.push({
        slug: intent.slug,
        names: [...intent.names],
        tags: sorted(intent.tags || []),
        isNew: true,
      });
      for (const tag of intent.tags || []) declare(list, tag);
      return ok();
    }

    case "dance.remove": {
      if (!dance) return already("that dance is already gone");
      list.dances = list.dances.filter((d) => d.slug !== intent.slug);
      return ok();
    }

    case "name.add": {
      if (!dance) return no("that dance no longer exists");
      const key = fold(intent.value);
      if (dance.names.some((n) => fold(n) === key)) return already("it already has that name");
      const owner = ownerOf(list, intent.value, intent.slug);
      if (owner) return no(`"${intent.value}" now belongs to ${owner}`);
      dance.names.push(intent.value);
      return ok();
    }

    case "name.remove": {
      if (!dance) return no("that dance no longer exists");
      if (!dance.names.includes(intent.value)) return already("that name is already gone");
      if (dance.names.length === 1) return no("it is the only name the dance has");
      dance.names = dance.names.filter((n) => n !== intent.value);
      return ok();
    }

    case "tag.add": {
      if (!dance) return no("that dance no longer exists");
      declare(list, intent.tag);
      if (dance.tags.includes(intent.tag)) return already("it already carries that tag");
      dance.tags = sorted([...dance.tags, intent.tag]);
      return ok();
    }

    case "tag.remove": {
      if (!dance) return no("that dance no longer exists");
      if (!dance.tags.includes(intent.tag)) return already("it does not carry that tag");
      dance.tags = dance.tags.filter((t) => t !== intent.tag);
      return ok();
    }

    case "tag.rename": {
      if (!list.tags.includes(intent.from)) {
        return list.tags.includes(intent.to)
          ? already("that tag has already been renamed")
          : no(`the tag ${intent.from} no longer exists`);
      }
      if (list.tags.includes(intent.to)) return no(`${intent.to} already exists, so this is a merge`);
      list.tags = sorted(list.tags.map((t) => (t === intent.from ? intent.to : t)));
      for (const d of list.dances) {
        if (d.tags.includes(intent.from)) {
          d.tags = sorted(d.tags.map((t) => (t === intent.from ? intent.to : t)));
        }
      }
      return ok();
    }

    case "tag.merge": {
      if (!list.tags.includes(intent.from)) return already("that tag is already gone");
      if (!list.tags.includes(intent.into)) return no(`the tag ${intent.into} no longer exists`);
      for (const d of list.dances) {
        if (d.tags.includes(intent.from)) {
          d.tags = sorted([...d.tags.filter((t) => t !== intent.from), intent.into]);
        }
      }
      list.tags = list.tags.filter((t) => t !== intent.from);
      return ok();
    }

    case "tag.delete": {
      if (!list.tags.includes(intent.tag)) return already("that tag is already gone");
      const carriers = list.dances.filter((d) => d.tags.includes(intent.tag)).length;
      if (carriers) return no(`${carriers} dances now carry ${intent.tag}`);
      list.tags = list.tags.filter((t) => t !== intent.tag);
      return ok();
    }

    default:
      return no(`unknown change "${intent.op}"`);
  }
}

/** A tag exists in its own right, so it is declared once and can carry nothing. */
function declare(list, tag) {
  if (!list.tags.includes(tag)) list.tags = sorted([...list.tags, tag]);
}

/** Replay a saved draft onto a freshly loaded list. Nothing is dropped in silence. */
export function replay(list, intents) {
  const applied = [];
  const stale = [];

  for (const intent of intents) {
    const result = apply(list, intent);
    if (!result.ok) stale.push({ intent, reason: result.reason });
    else applied.push(intent);
  }

  return { applied, stale };
}

/**
 * What an intent reads like, in the change list and in a pull request body.
 *
 * Written as sentences about the dance, because these are read by people: "grabbelton tagged
 * netherlands", not "netherlands → grabbelton". Arrows made sense beside a card and nowhere
 * else.
 */
export function describe(intent) {
  switch (intent.op) {
    case "dance.add":
      return { verb: "added", text: `${intent.names[0]} added as a new dance` };
    case "dance.remove":
      return { verb: "removed", text: `the dance ${intent.slug} removed` };
    case "name.add":
      return { verb: "name +", text: `${intent.slug} also goes by “${intent.value}”` };
    case "name.remove":
      return { verb: "name −", text: `${intent.slug} no longer goes by “${intent.value}”` };
    case "tag.add":
      return { verb: "tag", text: `${intent.slug} tagged ${intent.tag}` };
    case "tag.remove":
      return { verb: "untag", text: `${intent.tag} taken off ${intent.slug}` };
    case "tag.rename":
      return { verb: "renamed", text: `the tag ${intent.from} renamed to ${intent.to}` };
    case "tag.merge":
      return { verb: "merged", text: `the tag ${intent.from} folded into ${intent.into}` };
    case "tag.delete":
      return { verb: "deleted", text: `the tag ${intent.tag} deleted` };
    default:
      return { verb: "changed", text: intent.op };
  }
}
