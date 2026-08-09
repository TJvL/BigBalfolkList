// Small helpers, so the views read as what they build rather than as DOM calls.

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(className, text, onClick, options = {}) {
  const node = el("button", className, text);
  node.type = "button";
  if (options.title) node.title = options.title;
  if (options.label) node.setAttribute("aria-label", options.label);
  if (options.pressed !== undefined) node.setAttribute("aria-pressed", String(options.pressed));
  if (options.disabled) node.disabled = true;
  node.addEventListener("click", onClick);
  return node;
}

export const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
