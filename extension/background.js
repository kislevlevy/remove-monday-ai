/* global browser, chrome */
const api = typeof browser !== "undefined" ? browser : chrome;
const STORAGE_KEY = "hideMondayAI";
let pending = Promise.resolve();

// Serialize clicks so even a quick double click toggles twice.
function enqueue(operation) {
  pending = pending.then(operation).catch((error) => {
    console.error("Remove Monday AI:", error);
  });
}

async function isEnabled() {
  const state = await api.storage.local.get(STORAGE_KEY);
  return state[STORAGE_KEY] !== false;
}

async function updateAction(enabled) {
  await Promise.all([
    api.action.setBadgeText({ text: enabled ? "ON" : "OFF" }),
    api.action.setBadgeBackgroundColor({ color: enabled ? "#176b46" : "#616776" }),
    api.action.setTitle({
      title: enabled
        ? "Monday AI controls are hidden — click to show"
        : "Monday AI controls are visible — click to hide"
    })
  ]);
}

const refreshAction = async () => updateAction(await isEnabled());

api.action.onClicked.addListener(() => {
  enqueue(async () => {
    const enabled = !(await isEnabled());
    await api.storage.local.set({ [STORAGE_KEY]: enabled });
    await updateAction(enabled);
  });
});
api.runtime.onInstalled.addListener(() => enqueue(refreshAction));
api.runtime.onStartup.addListener(() => enqueue(refreshAction));
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) enqueue(refreshAction);
});
enqueue(refreshAction);
