// Proves the site writes dances.json exactly the way the validator wants it.
//
// The site regenerates the whole file when it opens a pull request. If its formatting drifts
// from scripts/validate.py by so much as a space, every proposal it makes fails the check and
// nobody can contribute. Cheap to verify, so it is verified on every pull request.
//
// Run: node scripts/check_canonical.mjs

import { readFile } from "node:fs/promises";
import { canonical } from "../site/canonical.js";

const path = new URL("../dances.json", import.meta.url);
const published = await readFile(path, "utf8");
const rewritten = canonical(JSON.parse(published));

if (rewritten === published) {
  console.log("dances.json: the site and the validator agree, byte for byte");
  process.exit(0);
}

const mine = rewritten.split("\n");
const theirs = published.split("\n");

for (let i = 0; i < Math.max(mine.length, theirs.length); i++) {
  if (mine[i] !== theirs[i]) {
    console.error(`dances.json:${i + 1}: the site would write it differently`);
    console.error(`  file: ${JSON.stringify(theirs[i])}`);
    console.error(`  site: ${JSON.stringify(mine[i])}`);
    break;
  }
}
process.exit(1);
