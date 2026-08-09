// Editing a dance: the expanded card, the bulk bar, and turning a dance into a family.
//
// Two rules shape the fields. A name is checked against every other dance while it is being
// typed, because "a name belongs to exactly one dance" is the rule the whole list rests on
// and finding out at merge time is too late. And picking an existing tag is one keystroke
// while inventing one costs a deliberate click, because free tagging sprawls into
// near-duplicates within a month.

import { button, el } from "./dom.js";
import { slugify } from "./fold.js";

const IDLE_NAME_HINT =
  "Names sit side by side as equals. Whichever you add is no more correct than the others.";

export function nameField(store, dance, rerender) {
  const field = el("div", "field");
  field.append(el("span", "eyebrow", "Names"));

  const note = el("p", "note idle", IDLE_NAME_HINT);
  const tokens = el("div", "tokens");

  for (const name of dance.names) {
    const token = el("span", "token");
    token.append(document.createTextNode(name));
    token.append(
      button("x", "✕", () => {
        const result = store.run({ op: "name.remove", slug: dance.slug, value: name });
        if (!result.ok) {
          note.className = "note bad";
          note.textContent = capitalise(result.reason);
        }
      }, { label: `Remove ${name}` }),
    );
    tokens.append(token);
  }

  const input = el("input", "token-input");
  input.type = "text";
  input.placeholder = "add another spelling…";
  input.setAttribute("aria-label", "Add a name");
  tokens.append(input);

  field.append(tokens, note);

  const look = (raw) => {
    const value = raw.trim();
    if (!value) return { quiet: true };

    const owner = store.ownerOf(value, dance.slug);
    if (owner) {
      return {
        ok: false,
        message: `“${value}” already names ${owner.names[0]}. A name can only belong to one dance.`,
      };
    }
    if (dance.names.some((n) => n === value)) {
      return { ok: false, message: "This dance already goes by that name." };
    }
    return { ok: true, message: "Free to use." };
  };

  input.addEventListener("input", () => {
    const result = look(input.value);
    note.className = "note " + (result.quiet ? "idle" : result.ok ? "ok" : "bad");
    note.textContent = result.quiet ? IDLE_NAME_HINT : result.message;
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const value = input.value.trim();
    if (!look(value).ok) return;

    store.run({ op: "name.add", slug: dance.slug, value });
    rerender(() => document.querySelector(".card.open .token-input")?.focus());
  });

  return field;
}

export function tagField(store, dance, targets) {
  const field = el("div", "field");
  field.append(el("span", "eyebrow", "Tags"));

  if (dance) {
    const tokens = el("div", "tokens");
    for (const tag of dance.tags) {
      const chip = el("span", "token tag");
      chip.append(document.createTextNode(tag));
      chip.append(
        button("x", "✕", () => store.run({ op: "tag.remove", slug: dance.slug, tag }), {
          label: `Remove tag ${tag}`,
        }),
      );
      tokens.append(chip);
    }
    if (!dance.tags.length) tokens.append(el("span", "hint", "No tags yet."));
    field.append(tokens);
  }

  const picker = el("div", "picker");
  const input = el("input", "picker-input");
  input.type = "text";
  input.placeholder = "type to find a tag…";
  input.setAttribute("aria-label", "Find or create a tag");

  const menu = el("div", "menu");
  menu.hidden = true;
  picker.append(input, menu);
  field.append(picker);

  const applyTag = (tag) => {
    for (const target of targets || [dance]) {
      store.run({ op: "tag.add", slug: target.slug, tag });
    }
  };

  const fill = () => {
    const query = input.value.trim().toLowerCase();
    const own = dance ? dance.tags : [];
    menu.replaceChildren();

    for (const tag of store.list.tags.filter((t) => t.includes(query) && !own.includes(t)).slice(0, 40)) {
      const option = el("button");
      option.type = "button";
      option.append(el("span", null, tag), el("span", "n", `${store.tagCount(tag)} dances`));
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = "";
        applyTag(tag);
      });
      menu.append(option);
    }

    const invented = slugify(query);
    if (invented && !store.list.tags.includes(invented)) {
      const option = el("button", "coin");
      option.type = "button";
      option.append(
        el("span", null, `Create a new tag “${invented}”`),
        el("span", "n", "nothing carries it yet"),
      );
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = "";
        applyTag(invented);
      });
      menu.append(option);
    }

    menu.hidden = !menu.children.length;
  };

  input.addEventListener("input", fill);
  input.addEventListener("focus", fill);
  input.addEventListener("blur", () => setTimeout(() => (menu.hidden = true), 120));
  input.addEventListener("keydown", (event) => {
    // Enter takes an existing tag. Inventing one always costs a deliberate click.
    if (event.key !== "Enter") return;
    event.preventDefault();
    menu.querySelector("button:not(.coin)")?.dispatchEvent(new MouseEvent("mousedown"));
  });

  field.append(
    el(
      "p",
      "hint",
      "Pick from the tags already in use where you can. A new tag splits the list, so it takes a deliberate click to make one.",
    ),
  );
  return field;
}

