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
async function openProposal() {
  const note = $("rebuilt");
  buildDiff();
  $("pr-go").disabled = false;
  $("pr").showModal();

  note.textContent = "Checking the list for changes by other people…";
  note.classList.remove("bad");

  try {
    const rebuilt = await github.rebuild(store.intents);
    buildDiff(compare(rebuilt.before, rebuilt.list));
    const { stale } = rebuilt;
    note.textContent = stale.length
      ? `Rebuilt on the list as it stands right now. ${stale.length} of your changes no longer fit and will be left out.`
      : "Rebuilt a moment ago on the list as it stands right now, so anything other people changed while you were working is already in.";
    note.classList.toggle("bad", stale.length > 0);
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

    button_.textContent = "Opening…";
    const { opened, stale } = await github.propose(store.intents);

    if (!opened) {
      note.textContent = "None of your changes still apply to the list. Nothing was sent.";
      note.classList.add("bad");
      return;
    }

    store.discard();
    $("pr").close();
    showOpened(opened.html_url, stale.length);
  } catch (error) {
    note.textContent = error.message;
    note.classList.add("bad");
  } finally {
    button_.disabled = false;
    button_.textContent = "Open pull request";
  }
}

function showOpened(url, leftOut) {
  const banner = $("resumed");
  banner.replaceChildren();
  banner.append(el("p", null, "Sent. Thank you."));

  const link = el("a", null, url.split("/").slice(-2).join(" #").replace("pull #", "pull request #"));
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";

  const line = el("p", null, "Someone will look at it: ");
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
  ui.editing = editing;
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

async function start() {
  try {
    store = await createStore();
  } catch (error) {
    $("main").replaceChildren(
      el("div", "empty", "The list could not be loaded. Reload the page, or try again shortly."),
    );
    console.error(error);
    return;
  }

  store.subscribe(render);
  wire();
  theme();
  renderResumed();
  render();

  // Coming back from GitHub: finish the sign-in, then carry straight on to the pull request
  // the contributor was in the middle of making.
  try {
    if (await github.completeSignIn()) {
      ui.editing = true;
      setMode(true);
      if (store.intents.length) openProposal();
    }
  } catch (error) {
    console.error(error);
  }
}

start();
