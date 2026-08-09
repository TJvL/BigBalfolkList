// What the page does.
//
// One state object, one render. Every change goes through store.run(), which records the
// intent and saves the draft, so nothing here has to remember to keep those in step.

import { $, button, el } from "./dom.js";
import { fold, slugify } from "./fold.js";
import { since } from "./draft.js";
import { createStore } from "./store.js";
import { matches, renderCard, renderCloud } from "./browse.js";
import { bulkBar, familyDialog, renderOpenCard } from "./editor.js";
import { renderTags } from "./tags.js";
import * as github from "./github.js";
import * as config from "./config.js";

const ui = {
  editing: false,
  view: "dances",
  expanded: null,
  picked: new Set(),
  selected: new Set(),
  combine: "any",
  query: "",
  tagFilter: "",
};

let store;
let openSuggestions = [];
let editable = true;

const actions = {
  toggleTag(tag) {
    ui.selected.has(tag) ? ui.selected.delete(tag) : ui.selected.add(tag);
    render();
  },
  expand(slug) {
    ui.expanded = slug;
    render();
  },
  deselectAll() {
    ui.picked.clear();
    render();
  },
  filterTags(value) {
    ui.tagFilter = value.trim().toLowerCase();
    render();
    const again = document.querySelector(".tagbar input");
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  },
  rerender(after) {
    render();
    if (after) requestAnimationFrame(after);
  },
};

// ---------- rendering ----------

function card(dance, index) {
  const open = ui.editing && ui.expanded === dance.slug;
  const node = el("article", "card");
  node.style.animationDelay = Math.min(index, 24) * 8 + "ms";
  if (open) node.classList.add("open");
  if (ui.picked.has(dance.slug)) node.classList.add("picked");
  if (ui.editing && touched(dance)) node.classList.add("touched");

  const slug = el("div", "slug");
  const identity = el("span", "slug-text", dance.slug);
  identity.title = dance.slug;
  slug.append(identity);
  if (open) {
    slug.append(el("span", "fixed", dance.isNew ? "name settled when merged" : "permanent"));
  }
  node.append(slug);

  if (ui.editing) {
    const acts = el("div", "card-acts");

    if (!open) {
      acts.append(
        button(null, "edit", () => actions.expand(dance.slug), {
          title: "Open this dance for editing",
        }),
      );
    }

    acts.append(
      button(null, ui.picked.has(dance.slug) ? "selected" : "select", () => {
        ui.picked.has(dance.slug) ? ui.picked.delete(dance.slug) : ui.picked.add(dance.slug);
        render();
      }, { pressed: ui.picked.has(dance.slug) }),
    );

    if (open) {
      acts.append(
        button(null, "make a tag", () => familyDialog($("family"), store, dance), {
          title: "This name covers several dances, not one",
        }),
        button(null, "delete", () => {
          store.run({ op: "dance.remove", slug: dance.slug });
          ui.expanded = null;
          render();
        }),
        button(null, "close", () => {
          ui.expanded = null;
          render();
        }),
      );
    }

    node.append(acts);
  }

  if (open) renderOpenCard(node, store, dance, actions);
  else renderCard(node, store, dance, ui, actions);

  return node;
}

function touched(dance) {
  const before = store.published.dances.find((d) => d.slug === dance.slug);
  if (!before) return true;
  return (
    before.names.join("|") !== dance.names.join("|") || before.tags.join("|") !== dance.tags.join("|")
  );
}

