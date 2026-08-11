// Writing dances.json the way the repository insists on having it.
//
// This has to agree with render() in scripts/validate.py byte for byte, or every proposal the
// site opens fails its own check. Note the spacing: `{"slug": "x", "names": ["a", "b"]}`, with
// a space after each colon and comma, which is Python's default and not JavaScript's.
//
// scripts/check_canonical.mjs proves the two agree against the real list, and CI runs it.

const string = (value) => JSON.stringify(value);

const array = (values) => "[" + values.map(string).join(", ") + "]";

const entry = (dance) =>
  `{"slug": ${string(dance.slug)}, "names": ${array(dance.names)}, "tags": ${array(dance.tags)}}`;

export const FORMAT_VERSION = 4;

export function canonical(list) {
  const tags = [...new Set(list.tags)].sort();
  const dances = [...list.dances].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const ignored = [...new Set(list.ignoredWords ?? [])].sort();
  const numbers = list.numberWords ?? {};

  // One value per line, the last without a comma. Same reason as one dance per line.
  const rows = (values) =>
    values.map((value, index) => "    " + value + (index === values.length - 1 ? "" : ","));

  const lines = ["{", `  "formatVersion": ${FORMAT_VERSION},`, '  "ignoredWords": ['];

  lines.push(...rows(ignored.map(string)));
  lines.push("  ],");
  lines.push('  "numberWords": {');
  lines.push(...rows(Object.keys(numbers).sort().map((w) => `${string(w)}: ${string(numbers[w])}`)));
  lines.push("  },");
  lines.push('  "tags": [');
  lines.push(...rows(tags.map(string)));
  lines.push("  ],");
  lines.push('  "dances": [');

  dances.forEach((dance, index) => {
    const tidy = {
      slug: dance.slug,
      names: [...dance.names],
      tags: [...new Set(dance.tags)].sort(),
    };
    lines.push("    " + entry(tidy) + (index === dances.length - 1 ? "" : ","));
  });

  lines.push("  ]");
  lines.push("}");
  return lines.join("\n") + "\n";
}
