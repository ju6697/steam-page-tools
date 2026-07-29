<p align="center">
  <img src="https://i.ibb.co/wr0d9jH3/diagram.png" alt="Steam Page Tools" width="150">
</p>

# Steam Page Tools

An experimental Steam Page Tools build that adds an opt-in Steam Families availability filter to Steam Store search results.

> [!IMPORTANT]
> This is a test branch for validating the Steam Families filter. It is not the stable release.
> Use the [stable release and installation instructions](https://github.com/x0697x/steam-page-tools#installation) for the supported build.

## Contents

- [Changelog](#changelog)
- [Features](#features)
  - [Badge pages](#badge-pages)
  - [Steam Store search results](#steam-store-search-results)
- [Test installation](#test-installation)

## Changelog

### 1.10.0 - 2026-07-28

- **Added:** An opt-in Store search filter that hides games available through Steam Families when the signed-in account does not own a copy.

### 1.9.0 - 2026-07-28

- **Added:** Safe badge auto-crafting with confirmation, live progress, reward rescans, rate-limit handling, cross-tab protection, safety limits, and stop controls.
- **Added:** Bulk wishlist actions that refresh the current wishlist and skip games already on it.
- **Improved:** Badge pagination, saved-selection recovery, shared controls, and explanatory comments.

## Features

### Badge pages

These tools are available only on the signed-in account's own badge pages.

- Show only games with card drops remaining across paginated badge results.
- Auto-craft complete card sets across your badge pages, with confirmation, live progress, request pacing, rate-limit handling, cross-tab protection, safety limits, and a stop-after-current-request control.

> [!WARNING]
> Auto-crafting consumes cards and cannot be undone. The script asks for confirmation before crafting begins.

<img src="https://i.ibb.co/pj09Cs4t/Screenshot-2026-07-28-173351.png" alt="Steam badge filter and auto-craft controls">

### Steam Store search results

- Hide family-shared games that the signed-in account does not own.
- Select games directly from the search results.
- Add selected games to the cart in one run.
- Add selected games to the wishlist after refreshing the account's current wishlist; games already on it are skipped automatically.

Bundle rows are not supported. When a game has multiple purchase options, the cart action uses Steam's first/default package.

The family filter is off by default and leaves all results visible if Steam's family data is unavailable.

<img src="https://i.ibb.co/wFfwYrVW/Screenshot-2026-07-26-012816.png" alt="Selection checkboxes on Steam search results"><img src="https://i.ibb.co/yc324R1q/image.png" alt="Bulk cart and wishlist action bar">

## Test installation

1. Install [Violentmonkey](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) or [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
2. Open [the Steam Families filter test-branch userscript](https://raw.githubusercontent.com/x0697x/steam-page-tools/refs/heads/test-family-shared-filter/steam-page-tools.user.js).
3. Confirm the installation in your userscript manager.
4. On Chrome and Chromium browsers, enable **Allow User Scripts** on the extension's details page if required.