function render() {
  document.body.classList.toggle("editing", ui.editing);
  $("tray").hidden = !ui.editing;
  $("views").hidden = !ui.editing;
  $("strap").hidden = ui.editing;

  const tagsView = ui.editing && ui.view === "tags";
  $("searchbox").hidden = tagsView;
  $("shell").classList.toggle("wide", tagsView);
  $("rail").hidden = tagsView;

  const main = $("main");
  main.replaceChildren();

  if (tagsView) {
    main.append(renderTags(store, ui, actions));
    $("tally").innerHTML = `<b>${store.list.tags.length}</b> tags`;
    renderTray();
    return;
  }

  if (ui.editing && ui.picked.size) main.append(bulkBar(store, ui.picked, actions));

  const shown = store.list.dances.filter((d) => matches(store, d, ui));
  if (ui.expanded && !shown.some((d) => d.slug === ui.expanded)) ui.expanded = null;

  const grid = el("div", "grid");
  shown.forEach((dance, i) => grid.append(card(dance, i)));
  main.append(grid);

  if (!shown.length) {
    main.append(el("div", "empty", "Nothing under that combination. Try any instead of all."));
  }

  renderCloud($("cloud"), store, ui, actions);
  $("clear").hidden = ui.selected.size === 0;

  const filtering = ui.selected.size || ui.query;
  $("tally").innerHTML = filtering
    ? `<b>${shown.length}</b> of ${store.list.dances.length} dances`
    : `<b>${store.list.dances.length}</b> dances · <b>${store.list.tags.length}</b> tags`;
  $("qclear").hidden = !ui.query;

  renderTray();
}

function renderTray() {
  const changes = store.changes();
  $("tray-count").innerHTML = `<b>${changes.length}</b> change${changes.length === 1 ? "" : "s"}`;
  $("propose").disabled = changes.length === 0;
  $("discard").disabled = changes.length === 0;
  $("draft").hidden = changes.length === 0;

  const list = $("log");
  list.replaceChildren();
  for (const change of [...changes].reverse()) {
    const item = el("li");
    item.append(el("span", "verb", change.verb), el("span", null, change.text));
    list.append(item);
  }
}

/** A resumed draft says what it could not put back, rather than dropping it in silence. */
function renderResumed() {
  const banner = $("resumed");
  if (!store.intents.length && !store.stale.length) return (banner.hidden = true);
  if (!store.resumedAt) return (banner.hidden = true);

  banner.replaceChildren();
  banner.append(
    el(
      "p",
      null,
      `Picked up where you left off ${since(store.resumedAt)}, on the list as it stands now.`,
    ),
  );

  if (store.stale.length) {
    const list = el("ul", "stale");
    for (const { intent, reason } of store.stale) {
      list.append(el("li", null, `${describeShort(intent)} — ${reason}`));
    }
    banner.append(
      el("p", "stale-head", `${store.stale.length} of your changes no longer fit and were left out:`),
      list,
    );
  }

  banner.append(
    button("btn quiet", "Got it", () => {
      store.dismissStale();
      banner.hidden = true;
    }),
  );
  banner.hidden = false;
}

const describeShort = (intent) =>
  intent.op.startsWith("name")
    ? `${intent.value} on ${intent.slug}`
    : intent.op.startsWith("tag")
      ? `${intent.tag || intent.from} on ${intent.slug || "the tag list"}`
      : intent.slug;

// ---------- the proposal ----------

const jsonLine = (dance) =>
  "  " + JSON.stringify({ slug: dance.slug, names: dance.names, tags: dance.tags }) + ",";

function buildDiff(against) {
  const diff = $("diff");
  const { rows, tagsChanged, before, after } = against || store.diff();

  diff.replaceChildren();
  diff.append(el("span", "file", "dances.json\n"));

  if (tagsChanged) {
    diff.append(el("span", "del", '-   "tags": ' + JSON.stringify(before) + ",\n"));
    diff.append(el("span", "add", '+   "tags": ' + JSON.stringify(after) + ",\n"));
  }

  for (const row of rows) {
    diff.append(el("span", row.kind, (row.kind === "del" ? "- " : "+ ") + jsonLine(row.dance) + "\n"));
  }

  if (!rows.length && !tagsChanged) diff.append(el("span", "file", "(nothing changed)"));
}

/**
 * Opening the dialog rebuilds the draft on the list as the server has it this second, so the
 * line promising exactly that is true rather than decorative.
 */
/** Which open pull request these changes join, or none for a fresh one. */
let target = null;

async function openProposal() {
  buildDiff();
  $("pr-go").disabled = false;
  $("pr").showModal();

  await renderWhere();
  await refreshProposal();
}

