// The fold rule, for comparing names.
//
// scripts/validate.py implements the same three rules, and so does anything consuming this
// list. They must agree exactly, or a name matches in one place and not in another.
//
// - An apostrophe joins a word and is removed. "Kost ar c'hoad" folds to "kost ar choad",
//   which is what people type. Turning it into a space gives "kost ar c hoad", matching
//   nothing.
// - Every other mark separates and becomes a space. "Pilé-menu" folds to "pile menu";
//   removing the hyphen gives "pilemenu", again matching nothing.
// - Accents and case are ignored.

const JOINERS = new Set(["'", "’", "ʼ", "´", "`"]);

/**
 * Fold a name, keeping a map from each folded character back to where it came from.
 * The map is what lets a search highlight the match in the original spelling.
 */
export function foldIndexed(value) {
  let folded = "";
  const map = [];

  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (JOINERS.has(character)) continue;

    const base = character
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (/^[a-z0-9]+$/.test(base)) {
      for (const c of base) {
        folded += c;
        map.push(i);
      }
    } else if (folded.length && folded[folded.length - 1] !== " ") {
      folded += " ";
      map.push(i);
    }
  }

  while (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    map.pop();
  }

  return { folded, map };
}

export function fold(value) {
  return foldIndexed(value).folded;
}

export function slugify(value) {
  return fold(value).replace(/ /g, "-");
}

/**
 * What two names have to share to be the same name. match_key() in scripts/validate.py is
 * the same function, and they have to stay in step for the same reason fold() does.
 *
 * Folding alone leaves the list carrying one name several times over, because the difference
 * between "Bourrée à 3 temps", "Bourrée in 3", "Bourrée 3t" and "Bourrée 3" is grammar and
 * shorthand, not a different dance. So a word that spells a number becomes the number, and a
 * word that is only glue is dropped. Both word lists come from the list itself rather than
 * from here, so adding one is an edit to dances.json and not a code change.
 *
 * Slugs are not built from this; they come from fold(), so no slug moves when a word is added.
 */
export function matchKey(value, list) {
  const ignored = new Set(list?.ignoredWords ?? []);
  const numbers = list?.numberWords ?? {};

  const folded = fold(value);
  const kept = folded
    .split(" ")
    .map((word) => numbers[word] ?? word)
    .filter((word) => !ignored.has(word));

  // A name made of nothing but glue keeps its folded form, rather than becoming empty and
  // colliding with every other such name.
  return kept.length ? kept.join(" ") : folded;
}
