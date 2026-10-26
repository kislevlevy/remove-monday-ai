import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const css = await read("extension/hide-ai.css");
const content = await read("extension/content.js");
const background = await read("extension/background.js");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function mockAPI(initial = {}) {
  const state = { ...initial };
  const listeners = { change: [], click: [], install: [], startup: [] };
  const badge = {};
  return {
    state, listeners, badge,
    storage: {
      local: {
        get: async () => ({ ...state }),
        set: async (values) => {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: state[key], newValue: value };
            state[key] = value;
          }
          listeners.change.forEach((listener) => listener(changes, "local"));
        }
      },
      onChanged: { addListener: (fn) => listeners.change.push(fn) }
    },
    action: {
      onClicked: { addListener: (fn) => listeners.click.push(fn) },
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
      setTitle: async ({ title }) => { badge.title = title; }
    },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.install.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) }
    }
  };
}

function mount(html, api, namespace = "chrome") {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.append(style);
  dom.window[namespace] = api;
  dom.window.eval(content);
  return dom;
}
const isHidden = (window, element) => {
  for (let node = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return true;
  }
  return false;
};

for (const [file, selector] of [
  ["agents", "#agents-button-tipseen-container"],
  ["vibe", '[data-testid="topbar-vibe"]'],
  ["sidebar", '[data-testid="collapsible-monday-ai-section"]'],
  ["sideckick", '[class*="sidekick-input-bar-module_islandWrapper__"]']
]) {
  test(`hides supplied ${file} example and restores it without replacing nodes`, async () => {
    const api = mockAPI();
    const dom = mount(await read(`.dev/to-remove/${file}.html`), api);
    try {
      await tick();
      const target = dom.window.document.querySelector(selector);
      assert.ok(target, "fixture target exists");
      assert.ok(isHidden(dom.window, target));
      await api.storage.local.set({ hideMondayAI: false });
      assert.equal(isHidden(dom.window, target), false);
      assert.equal(dom.window.document.querySelector(selector), target);
      await api.storage.local.set({ hideMondayAI: true });
      assert.ok(isHidden(dom.window, target));
    } finally { dom.window.close(); }
  });
}

test("saved homepage targets are hidden while navigation and content stay visible", async () => {
  const dom = mount(await read(".dev/examples/homepage.html"), mockAPI());
  try {
    await tick();
    for (const selector of [
      '[data-testid="topbar-vibe"]', '[data-testid="collapsible-monday-ai-section"]',
      '#agents-button-tipseen-container', '[class*="sidekick-input-bar-module_islandWrapper__"]'
    ]) {
      const element = dom.window.document.querySelector(selector);
      assert.ok(element, selector);
      assert.ok(isHidden(dom.window, element), selector);
    }
    for (const selector of ["#first-level-control", "#first-level-content"]) {
      assert.equal(isHidden(dom.window, dom.window.document.querySelector(selector)), false, selector);
    }
    const favorites = dom.window.document.querySelector('[data-testid="collapsible-favorites-section"] > [data-testid="collapsible-section"]');
    const workspace = dom.window.document.querySelector('[data-testid="collapsible-workspaces-section"] > [data-testid="collapsible-section"]');
    assert.equal(favorites.style.getPropertyValue("--monday-ai-sticky-top"), "0px");
    assert.equal(workspace.style.getPropertyValue("--monday-ai-sticky-top"), "44px");
  } finally { dom.window.close(); }
});

test("new React controls hide automatically; ordinary AI-related user content remains", async () => {
  const api = mockAPI();
  const dom = mount('<button id="normal">Email</button><a id="board">AI agents project</a>', api, "browser");
  try {
    await tick();
    const button = dom.window.document.createElement("button");
    button.setAttribute("aria-label", "Write with AI");
    dom.window.document.body.append(button);
    assert.ok(isHidden(dom.window, button));
    for (const id of ["normal", "board"]) {
      assert.equal(isHidden(dom.window, dom.window.document.getElementById(id)), false);
    }
    await api.storage.local.set({ hideMondayAI: false });
    assert.equal(isHidden(dom.window, button), false);
  } finally { dom.window.close(); }
});

test("toolbar toggles all tabs, persists across background restarts, and serializes rapid clicks", async () => {
  const api = mockAPI();
  const tabs = [mount('<div id="sidekick-pane">Sidekick</div>', api), mount('<div id="sidekick-pane">Sidekick</div>', api, "browser")];
  try {
    vm.runInNewContext(background, { chrome: api, console });
    await tick();
    assert.equal(api.badge.text, "ON");
    api.listeners.click[0]();
    await tick();
    assert.equal(api.state.hideMondayAI, false);
    assert.equal(api.badge.text, "OFF");
    for (const dom of tabs) assert.equal(isHidden(dom.window, dom.window.document.getElementById("sidekick-pane")), false);
    const restarted = mockAPI(api.state);
    vm.runInNewContext(background, { browser: restarted, console });
    await tick();
    assert.equal(restarted.badge.text, "OFF");
    api.listeners.click[0]();
    api.listeners.click[0]();
    await tick();
    assert.equal(api.state.hideMondayAI, false);
    api.listeners.click[0]();
    await tick();
    assert.equal(api.badge.text, "ON");
    for (const dom of tabs) assert.ok(isHidden(dom.window, dom.window.document.getElementById("sidekick-pane")));
  } finally { tabs.forEach((dom) => dom.window.close()); }
});

