<p align="center">
  <img src="https://i.ibb.co/wr0d9jH3/diagram.png" alt="Steam Page Tools" width="150">
</p>

# Steam Page Tools

A userscript for Violentmonkey and Tampermonkey that adds tools to your Steam Community badge pages and Steam Store search results.

## Contents

- [Changelog](#changelog)
- [Features](#features)
- [Installation](#installation)
  - [Violentmonkey](#violentmonkey)
  - [Tampermonkey](#tampermonkey)

## Changelog

### 1.9.0 - 2026-07-28

- **Added:** Safe badge auto-crafting with confirmation, live progress, reward rescans, rate-limit handling, cross-tab protection, safety limits, and stop controls.
- **Added:** Bulk wishlist actions that refresh the current wishlist and skip games already on it.
- **Improved:** Badge pagination, saved-selection recovery, shared controls, and explanatory comments.
- **Documentation:** Reworked the feature overview, safety notes, limitations, installation steps, and screenshots.

## Features

### Badge pages

These tools are available only on the signed-in account's own badge pages.

- Show only games with card drops remaining across paginated badge results.
- Auto-craft complete card sets across your badge pages, with confirmation, live progress, request pacing, rate-limit handling, cross-tab protection, safety limits, and a stop-after-current-request control.

> [!WARNING]
> Auto-crafting consumes cards and cannot be undone. The script asks for confirmation before crafting begins.

<img src="https://i.ibb.co/pj09Cs4t/Screenshot-2026-07-28-173351.png" alt="Steam badge filter and auto-craft controls">

### Steam Store search results

- Select games directly from the search results.
- Add selected games to the cart in one run.
- Add selected games to the wishlist after refreshing the account's current wishlist; games already on it are skipped automatically.

Bundle rows are not supported. When a game has multiple purchase options, the cart action uses Steam's first/default package.

<p><img src="https://i.ibb.co/wFfwYrVW/Screenshot-2026-07-26-012816.png" alt="Selection checkboxes on Steam search results"> <img src="https://i.ibb.co/yc324R1q/image.png" alt="Bulk cart and wishlist action bar"></p>

## Installation

The instructions and extension links below are for Chrome and Chromium-based browsers.

### Violentmonkey

1. Install [Violentmonkey from the Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag).
2. Open the **Violentmonkey Dashboard**, then click **+**.

   <img src="https://i.ibb.co/7tBnYGh3/vkc-CFS1-Imgur.png" alt="Violentmonkey add-script button">

3. Click **Install from URL**, then paste:

   ```text
   https://raw.githubusercontent.com/x0697x/steam-page-tools/main/steam-page-tools.user.js
   ```

4. Click **Install**.

   <img src="https://i.ibb.co/JFHwDPYM/Screenshot-2026-07-27-234845.png" alt="Violentmonkey install confirmation">

5. On the extension's **Details** page, enable **Allow User Scripts**.

   <img src="https://i.ibb.co/276vh13d/Screenshot-2026-07-24-094639.png" alt="Chrome extension details">
   <img src="https://i.ibb.co/vvXhBPwC/Screenshot-2026-07-24-094645.png" alt="Allow User Scripts setting">

### Tampermonkey

1. Install [Tampermonkey from the Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
2. Open [Steam Page Tools on Greasy Fork](https://greasyfork.org/en/scripts/588294-steam-page-tools).
3. Click **Install this script**.

   <img src="https://i.ibb.co/dJmrckCt/image.png" alt="Greasy Fork install button">

4. Confirm by clicking **Install**.

   <img src="https://i.ibb.co/9HRN1pkR/image.png" alt="Tampermonkey install confirmation">

5. On the extension's **Details** page, enable **Allow User Scripts**.

   <img src="https://i.ibb.co/6J8nRzzw/image.png" alt="Chrome extension details">
   <img src="https://i.ibb.co/vvXhBPwC/Screenshot-2026-07-24-094645.png" alt="Allow User Scripts setting">
