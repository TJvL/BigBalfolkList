// The tag screen: make, rename, merge, delete.
//
// Renaming is safe because a tag is a thing in its own right rather than a word copied onto
// each dance, so every dance carrying it follows along. Renaming one to a name that already
// exists is a merge, which is how two tags that turned out to mean the same thing get
// cleaned up.
//
// A tag can also be made here, carrying nothing. On a dance card a new tag is a side effect of
// tagging something, which is right there: the deliberate click guards against sprawl. But
// somebody sorting the vocabulary out is thinking about the tags themselves, and asking them
// to go and find a dance to hang a name on first would only teach them to hang it on the
// wrong one.

import { button, el } from "./dom.js";
import { slugify } from "./fold.js";

export function renderTags(store, ui, actions) {
  const wrap = el("div");

  const bar = el("div", "tagbar");
  const filter = el("input");
  filter.type = "search";
  filter.placeholder = "filter tags…";
  filter.value = ui.tagFilter;
  filter.setAttribute("aria-label", "Filter tags");
  filter.addEventListener("input", () => actions.filterTags(filter.value));
  bar.append(filter);

  const shown = store.list.tags.filter((t) => t.includes(ui.tagFilter));
  bar.append(el("span", "hint", `${shown.length} of ${store.list.tags.length} tags`));
  bar.append(adder(store, ui, actions));
  wrap.append(bar);

  wrap.append(
    el(
      "p",
      "hint",
      "Renaming a tag is safe: every dance carrying it follows along, because a tag is a thing in its own right and not a word copied onto each dance. Rename one to a name already in the list and the two are merged.",
    ),
  );

  const box = el("div", "table-wrap");
  const table = el("table");

  const head = el("tr");
  head.append(el("th", null, "Tag"), el("th", "num", "Dances"), el("th"));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);

  const body = el("tbody");
  for (const tag of shown) {
    body.append(row(store, tag, actions));
  }
  table.append(body);

  box.append(table);
  wrap.append(box);
  return wrap;
}

/**
 * Make a tag that carries nothing yet.
 *
 * Escape abandons it and so does clicking away, because half a word typed and then thought
 * better of is not a tag anybody meant to make. Enter is the only thing that commits.
 */
function adder(store, ui, actions) {
  const slot = el("span", "adder");

  slot.append(
    button("btn", "New tag", () => {
      slot.replaceChildren();

      const input = el("input", "new-tag");
      input.type = "text";
      input.placeholder = "new tag, then Enter";
      input.setAttribute("aria-label", "Name of the new tag");
      slot.append(input);
      input.focus();

      const commit = () => {
        const tag = slugify(input.value);
        if (!tag) return actions.rerender();

        // Already there: say so by showing it, rather than by doing nothing visible.
        if (store.list.tags.includes(tag)) return actions.filterTags(tag);

        // A filter it does not match would hide the row it is about to make.
        if (!tag.includes(ui.tagFilter)) actions.filterTags("");
        store.run({ op: "tag.create", tag });
        requestAnimationFrame(() => {
          const made = document.querySelector(`tr[data-tag="${CSS.escape(tag)}"]`);
          made?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      };

      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") actions.rerender();
      });
      input.addEventListener("blur", () => actions.rerender());
    }),
  );

  return slot;
}

function row(store, tag, actions) {
  const count = store.tagCount(tag);
  const tr = el("tr", count ? null : "unused");
  tr.dataset.tag = tag;
  const name = el("td", null, tag);
  const acts = el("td", "acts");

  const rename = button("btn", "Rename", () => {
    name.replaceChildren();

    const input = el("input", "rename");
    input.value = tag;
    name.append(input);
    input.focus();
    input.select();

    const commit = () => {
      const next = slugify(input.value);
      if (!next || next === tag) return actions.rerender();
      store.run(
        store.list.tags.includes(next)
          ? { op: "tag.merge", from: tag, into: next }
          : { op: "tag.rename", from: tag, to: next },
      );
      actions.rerender();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") actions.rerender();
    });
    input.addEventListener("blur", commit);
  });

  const merge = button("btn", "Merge into…", () => {
    acts.replaceChildren();

    const select = el("select", "rename");
    select.append(new Option("choose a tag…", ""));
    for (const other of store.list.tags.filter((t) => t !== tag)) {
      select.append(new Option(`${other} (${store.tagCount(other)})`, other));
    }
    acts.append(select);
    select.focus();

    select.addEventListener("change", () => {
      if (!select.value) return actions.rerender();
      store.run({ op: "tag.merge", from: tag, into: select.value });
    });
  });

  const remove = button(
    "btn",
    "Delete",
    () => store.run({ op: "tag.delete", tag }),
    {
      disabled: count > 0,
      title: count ? `Still on ${count} dances` : "Nothing carries it",
    },
  );

  acts.append(rename, merge, remove);
  tr.append(name, el("td", "num", String(count)), acts);
  return tr;
}