test("storage changes during initialization win over the initial read", async () => {
  const api = mockAPI();
  let resolveRead;
  api.storage.local.get = () => new Promise((resolve) => { resolveRead = resolve; });
  const dom = mount('<div id="sidekick-pane">Sidekick</div>', api);
  try {
    await api.storage.local.set({ hideMondayAI: false });
    resolveRead({ hideMondayAI: true });
    await tick();
    assert.equal(isHidden(dom.window, dom.window.document.getElementById("sidekick-pane")), false);
  } finally { dom.window.close(); }
});

test("clearing the setting returns to hidden and unrelated storage changes have no effect", async () => {
  const api = mockAPI({ hideMondayAI: false });
  const dom = mount('<div id="sidekick-pane">Sidekick</div>', api);
  try {
    await tick();
    api.listeners.change.forEach((fn) => fn({ hideMondayAI: { newValue: true } }, "sync"));
    assert.ok(dom.window.document.documentElement.hasAttribute("data-monday-ai-visible"));
    api.listeners.change.forEach((fn) => fn({ hideMondayAI: { oldValue: false } }, "local"));
    assert.equal(dom.window.document.documentElement.hasAttribute("data-monday-ai-visible"), false);
  } finally { dom.window.close(); }
});

function sidebarMarkup(extraSection = "") {
  return `<nav data-testid="leftpane"><div class="scroll-container">
    <div data-testid="collapsible-monday-ai-section"><div data-testid="collapsible-section" style="top: 0px">monday AI</div></div>
    <div data-testid="collapsible-favorites-section"><div data-testid="collapsible-section" style="position: sticky; top: 44px">Favorites</div></div>
    ${extraSection}
    <div data-testid="collapsible-workspaces-section"><div data-testid="collapsible-section" style="position: sticky; top: ${extraSection ? 132 : 88}px">Workspaces</div></div>
  </div></nav>`;
}

const adjustedTop = (header) => header.style.getPropertyValue("--monday-ai-sticky-top");

test("sidebar sticky offsets exclude the hidden AI header and release when toggled off", async () => {
  const api = mockAPI();
  const dom = mount(sidebarMarkup(), api);
  try {
    await tick();
    const doc = dom.window.document;
    const favorites = doc.querySelector('[data-testid="collapsible-favorites-section"] > div');
    const workspace = doc.querySelector('[data-testid="collapsible-workspaces-section"] > div');
    assert.equal(adjustedTop(favorites), "0px", "no transparent gap above Favorites");
    assert.equal(adjustedTop(workspace), "44px", "workspace sticks below Favorites");
    assert.equal(workspace.style.position, "sticky");
    assert.equal(favorites.style.top, "44px");
    assert.equal(workspace.style.top, "88px");
    const rule = [...doc.styleSheets[0].cssRules].find((rule) => rule.selectorText?.includes("data-monday-ai-adjusted-header"));
    assert.ok(workspace.matches(rule.selectorText));
    assert.equal(rule.style.getPropertyPriority("top"), "important");
    await api.storage.local.set({ hideMondayAI: false });
    assert.equal(workspace.matches(rule.selectorText), false, "native inline offsets apply when AI is visible");
    await api.storage.local.set({ hideMondayAI: true });
    assert.ok(workspace.matches(rule.selectorText));
  } finally { dom.window.close(); }
});

test("sidebar handles remounts, custom sections, and Monday updating offsets", async () => {
  const dom = mount("<main></main>", mockAPI());
  try {
    dom.window.document.body.insertAdjacentHTML("beforeend", sidebarMarkup('<div data-testid="collapsible-custom-section"><div data-testid="collapsible-section" style="top: 88px">Custom</div></div>'));
    await tick();
    const doc = dom.window.document;
    const custom = doc.querySelector('[data-testid="collapsible-custom-section"] > div');
    const workspace = doc.querySelector('[data-testid="collapsible-workspaces-section"] > div');
    assert.equal(adjustedTop(custom), "44px");
    assert.equal(adjustedTop(workspace), "88px");
    workspace.style.top = "176px";
    await tick();
    assert.equal(adjustedTop(workspace), "132px");
    workspace.style.backgroundPositionY = "-300px";
    await tick();
    assert.equal(adjustedTop(workspace), "132px", "scroll background updates must not subtract twice");
    doc.querySelector('[data-testid="collapsible-monday-ai-section"]').remove();
    await tick();
    assert.equal(adjustedTop(workspace), "");
    assert.equal(workspace.hasAttribute("data-monday-ai-adjusted-header"), false);
    assert.equal(workspace.style.top, "176px");
  } finally { dom.window.close(); }
});

test("layouts without an AI section keep their native sticky offsets", async () => {
  const dom = mount('<div><div data-testid="collapsible-workspaces-section"><div data-testid="collapsible-section" style="top: 44px">Workspaces</div></div></div>', mockAPI());
  try {
    await tick();
    const header = dom.window.document.querySelector('[data-testid="collapsible-section"]');
    assert.equal(adjustedTop(header), "");
    assert.equal(header.style.top, "44px");
    assert.equal(header.hasAttribute("data-monday-ai-adjusted-header"), false);
  } finally { dom.window.close(); }
});
