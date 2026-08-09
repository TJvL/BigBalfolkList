// Browsing: the tag cloud, and the cards.
//
// A card has no title. The slug sits where a title would, because that is the identity, and
// the names sit below it as a flat set separated by middots, because none of them outranks
// the others. Rendering one large and the rest small would be a claim the list does not make.

import { button, el, escapeHtml } from "./dom.js";

/** Highlight the searched-for text inside the spelling it actually matched. */
export function nameHtml(name, folded, query) {
  const at = query ? folded.folded.indexOf(query) : -1;
  if (at === -1) return escapeHtml(name);

  const start = folded.map[at];
  const end = folded.map[at + query.length - 1] + 1;
  return (
    escapeHtml(name.slice(0, start)) +
    "<mark>" +
    escapeHtml(name.slice(start, end)) +
    "</mark>" +
    escapeHtml(name.slice(end))
  );
}

export function matches(store, dance, ui) {
  if (ui.selected.size) {
    const hits = [...ui.selected].filter((t) => dance.tags.includes(t)).length;
    if (ui.combine === "all" ? hits !== ui.selected.size : hits === 0) return false;
  }
  return !ui.query || store.foldedNames(dance).some((n) => n.folded.includes(ui.query));
}

export function renderCloud(container, store, ui, actions) {
  const live = new Set();
  for (const dance of store.list.dances) {
    if (matches(store, dance, ui)) dance.tags.forEach((t) => live.add(t));
  }

  const counts = new Map(store.list.tags.map((t) => [t, store.tagCount(t)]));
  const used = [...counts.values()].filter((n) => n > 0);
  const max = Math.max(1, ...used);
  const min = Math.min(1, ...used);

  container.replaceChildren();
  for (const tag of store.list.tags) {
    const count = counts.get(tag) || 0;
    const scale =
      max === min ? 0.5 : (Math.sqrt(count) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));

    const node = button(null, null, () => actions.toggleTag(tag), {
      pressed: ui.selected.has(tag),
    });
    node.style.fontSize = (0.75 + Math.max(0, scale) * 0.7).toFixed(3) + "rem";
    node.classList.toggle("dead", !ui.selected.has(tag) && !live.has(tag));
    node.append(document.createTextNode(tag), el("span", "n", String(count)));
    container.append(node);
  }
}

/** A card as it looks when it is not being edited. */
export function renderCard(card, store, dance, ui, actions) {
  const names = ui.editing ? el("button", "names") : el("div", "names");
  if (ui.editing) {
    names.type = "button";
    names.title = "Edit this dance";
    names.addEventListener("click", () => actions.expand(dance.slug));
  }

  const folded = store.foldedNames(dance);
  names.innerHTML = dance.names
    .map((name, i) => '<span class="name">' + nameHtml(name, folded[i], ui.query) + "</span>")
    .join('<span class="sep"> · </span>');
  card.append(names);

  const chips = el("div", "chips");
  for (const tag of dance.tags) {
    chips.append(
      button("chip", tag, () => actions.toggleTag(tag), { pressed: ui.selected.has(tag) }),
    );
  }
  card.append(chips);
}
