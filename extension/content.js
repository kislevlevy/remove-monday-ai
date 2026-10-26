/* global browser, chrome */
(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const key = "hideMondayAI";
  let enabled = true;
  let revision = 0;

  const headerSelector = '[data-testid="collapsible-section"]';
  const aiSectionSelector = '[data-testid="collapsible-monday-ai-section"]';
  const adjustedHeaderAttribute = "data-monday-ai-adjusted-header";
  const stickyTopProperty = "--monday-ai-sticky-top";

  function adjustHeader(header) {
    // Monday's sticky offsets include a 44px AI header, even when CSS hides it.
    // Keep its inline top untouched so toggling off restores the native layout.
    let preceding = header.parentElement?.previousElementSibling;
    while (preceding && !preceding.matches(aiSectionSelector)) {
      preceding = preceding.previousElementSibling;
    }
    const originalTop = header.style.top;
    if (!preceding || !/^-?\d+(\.\d+)?px$/.test(originalTop)) {
      header.removeAttribute(adjustedHeaderAttribute);
      header.style.removeProperty(stickyTopProperty);
      return;
    }
    const adjustedTop = `${Math.max(0, parseFloat(originalTop) - 44)}px`;
    if (header.style.getPropertyValue(stickyTopProperty) !== adjustedTop) {
      header.style.setProperty(stickyTopProperty, adjustedTop);
    }
    header.setAttribute(adjustedHeaderAttribute, "");
  }

  function adjustSidebarHeaders() {
    document.querySelectorAll(headerSelector).forEach(adjustHeader);
  }

  // Follow sidebar remounts and Monday's own offset updates, without scanning
  // the document on scrolling, board edits, or unrelated style changes.
  const sidebarObserver = new MutationObserver((mutations) => {
    let rescan = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target.matches(headerSelector)) adjustHeader(mutation.target);
      } else {
        const relevant = `${headerSelector}, ${aiSectionSelector}`;
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
          if (node.nodeType === 1 && (node.matches(relevant) || node.querySelector(relevant))) {
            rescan = true;
            break;
          }
        }
      }
    }
    if (rescan) adjustSidebarHeaders();
  });
  sidebarObserver.observe(document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["style"]
  });
  adjustSidebarHeaders();

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
