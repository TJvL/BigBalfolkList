// Proves site/fold.js and scripts/validate.py fold and key names identically.
//
// The README tells consumers to copy one of the two, so they have to agree. If they drift, a
// name resolves in an application and not on the site, or the site offers a spelling the
// validator then refuses, and neither failure points at the rule that caused it.
//
// Every name in the real list is checked, which is what makes this worth more than a handful
// of examples: the awkward cases are already in the file.
//
// Run: node scripts/check_fold.mjs

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fold, matchKey } from "../site/fold.js";

const root = new URL("..", import.meta.url);
const list = JSON.parse(await readFile(new URL("dances.json", root), "utf8"));

const python = execFileSync("python3", ["scripts/validate.py", "--keys"], {
  cwd: root.pathname,
  encoding: "utf8",
});

const expected = JSON.parse(python);
const disagreements = [];

for (const [name, [folded, key]] of Object.entries(expected)) {
  if (fold(name) !== folded) disagreements.push([name, "fold", folded, fold(name)]);
  const mine = matchKey(name, list);
  if (mine !== key) disagreements.push([name, "matchKey", key, mine]);
}

if (!disagreements.length) {
  console.log(`fold.js: agrees with validate.py on all ${Object.keys(expected).length} names`);
  process.exit(0);
}

for (const [name, rule, theirs, mine] of disagreements) {
  console.error(`${JSON.stringify(name)}: ${rule} disagrees`);
  console.error(`  validate.py: ${JSON.stringify(theirs)}`);
  console.error(`  fold.js:     ${JSON.stringify(mine)}`);
}
process.exit(1);