/** The editor, rendered into the card itself so nothing moves under the cursor. */
export function renderOpenCard(card, store, dance, actions) {
  card.append(nameField(store, dance, actions.rerender));
  card.append(tagField(store, dance, null));
  card.append(
    el(
      "p",
      "hint",
      dance.isNew
        ? "The short name at the top was worked out from the first spelling you gave, and is now fixed. Every other spelling you add sits beside it as an equal."
        : "The short name at the top never changes, even if every spelling below is rewritten. That is what lets apps keep following this dance.",
    ),
  );
}

/**
 * Adding a dance asks for its name first.
 *
 * The short name is worked out from the first spelling and then never changes, so there is
 * exactly one moment at which it can be got right, and it is this one. Adding the dance first
 * and naming it afterwards leaves the wrong slug behind for good.
 */
export function newDanceDialog(dialog, store, created) {
  const body = dialog.querySelector(".dialog-body");
  body.replaceChildren();

  body.append(el("h2", null, "Add a dance"));
  body.append(
    el(
      "p",
      null,
      "Give the name you know it by. Its short name is worked out from that and then never " +
        "changes, so other spellings can be added afterwards without anything breaking.",
    ),
  );

  const field = el("div", "field");
  field.append(el("span", "eyebrow", "Its name"));

  const input = el("input", "name-of");
  input.type = "text";
  input.placeholder = "Rondeau de Samatan…";
  input.setAttribute("aria-label", "The name of the dance");
  field.append(input);

  const note = el("p", "note idle", "Whichever spelling you give is as good as any other.");
  field.append(note);
  body.append(field);

  const look = (value) => {
    if (!value) return { quiet: true };

    const owner = store.ownerOf(value, null);
    if (owner) {
      return {
        ok: false,
        message: `“${value}” already names ${owner.names[0]}, so that dance is already on the list.`,
      };
    }
    if (!slugify(value)) return { ok: false, message: "A name needs a letter or a number in it." };

    return { ok: true, message: `Its short name will be ${store.freeSlug(slugify(value))}.` };
  };

  const add = button("btn primary", "Add it", () => {
    const value = input.value.trim();
    if (!look(value).ok) return;

    const slug = store.freeSlug(slugify(value));
    store.run({ op: "dance.add", slug, names: [value], tags: [] });
    dialog.close();
    created(slug);
  });
  add.disabled = true;

  input.addEventListener("input", () => {
    const result = look(input.value.trim());
    note.className = "note " + (result.quiet ? "idle" : result.ok ? "ok" : "bad");
    note.textContent = result.quiet
      ? "Whichever spelling you give is as good as any other."
      : result.message;
    add.disabled = !result.ok;
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add.click();
  });

  const foot = el("div", "dialog-foot");
  foot.append(button("btn", "Cancel", () => dialog.close()), add);
  body.append(foot);

  dialog.showModal();
  input.focus();
}

