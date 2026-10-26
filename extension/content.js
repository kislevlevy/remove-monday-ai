/* global browser, chrome */
(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const key = "hideMondayAI";
  let enabled = true;
  let revision = 0;

  function apply() {
    document.documentElement?.toggleAttribute("data-monday-ai-visible", !enabled);
  }

  // Register before reading storage: a toggle during startup must win over a stale read.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(key in changes)) return;
    revision += 1;
    enabled = changes[key].newValue !== false;
    apply();
  });

  const initialRevision = revision;
  api.storage.local.get(key).then((state) => {
    if (revision !== initialRevision) return;
    enabled = state[key] !== false;
    apply();
  }).catch((error) => console.error("Remove Monday AI: could not read setting", error));

  // document_start can run before <html> exists.
  if (document.documentElement) {
    apply();
  } else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      apply();
      observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
})();
