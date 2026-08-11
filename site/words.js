// The word screen: the two lists that decide when two spellings are one name.
//
// A word here is either ignored or stands for a number, and between them they are what lets
// the list carry "Bourrée à 3 temps" once instead of five times. That makes this the most
// dangerous screen in the site: a word added here changes how every name in the list is
// compared, not just the one somebody was looking at.
//
// So two things are always in front of whoever is editing. Every row says how many names the
// word actually turns up in, because a word that appears in nothing is doing nothing and a
// word that appears in ninety names deserves a second thought. And a word that would make two
// names into one name is refused with both names quoted, since that is the failure the lists
// exist to avoid and the only one that cannot be seen by reading the word on its own.

import { button, el } from "./dom.js";
import { fold } from "./fold.js";
import { IGNORED } from "./intents.js";

const HINT =
  "These decide when two spellings are the same name. A word that stands for a number becomes " +
  "that number, so “trois” and “3t” both read as 3. An ignored word is dropped, so " +
  "“Bourrée à 3 temps”, “Bourrée in 3” and “Bourrée 3” are one name and the list carries it " +
  "once. Only add glue: “temps” is as far as it goes, and it is only there because a waltz in " +
  "3 temps is a waltz in 3.";

export function renderWords(store, ui, actions) {
  const wrap = el("div");
  const all = store.words();
  const shown = all.filter((w) => w.word.includes(ui.wordFilter));

  const bar = el("div", "tagbar");
  const filter = el("input");
  filter.type = "search";
  filter.placeholder = "filter words…";
  filter.value = ui.wordFilter;
  filter.setAttribute("aria-label", "Filter words");
  filter.addEventListener("input", () => actions.filterWords(filter.value));
  bar.append(filter);

  bar.append(el("span", "hint", `${shown.length} of ${all.length} words`));
  bar.append(adder(store, ui, actions, IGNORED), adder(store, ui, actions, "number"));
  wrap.append(bar);

  const note = el("p", "note idle", HINT);
  note.id = "word-note";
  wrap.append(note);

  const box = el("div", "table-wrap");
  const table = el("table");

  const head = el("tr");
  head.append(el("th", null, "Word"), el("th", null, "Means"), el("th", "num", "Names"), el("th"));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);

  const body = el("tbody");
  for (const { word, means } of shown) body.append(row(store, word, means, actions));
  table.append(body);

  box.append(table);
  wrap.append(box);
  return wrap;
}

/** Say why a change was refused, where the person who tried it is looking. */
function complain(result, actions) {
  if (result.ok) return actions.rerender();
  const note = document.getElementById("word-note");
  if (!note) return;
  note.className = "note bad";
  note.textContent = capitalise(result.reason) + ".";
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Add a word, either ignored or standing for a number.
 *
 * Two buttons rather than one field that guesses: the two lists do different things, and a
 * field where "3" means one and "in" means the other is a field that will eventually put a
 * word in the wrong one.
 */
function adder(store, ui, actions, kind) {
  const number = kind === "number";
  const slot = el("span", "adder");

  slot.append(
    button("btn", number ? "Word for a number" : "Ignore a word", () => {
      slot.replaceChildren();

      const word = el("input", "new-tag");
      word.type = "text";
      word.placeholder = number ? "trois" : "in";
      word.setAttribute("aria-label", number ? "The word" : "The word to ignore");
      slot.append(word);

      const digits = el("input", "new-tag digits");
      if (number) {
        digits.type = "text";
        digits.inputMode = "numeric";
        digits.placeholder = "3";
        digits.setAttribute("aria-label", "The number it stands for");
        slot.append(digits);
      }

      word.focus();

      const commit = () => {
        const value = fold(word.value);
        if (!value) return actions.rerender();
        if (number && !/^[0-9]+$/.test(digits.value.trim())) return digits.focus();

        // A filter it does not match would hide the row it is about to make.
        if (!value.includes(ui.wordFilter)) actions.filterWords("");

        const result = store.run({
          op: "word.add",
          word: value,
          means: number ? digits.value.trim() : IGNORED,
        });
        complain(result, actions);

        if (result.ok) {
          requestAnimationFrame(() => {
            const made = document.querySelector(`tr[data-word="${CSS.escape(value)}"]`);
            made?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }
      };

      for (const input of number ? [word, digits] : [word]) {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            // Tab order in one key: the word alone is never the whole answer for a number.
            number && input === word ? digits.focus() : commit();
          }
          if (event.key === "Escape") actions.rerender();
        });
      }
      // Only when focus has left both fields, or typing the word would abandon the number.
      slot.addEventListener("focusout", () => {
        requestAnimationFrame(() => {
          if (!slot.contains(document.activeElement)) actions.rerender();
        });
      });
    }),
  );

  return slot;
}

function row(store, word, means, actions) {
  const count = store.wordCount(word);
  const number = means !== IGNORED;
  const tr = el("tr", count ? null : "unused");
  tr.dataset.word = word;

  const acts = el("td", "acts");

  const change = button("btn", number ? "Change number…" : "Make it a number…", () => {
    acts.replaceChildren();

    const digits = el("input", "rename digits");
    digits.type = "text";
    digits.inputMode = "numeric";
    digits.value = number ? means : "";
    digits.placeholder = "3";
    digits.setAttribute("aria-label", `What ${word} stands for`);
    acts.append(digits);
    digits.focus();
    digits.select();

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const value = digits.value.trim();
      if (!/^[0-9]+$/.test(value)) return actions.rerender();
      complain(store.run({ op: "word.add", word, means: value }), actions);
    };

    digits.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        done = true;
        actions.rerender();
      }
    });
    digits.addEventListener("blur", commit);
  });

  const ignore = button("btn", "Ignore it instead", () =>
    complain(store.run({ op: "word.add", word, means: IGNORED }), actions),
  );

  const remove = button(
    "btn",
    "Delete",
    () => complain(store.run({ op: "word.remove", word }), actions),
    {
      // Deleting can never collapse two names, only tell them apart again, so it is never
      // refused. What it can do is split a name the list currently carries once.
      title: count ? `${count} names contain it` : "It appears in no name",
    },
  );

  if (number) acts.append(ignore);
  acts.append(change, remove);

  tr.append(
    el("td", null, word),
    el("td", number ? "means number" : "means", number ? means : "ignored"),
    el("td", "num", String(count)),
    acts,
  );
  return tr;
}