export function bulkBar(store, picked, actions) {
  const chosen = [...picked].map((slug) => store.find(slug)).filter(Boolean);
  const bar = el("section", "bulk");

  const line = el("div", "bulk-line");
  line.append(
    el("strong", null, `${chosen.length} ${chosen.length === 1 ? "dance" : "dances"} selected`),
    el(
      "span",
      "hint",
      chosen.slice(0, 4).map((d) => d.names[0]).join(", ") +
        (chosen.length > 4 ? ` and ${chosen.length - 4} more` : ""),
    ),
    button("btn quiet", "Deselect all", actions.deselectAll),
  );
  bar.append(line);

  const shared = store.list.tags.filter((t) => chosen.every((d) => d.tags.includes(t)));
  if (shared.length) {
    const chips = el("div", "bulk-line");
    chips.append(el("span", "eyebrow", chosen.length === 1 ? "On it" : "On all"));
    for (const tag of shared) {
      const chip = el("span", "token tag");
      chip.append(document.createTextNode(tag));
      chip.append(
        button("x", "✕", () => {
          for (const dance of chosen) store.run({ op: "tag.remove", slug: dance.slug, tag });
        }, { label: `Remove ${tag} from all selected` }),
      );
      chips.append(chip);
    }
    bar.append(chips);
  }

  bar.append(tagField(store, null, chosen));
  return bar;
}

/**
 * A dance whose name turns out to cover several dances becomes a tag as well.
 *
 * The dance itself stays, always: retiring a slug is the one change that breaks everything
 * built on the list, so the editor does not offer it. The only real question is what happens
 * to the bare name, and that is asked rather than decided.
 */
export function familyDialog(dialog, store, dance) {
  const body = dialog.querySelector(".dialog-body");
  body.replaceChildren();

  const tagName = slugify(dance.names[0]);
  const bare = dance.names.find((n) => slugify(n) === tagName);
  let keepBare = true;

  body.append(el("h2", null, `Make ${dance.names[0]} a family`));
  body.append(
    el(
      "p",
      null,
      `Use this when a name turns out to cover several dances rather than one. It makes a tag ` +
        `called ${tagName} and puts it on this dance. The dance itself stays, so nothing that ` +
        `already points at it breaks. Add the other dances in the family the ordinary way and ` +
        `give them the same tag.`,
    ),
  );

  const tagField_ = el("div", "field");
  tagField_.append(el("span", "eyebrow", "Tag to create"));
  const tagInput = el("input", "name-of");
  tagInput.value = tagName;
  tagInput.setAttribute("aria-label", "Name of the new tag");
  tagField_.append(tagInput);
  if (store.list.tags.includes(tagName)) {
    tagField_.append(el("p", "note bad", "That tag already exists. It will simply be put on this dance."));
  }
  body.append(tagField_);

  if (bare) {
    const choice = el("div", "field");
    choice.append(el("span", "eyebrow", `The name “${bare}” itself`));

    const group = el("div", "choice");
    const option = (value, checked, title, why) => {
      const label = el("label");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "bare";
      radio.checked = checked;
      radio.addEventListener("change", () => (keepBare = value === "keep"));
      label.append(radio, el("strong", null, title), el("span", "why", why));
      group.append(label);
    };

    option(
      "keep",
      true,
      "Keep it on this dance",
      `Music labelled just “${bare}” still finds this dance, and this stays the one people mean when they do not say which.`,
    );
    option(
      "retire",
      false,
      "Retire it",
      `Nothing is called just “${bare}” any more. Music labelled that way finds no dance until somebody says which one it is.`,
    );

    choice.append(group);
    body.append(choice);
  }

  const foot = el("div", "dialog-foot");
  foot.append(
    button("btn", "Cancel", () => dialog.close()),
    button("btn primary", "Make it a family", () => {
      const tag = slugify(tagInput.value) || tagName;
      store.run({ op: "tag.add", slug: dance.slug, tag });
      if (bare && !keepBare) {
        store.run({ op: "name.remove", slug: dance.slug, value: bare });
      }
      dialog.close();
    }),
  );
  body.append(foot);
  dialog.showModal();
}

const capitalise = (value) => value.charAt(0).toUpperCase() + value.slice(1) + ".";