/**
 * Somebody with a suggestion still open usually means the follow-up to belong to it. Offering
 * both beats guessing: a second pull request is right when the subjects are unrelated, and
 * wrong when it is more of the same.
 */
async function renderWhere() {
  const where = $("where");
  where.hidden = true;
  where.replaceChildren();

  // Editing a suggestion: there is nowhere else these could go.
  if (store.suggestion) {
    target = store.suggestion;
    where.append(
      el("span", "eyebrow", "Where these go"),
      el("p", "hint", `Onto suggestion #${store.suggestion.number}, which is what you have been editing.`),
    );
    where.hidden = false;
    return;
  }

  if (!github.signedIn()) return;

  let mine = [];
  try {
    mine = (await github.suggestions()).filter(github.mine);
  } catch (error) {
    return;
  }
  if (!mine.length) return;

  target = mine[0];
  where.append(el("span", "eyebrow", "Where these go"));

  const group = el("div", "choice");
  const option = (value, checked, title, why) => {
    const label = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "where";
    radio.checked = checked;
    radio.addEventListener("change", () => {
      target = value;
      refreshProposal();
    });
    label.append(radio, el("strong", null, title), el("span", "why", why));
    group.append(label);
  };

  for (const suggestion of mine) {
    option(
      suggestion,
      suggestion === target,
      `Add to your open suggestion #${suggestion.number}`,
      suggestion.title,
    );
  }
  option(null, false, "Open a separate pull request", "For changes that have nothing to do with the above.");

  where.append(group);
  where.hidden = false;
}

/** Rebuild the diff against whatever the changes are going to be added to. */
async function refreshProposal() {
  const note = $("rebuilt");
  note.textContent = "Checking for changes by other people…";
  note.classList.remove("bad");

  try {
    const rebuilt = await github.rebuild(store.intents, target);
    buildDiff(compare(rebuilt.before, rebuilt.list));

    const { stale } = rebuilt;
    const base = target
      ? `your open suggestion #${target.number}`
      : "the list as it stands right now";
    note.textContent = stale.length
      ? `Rebuilt on ${base}. ${stale.length} of your changes no longer fit and will be left out.`
      : `Rebuilt a moment ago on ${base}, so anything that changed while you were working is already in.`;
    note.classList.toggle("bad", stale.length > 0);
    $("pr-go").textContent = target ? `Add to #${target.number}` : "Open pull request";
  } catch (error) {
    // Rate limited, or offline. The proposal still works; it is the reassurance that does not.
    note.textContent = "Could not reach GitHub to check for newer changes. Yours are still fine to send.";
  }
}

async function openPullRequest() {
  const button_ = $("pr-go");
  const note = $("rebuilt");

  if (!config.canSignIn()) {
    note.textContent = "This copy of the site has no GitHub app set up yet, so use the other button for now.";
    note.classList.add("bad");
    return;
  }

  button_.disabled = true;
  try {
    if (!github.signedIn()) {
      // Leaves the page. The draft is in localStorage, so it is waiting on the way back.
      github.signIn();
      return;
    }

    button_.textContent = target ? "Adding…" : "Opening…";
    const { opened, stale, added } = await github.propose(store.intents, target);

    if (!opened) {
      note.textContent = "None of your changes still apply to the list. Nothing was sent.";
      note.classList.add("bad");
      return;
    }

    store.discard();
    $("pr").close();
    showOpened(opened.html_url, stale.length, added, opened.number);
  } catch (error) {
    note.textContent = error.message;
    note.classList.add("bad");
  } finally {
    button_.disabled = false;
    button_.textContent = target ? `Add to #${target.number}` : "Open pull request";
  }
}

function showOpened(url, leftOut, added, number) {
  const banner = $("resumed");
  banner.replaceChildren();
  banner.append(el("p", null, "Sent. Thank you."));

  const link = el("a", null, `suggestion #${number}`);
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";

  const line = el("p", null, added ? "Added to " : "Someone will look at it: ");
  line.append(link);
  banner.append(line);

  if (leftOut) {
    banner.append(el("p", "stale-head", `${leftOut} changes were left out because the list had moved on.`));
  }

  banner.append(button("btn quiet", "Got it", () => (banner.hidden = true)));
  banner.hidden = false;
}

