# Remove Monday AI

A Chrome and Firefox extension that hides Monday.com's AI controls by default.
Click its toolbar icon to show them; click again to hide them. The **ON** badge
means hiding is enabled, and **OFF** means the original UI is visible. The setting
applies to all open Monday tabs and is saved locally across browser restarts.

## Install in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this project's `extension` folder
   (or `dist/chrome` if you have built it).
3. Pin **Remove Monday AI** from the extensions menu.
4. Reload any Monday tabs that were already open when you installed it.

## Install in Firefox

The generated Firefox package is already in `dist/firefox`. To regenerate it,
install development dependencies with `pnpm install`, then run `npm run build`
with Node.js 22 or later.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `dist/firefox/manifest.json`.
3. Pin **Remove Monday AI** to the toolbar from the extensions menu.
4. Allow access to Monday.com if Firefox asks, then reload existing Monday tabs.

Firefox temporary add-ons are removed when Firefox closes. For permanent
installation in standard Firefox, the Firefox package must be signed by Mozilla
(for example, through an unlisted AMO submission). The generated package is unsigned.
Firefox 142 or later is supported.

## What it hides

The rules cover the supplied `.dev/to-remove` examples:

- The entire **monday AI** sidebar section, including Sidekick, Vibe, and Agents.
- The **Agents** board button and **Vibe** topbar button.
- The floating **Sidekick** input bar and Sidekick panes.

They also cover the AI credits widget, agent board CTA, AI wand/ask containers,
and buttons with specific AI action labels such as “Ask AI” and “Write with AI”.
CSS applies automatically as Monday renders new controls or changes pages.
Toggling off restores the existing elements without reloading or deleting them.
The content script also corrects the sidebar's sticky header offsets to exclude
the hidden 44px AI header. This removes the gap above Favorites and keeps the
workspace header below the remaining section headers while scrolling. Monday's
original offsets apply again when hiding is toggled off.

The extension uses targeted Monday identifiers and action labels. It does not
scan board names, messages, or arbitrary text for the word “AI”. Monday may add
new AI controls or change its markup; add corresponding selectors to
`extension/hide-ai.css` when that happens. Coverage beyond the supplied snapshots
has not been verified against a signed-in live Monday account.

## Privacy and permissions

The extension runs only on HTTPS `monday.com` and its subdomains, including matching
frames. Its only API permission is `storage`, used for the toggle. It sends no
requests, collects no data, and includes no analytics or runtime dependencies.
Hiding controls is cosmetic; it does not change Monday account settings or disable
server-side AI features.

## Package for submission

Install development dependencies with `pnpm install`, then run:

```sh
pnpm run package
```

`npm run package` also works after dependencies are installed. The script rebuilds
both browsers and creates these files in `dist/packages`, using the version from
`extension/manifest.json`:

- `remove-monday-ai-1.0.0-firefox.zip`: upload to Mozilla Add-ons for review and signing.
- `remove-monday-ai-1.0.0-chrome.crx`: signed CRX3 package for Chrome distribution.
- `remove-monday-ai-1.0.0-chrome.zip`: upload to the Chrome Web Store.

The ZIPs contain `manifest.json` at their root and only the built extension files.
The `.dev` snapshots, tests, dependencies, and signing key are excluded.
Firefox submission ZIPs are unsigned; Mozilla provides the signed package after
submission. Chrome Web Store uploads use the ZIP, as described in its
[publishing instructions](https://developer.chrome.com/docs/webstore/publish).
A locally signed CRX does not have a Chrome Web Store signature; its installation
depends on Chrome's distribution policies.

On the first run, the script creates `.keys/chrome.pem` with private file
permissions. It reuses that key on later runs to keep the CRX extension ID stable.
The key and generated packages are ignored by Git. Back up the key privately;
deleting it causes the next default build to generate a new extension identity.

To use an existing RSA private key or choose a different output directory:

```sh
pnpm run package --key /path/to/existing-chrome.pem --out-dir /path/to/packages
```

An explicit `--key` must already exist; the script fails if it is missing or invalid.
`node scripts/package.mjs --help` lists the options. Packaging requires Node.js 22
or later and does not require Chrome, Firefox, or a system ZIP utility.

## Development

`extension/icons/2.svg` is the hidden-state icon and `extension/icons/1.svg` is
the visible-state icon. Every build generates PNG versions of both using
`scripts/generate-icons.mjs`. The toolbar switches icons along with the toggle;
the extension listing uses the hidden-state icon. Generated PNGs are also kept
in `extension/icons` so Chrome can load the source folder directly.

```sh
pnpm install
npm test
npm run check
npm run build
```

`extension/manifest.json` is the Chrome source manifest. The build copies the
extension into `dist/chrome` and `dist/firefox`, replacing the background service
worker declaration with a background script declaration for Firefox. These browser
background contexts are documented in [MDN's background manifest reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

Tests exercise all four removal fragments, the saved homepage, dynamic controls,
restoration, multi-tab updates, saved state, rapid toolbar clicks, and initialization
races. DOM tests use mocked extension APIs; they do not install the extension in a
real browser. The saved examples are local test inputs and are excluded from the
built extensions.

To check the Firefox package with Mozilla's validator:

```sh
npx web-ext lint --source-dir dist/firefox
```

After source changes, rebuild and reload the extension from the browser's extension
management page, then reload Monday tabs.