/** The same shape store.diff() returns, for any two versions of the list. */
function compare(before, after) {
  const was = new Map(before.dances.map((d) => [d.slug, d]));
  const is = new Map(after.dances.map((d) => [d.slug, d]));
  const same = (a, b) =>
    a && b && a.names.join("|") === b.names.join("|") && a.tags.join("|") === b.tags.join("|");

  const rows = [];
  for (const [slug, dance] of is) {
    if (same(was.get(slug), dance)) continue;
    if (was.has(slug)) rows.push({ kind: "del", dance: was.get(slug) });
    rows.push({ kind: "add", dance });
  }
  for (const [slug, dance] of was) {
    if (!is.has(slug)) rows.push({ kind: "del", dance });
  }

  return {
    rows,
    tagsChanged: before.tags.join("|") !== after.tags.join("|"),
    before: before.tags,
    after: after.tags,
  };
}

// ---------- wiring ----------

function setMode(editing) {
  // Somebody else's suggestion is theirs to change, so it can be read and nothing else.
  ui.editing = editing && editable;
  $("mode-edit").disabled = !editable;
  $("mode-edit").title = editable ? "" : "Only the person who made this suggestion can change it";
  if (!editing) {
    ui.expanded = null;
    ui.picked.clear();
    ui.view = "dances";
  }
  $("mode-browse").setAttribute("aria-pressed", String(!editing));
  $("mode-edit").setAttribute("aria-pressed", String(editing));
  setView(ui.view);
}

function setView(view) {
  ui.view = view;
  $("view-dances").setAttribute("aria-pressed", String(view === "dances"));
  $("view-tags").setAttribute("aria-pressed", String(view === "tags"));
  render();
}

function setCombine(combine) {
  ui.combine = combine;
  $("combine-any").setAttribute("aria-pressed", String(combine === "any"));
  $("combine-all").setAttribute("aria-pressed", String(combine === "all"));
  render();
}

function theme() {
  const box = $("theme");
  const read = () => {
    try {
      return localStorage.getItem("bigbalfolklist.theme") || "system";
    } catch (error) {
      return "system";
    }
  };

  const paint = (choice) => {
    if (choice === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", choice);
    for (const node of box.querySelectorAll("button")) {
      node.setAttribute("aria-pressed", String(node.dataset.themeChoice === choice));
    }
  };

  for (const node of box.querySelectorAll("button")) {
    node.addEventListener("click", () => {
      const choice = node.dataset.themeChoice;
      try {
        if (choice === "system") localStorage.removeItem("bigbalfolklist.theme");
        else localStorage.setItem("bigbalfolklist.theme", choice);
      } catch (error) {
        /* the choice still applies for this visit */
      }
      paint(choice);
    });
  }

  paint(read());
}

function wire() {
  $("mode-browse").addEventListener("click", () => setMode(false));
  $("mode-edit").addEventListener("click", () => setMode(true));

  $("source").addEventListener("change", async (event) => {
    const chosen = openSuggestions.find((s) => String(s.number) === event.target.value);
    try {
      await load(chosen || null);
      render();
    } catch (error) {
      event.target.value = store.suggestion ? String(store.suggestion.number) : "main";
      console.error(error);
    }
  });
  $("view-dances").addEventListener("click", () => setView("dances"));
  $("view-tags").addEventListener("click", () => setView("tags"));
  $("combine-any").addEventListener("click", () => setCombine("any"));
  $("combine-all").addEventListener("click", () => setCombine("all"));

  $("q").addEventListener("input", (event) => {
    ui.query = fold(event.target.value);
    render();
  });
  $("qclear").addEventListener("click", () => {
    $("q").value = "";
    ui.query = "";
    $("q").focus();
    render();
  });
  $("clear").addEventListener("click", () => {
    ui.selected.clear();
    render();
  });

  $("new-dance").addEventListener("click", () => {
    const names = ["Untitled dance"];
    const slug = store.freeSlug(slugify(names[0]));
    store.run({ op: "dance.add", slug, names, tags: [] });
    ui.expanded = slug;
    ui.picked.clear();
    ui.selected.clear();
    ui.query = "";
    $("q").value = "";
    render();
  });

  $("toggle-log").addEventListener("click", () => {
    const log = $("tray-log");
    log.hidden = !log.hidden;
    $("toggle-log").textContent = log.hidden ? "Show changes" : "Hide changes";
  });

  $("discard").addEventListener("click", () => {
    const count = store.changes().length;
    $("confirm-what").textContent =
      count === 1
        ? "One change goes, and the list returns to how you found it."
        : `${count} changes go, and the list returns to how you found it.`;
    $("confirm").showModal();
  });
  $("confirm-no").addEventListener("click", () => $("confirm").close());
  $("confirm-yes").addEventListener("click", () => {
    $("confirm").close();
    store.discard();
  });

  $("propose").addEventListener("click", openProposal);
  $("pr-cancel").addEventListener("click", () => $("pr").close());
  $("pr-go").addEventListener("click", openPullRequest);

  $("pr-issue").addEventListener("click", () => {
    // No sign-in, no fork, no branch: the words go to a maintainer to apply.
    window.open(github.issueUrl(store.intents), "_blank", "noreferrer");
    $("pr").close();
  });
}

/**
 * Load a version of the list: the published one, or what a suggestion proposes.
 * Anyone may look at any of them; whether they may change it is decided separately.
 */
async function load(suggestion) {
  store = await createStore(suggestion);
  editable = await github.mayEdit(suggestion);

  if (!editable) {
    ui.editing = false;
    ui.expanded = null;
    ui.picked.clear();
  }

  store.subscribe(render);
  target = suggestion || null;
  renderSource();
  renderBranchBanner();
  setMode(ui.editing && editable);
  renderResumed();
}

function renderSource() {
  const select = $("source");
  select.replaceChildren();

  const published = new Option("the published list", "main", true, !store.suggestion);
  select.append(published);

  for (const suggestion of openSuggestions) {
    const label = `#${suggestion.number} · ${suggestion.title}`;
    select.append(
      new Option(
        label.length > 34 ? label.slice(0, 33) + "…" : label,
        String(suggestion.number),
        false,
        store.suggestion?.number === suggestion.number,
      ),
    );
  }

  $("viewing").hidden = openSuggestions.length === 0;
}

function renderBranchBanner() {
  const banner = $("on-branch");
  const inner = banner.querySelector(".inner");
  inner.replaceChildren();

  if (!store.suggestion) return (banner.hidden = true);

  const suggestion = store.suggestion;
  inner.append(
    el("span", null, `You are looking at suggestion #${suggestion.number}, by ${suggestion.author}, as it currently stands.`),
  );

  const link = el("a", null, "see it on GitHub");
  link.href = suggestion.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  inner.append(link);

  inner.append(
    el(
      "span",
      "locked",
      editable
        ? "you can change this one"
        : github.signedIn()
          ? "read only — it is not yours"
          : "read only — sign in if it is yours",
    ),
  );

  banner.hidden = false;
}

async function start() {
  try {
    // Before anything is drawn, so the switcher is complete the first time it appears.
    openSuggestions = await github.suggestions().catch(() => []);
    store = await createStore();
  } catch (error) {
    $("main").replaceChildren(
      el("div", "empty", "The list could not be loaded. Reload the page, or try again shortly."),
    );
    console.error(error);
    return;
  }

  wire();
  theme();
  store.subscribe(render);
  renderSource();
  renderResumed();
  render();

  // Coming back from GitHub: finish the sign-in, then carry straight on to the pull request
  // the contributor was in the middle of making.
  try {
    if (await github.completeSignIn()) {
      openSuggestions = await github.suggestions().catch(() => []);
      editable = await github.mayEdit(store.suggestion);
      renderSource();
      renderBranchBanner();
      setMode(true);
      if (store.intents.length) openProposal();
    }
  } catch (error) {
    console.error(error);
  }
}

start();
