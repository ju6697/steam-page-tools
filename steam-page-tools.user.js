// ==UserScript==
// @name         [test-family-shared-filter] Steam Page Tools
// @namespace    local.steam-page-tools
// @version      1.10.0
// @description  Adds badge tools, store filters, and bulk actions to Steam.
// @author       x0697x
// @match        https://steamcommunity.com/id/*/badges*
// @match        https://steamcommunity.com/profiles/*/badges*
// @match        https://store.steampowered.com/search*
// @grant        none
// @icon         https://i.ibb.co/wr0d9jH3/diagram.png
// @updateURL    https://raw.githubusercontent.com/x0697x/steam-page-tools/codex/test-family-shared-filter/steam-page-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/x0697x/steam-page-tools/codex/test-family-shared-filter/steam-page-tools.user.js
// @homepageURL  https://github.com/x0697x/steam-page-tools/tree/codex/test-family-shared-filter
// ==/UserScript==

(function () {
    'use strict';

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function getSessionId() {
        if (window.g_sessionID) {
            return window.g_sessionID;
        }

        const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);

        return match ? decodeURIComponent(match[1]) : null;
    }

    function bindButtonActivation(element, handler) {
        element.addEventListener('click', handler);
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handler();
            }
        });
    }

    function getFamilyOnlyAppIds(library) {
        const ownerSteamId = String(library?.owner_steamid || '');

        if (!/^\d+$/.test(ownerSteamId) || !Array.isArray(library?.apps)) {
            throw new Error('Steam returned invalid family library data');
        }

        const appids = new Set();

        library.apps.forEach((app) => {
            const appid = String(app?.appid || '');

            if (
                !/^\d+$/.test(appid) ||
                app?.exclude_reason !== 0 ||
                !Array.isArray(app.owner_steamids)
            ) {
                return;
            }

            const owners = app.owner_steamids
                .map((steamid) => String(steamid))
                .filter((steamid) => /^\d+$/.test(steamid));

            if (owners.length && !owners.includes(ownerSteamId)) {
                appids.add(appid);
            }
        });

        return appids;
    }

    if (location.hostname === 'steamcommunity.com') {
        initBadgesPageTools();
    } else if (location.hostname === 'store.steampowered.com') {
        initStoreSearchTools();
    }

    // Badge page tools.
    function initBadgesPageTools() {
        if (
            !/^\/(?:id\/[^/]+|profiles\/\d+)\/badges\/?$/i
                .test(location.pathname)
        ) {
            return;
        }

        // Prefer locale-independent markers; use English text only when
        // neither structural marker is available.
        const DROPS_REGEX_FALLBACK = /(\d+)\s*card drops?\s*remaining/i;

        function getRows(root = document) {
            return [...root.querySelectorAll('.badge_row')];
        }

        // Steam renders the "Play Game" control only while a badge has card
        // drops. Its CSS class is stable across interface languages.
        function hasDropsRemaining(row) {
            if (row.querySelector('.badge_title_playgame, .badge_title_stats_playgame')) {
                return true;
            }

            if (row.querySelector('.badge_title_stats_completed')) {
                return false;
            }

            // Fall back to Steam's English status text for ambiguous rows.
            return DROPS_REGEX_FALLBACK.test(row.textContent);
        }

        function getCurrentPageNumber() {
            const page = parseInt(
                new URL(location.href).searchParams.get('p') || '1',
                10
            );

            return page > 0 ? page : 1;
        }

        function buildPageUrl(pageNum) {
            const url = new URL(location.href);
            url.searchParams.set('p', pageNum);
            return url.toString();
        }

        async function fetchPageRows(pageNum) {
            const res = await fetch(buildPageUrl(pageNum), { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            return getRows(doc);
        }

        // Read Steam's pagination instead of inferring the page count from
        // fetched content. Callers include the current page, which is a span.
        function getMaxPageFromPagination() {
            const here = new URL(location.href);

            const values = [...document.querySelectorAll('a[href*="p="]')]
                .map((a) => {
                    try {
                        const url = new URL(a.href, location.href);

                        if (url.pathname !== here.pathname) {
                            return NaN;
                        }

                        return parseInt(url.searchParams.get('p'), 10);
                    } catch {
                        return NaN;
                    }
                })
                .filter((n) => Number.isFinite(n) && n > 0);

            return values.length ? Math.max(...values) : null;
        }

        // Prevent runaway scans if Steam returns malformed pagination.
        const MAX_PAGES = 200;
        const MAX_CRAFT_PASSES = 10;
        const MAX_CRAFT_BATCHES = 500;
        const CRAFT_LOCK_KEY = 'spt-badge-auto-craft-lock';
        const CRAFT_LOCK_TTL_MS = 60 * 1000;
        const craftLockOwner =
            `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let craftLockUsesStorage = true;

        async function fetchPageRowsWithRetry(pageNum) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    return await fetchPageRows(pageNum);
                } catch (err) {
                    console.error(
                        'Steam Page Tools: failed loading badge page',
                        pageNum,
                        err
                    );

                    if (attempt === 0) {
                        await sleep(500);
                    }
                }
            }

            return null;
        }

        function getProfileUrlFromUrl(url) {
            if (!url) {
                return null;
            }

            try {
                const parsed = new URL(url, location.href);
                const match = parsed.pathname.match(
                    /^\/(?:id\/[^/]+|profiles\/\d+)/i
                );

                return match ? `${parsed.origin}${match[0]}` : null;
            } catch {
                return null;
            }
        }

        function normalizeProfileUrl(url) {
            const profileUrl = getProfileUrlFromUrl(url);

            return profileUrl ? profileUrl.toLowerCase() : null;
        }

        const profileUrl =
            getProfileUrlFromUrl(window.g_strProfileURL) ||
            getProfileUrlFromUrl(location.href);

        // The metadata matches every profile, so compare numeric IDs or the
        // signed-in profile link before exposing account-specific controls.
        function isProbablyOwnProfilePage() {
            if (!profileUrl) {
                return false;
            }

            const numericMatch = new URL(profileUrl).pathname.match(
                /^\/profiles\/(\d+)$/i
            );

            if (
                numericMatch &&
                window.g_steamID &&
                numericMatch[1] === String(window.g_steamID)
            ) {
                return true;
            }

            const signedInProfileLink = document.querySelector(
                '#global_header a.user_avatar[href], ' +
                '#responsive_page_menu .persona a[data-miniprofile][href]'
            );

            return Boolean(
                signedInProfileLink &&
                normalizeProfileUrl(signedInProfileLink.href) ===
                    normalizeProfileUrl(profileUrl)
            );
        }

        // Revalidate ownership through Steam's /my/ redirect immediately
        // before consuming cards.
        async function verifyOwnProfilePage() {
            const numericMatch = profileUrl
                ? new URL(profileUrl).pathname.match(/^\/profiles\/(\d+)$/i)
                : null;

            if (
                numericMatch &&
                window.g_steamID &&
                numericMatch[1] === String(window.g_steamID)
            ) {
                return true;
            }

            try {
                const res = await fetch(`${location.origin}/my/badges/`, {
                    credentials: 'include',
                });

                return Boolean(
                    res.ok &&
                    res.url &&
                    normalizeProfileUrl(res.url) ===
                        normalizeProfileUrl(profileUrl)
                );
            } catch (err) {
                console.error(
                    'Steam Page Tools: failed verifying profile ownership',
                    err
                );
                return false;
            }
        }

        function getBadgeName(row, appid, borderColor) {
            const title = row.querySelector('.badge_title');

            if (title) {
                const textNode = [...title.childNodes]
                    .find((node) => (
                        node.nodeType === 3 && node.textContent.trim()
                    ));

                if (textNode) {
                    return textNode.textContent.trim();
                }
            }

            return `App ${appid}${borderColor === '1' ? ' (foil)' : ''}`;
        }

        // Steam's composite row ID keeps normal and foil badges distinct
        // without relying on localized text.
        function getCraftTarget(row) {
            const button = row.querySelector(
                '.badge_progress_info > a.badge_craft_button[href*="/gamecards/"]'
            );
            const idMatch = row.id.match(
                /^badge_gamebadge_(\d+)_(\d+)_(\d+)$/
            );

            if (!button || !idMatch) {
                return null;
            }

            const detailUrl = new URL(button.href, location.href);
            const appMatch = detailUrl.pathname.match(
                /\/gamecards\/(\d+)(?:\/|$)/i
            );
            const [, appid, series, borderColor] = idMatch;

            if (!appMatch || appMatch[1] !== appid) {
                return null;
            }

            return {
                key: `${appid}:${series}:${borderColor}`,
                appid,
                series,
                borderColor,
                detailUrl: detailUrl.toString(),
                name: getBadgeName(row, appid, borderColor),
            };
        }

        function parseCraftCall(code) {
            if (!code) {
                return null;
            }

            const match = code.match(
                /Profile_CraftGameBadge\(\s*(['"])([^'"]+)\1\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*(\d+)\s*\)/
            );

            if (!match) {
                return null;
            }

            return {
                profileUrl: match[2],
                appid: match[3],
                series: match[4],
                borderColor: match[5],
                levels: parseInt(match[6], 10),
            };
        }

        async function fetchCraftOptionOnce(target) {
            const res = await fetch(target.detailUrl, {
                credentials: 'include',
            });

            if (!res.ok) {
                const err = new Error(`HTTP ${res.status}`);

                err.fatal = res.status === 401 || res.status === 403;
                throw err;
            }

            if (res.url) {
                const responseUrl = new URL(res.url, target.detailUrl);

                if (/\/login(?:\/|$)/i.test(responseUrl.pathname)) {
                    const err = new Error('Steam asked you to sign in again');

                    err.fatal = true;
                    throw err;
                }
            }

            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            if (doc.querySelector('#loginForm, input[name="password"]')) {
                const err = new Error('Steam asked you to sign in again');

                err.fatal = true;
                throw err;
            }

            const options = [
                ...doc.querySelectorAll(
                    '.gamecard_badge_craftbtn_ctn ' +
                    '.badge_craft_button[onclick*="Profile_CraftGameBadge"]'
                ),
            ]
                .map((button) => parseCraftCall(button.getAttribute('onclick')))
                .filter((option) => (
                    option &&
                    option.appid === target.appid &&
                    option.series === target.series &&
                    option.borderColor === target.borderColor &&
                    normalizeProfileUrl(option.profileUrl) ===
                        normalizeProfileUrl(profileUrl) &&
                    Number.isFinite(option.levels) &&
                    option.levels >= 1 &&
                    option.levels <= 5
                ));

            if (!options.length) {
                return null;
            }

            return options.reduce((largest, option) => (
                option.levels > largest.levels ? option : largest
            ));
        }

        async function fetchCraftOption(target) {
            let lastError = null;

            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    return await fetchCraftOptionOnce(target);
                } catch (err) {
                    lastError = err;

                    if (err.fatal || attempt === 1) {
                        break;
                    }

                    await sleep(600);
                }
            }

            throw lastError;
        }

        function getRetryDelayMs(res) {
            const value = res.headers && res.headers.get('Retry-After');

            if (!value) {
                return 5000;
            }

            const seconds = parseInt(value, 10);

            if (Number.isFinite(seconds)) {
                return Math.min(Math.max(seconds * 1000, 1000), 30000);
            }

            const retryAt = Date.parse(value);

            return Number.isFinite(retryAt)
                ? Math.min(Math.max(retryAt - Date.now(), 1000), 30000)
                : 5000;
        }

        async function postCraft(target, levels, sessionid) {
            const body = new URLSearchParams({
                appid: target.appid,
                series: target.series,
                border_color: target.borderColor,
                levels: String(levels),
                sessionid,
            });

            let res;

            try {
                res = await fetch(`${profileUrl}/ajaxcraftbadge/`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    body: body.toString(),
                });
            } catch (cause) {
                const err = new Error('The craft response was not received');

                err.ambiguous = true;
                err.cause = cause;
                throw err;
            }

            let text;

            try {
                text = await res.text();
            } catch (cause) {
                const err = new Error('The craft response could not be read');

                err.ambiguous = true;
                err.cause = cause;
                throw err;
            }

            let data = null;

            try {
                data = JSON.parse(text);
            } catch {
                // Validation below rejects non-JSON craft responses.
            }

            if (!res.ok) {
                const message =
                    data && (data.strError || data.message);
                const err = new Error(message || `HTTP ${res.status}`);

                err.status = res.status;
                err.fatal = res.status === 401 || res.status === 403;
                err.retryAfterMs =
                    res.status === 429 ? getRetryDelayMs(res) : 0;
                err.ambiguous = res.status >= 500;
                throw err;
            }

            if (!data || !data.Badge || typeof data.Badge !== 'object') {
                const err = new Error('Steam returned an unexpected craft response');

                err.ambiguous = true;
                throw err;
            }

            return data;
        }

        function readCraftLock() {
            if (!craftLockUsesStorage) {
                return null;
            }

            let raw;

            try {
                raw = localStorage.getItem(CRAFT_LOCK_KEY);
            } catch {
                craftLockUsesStorage = false;
                return null;
            }

            if (!raw) {
                return null;
            }

            try {
                return JSON.parse(raw);
            } catch {
                // Treat malformed lock data as stale without disabling
                // storage-backed cross-tab protection.
                return null;
            }
        }

        function writeCraftLock() {
            if (!craftLockUsesStorage) {
                return true;
            }

            try {
                localStorage.setItem(CRAFT_LOCK_KEY, JSON.stringify({
                    owner: craftLockOwner,
                    expiresAt: Date.now() + CRAFT_LOCK_TTL_MS,
                }));
                return true;
            } catch {
                craftLockUsesStorage = false;
                return true;
            }
        }

        function acquireCraftLock() {
            const current = readCraftLock();

            if (
                current &&
                current.owner !== craftLockOwner &&
                current.expiresAt > Date.now()
            ) {
                return false;
            }

            writeCraftLock();

            const saved = readCraftLock();

            return !craftLockUsesStorage || (
                saved &&
                saved.owner === craftLockOwner
            );
        }

        function refreshCraftLock() {
            const current = readCraftLock();

            if (
                current &&
                current.owner !== craftLockOwner &&
                current.expiresAt > Date.now()
            ) {
                return false;
            }

            return writeCraftLock();
        }

        function releaseCraftLock() {
            const current = readCraftLock();

            if (!craftLockUsesStorage || !current) {
                return;
            }

            if (current.owner === craftLockOwner) {
                try {
                    localStorage.removeItem(CRAFT_LOCK_KEY);
                } catch {
                    craftLockUsesStorage = false;
                }
            }
        }

        function insertControl() {
            const rows = getRows();

            if (!rows.length) {
                return false;
            }

            // The toolbar contains a destructive action, so expose it only
            // when the viewed profile belongs to the signed-in account.
            if (!isProbablyOwnProfilePage()) {
                return true;
            }

            // Separate status and action groups so empty status text does not
            // add spacing between the buttons.
            const bar = document.createElement('div');

            bar.style.cssText =
                'display:flex; align-items:center; justify-content:flex-end; gap:10px; margin:10px 0; flex-wrap:wrap;';

            const statusGroup = document.createElement('div');

            statusGroup.style.cssText =
                'display:flex; align-items:center; justify-content:flex-end; gap:10px; flex:1 1 320px; min-width:0; flex-wrap:wrap;';

            const actionGroup = document.createElement('div');

            actionGroup.id = 'spt-badge-actions';
            actionGroup.style.cssText =
                'display:flex; align-items:center; gap:4px; flex:0 0 auto; margin-left:auto;';

            const status = document.createElement('span');

            status.id = 'drop-filter-status';

            status.style.cssText =
                'color:#8f98a0; font-size:12px;';

            const toggle = document.createElement('div');

            toggle.id = 'drop-filter-toggle';
            toggle.className = 'btnv6_blue_hoverfade btn_small';
            toggle.style.cssText = 'cursor:pointer; user-select:none;';
            toggle.setAttribute('role', 'button');
            toggle.tabIndex = 0;

            toggle.innerHTML = '<span>Show only drops remaining</span>';

            const craftStatus = document.createElement('span');
            craftStatus.id = 'spt-auto-craft-status';
            craftStatus.style.cssText =
                'color:#8f98a0; font-size:12px; max-width:360px;';

            const autoCraft = document.createElement('div');
            autoCraft.id = 'spt-auto-craft';
            autoCraft.className = 'btnv6_blue_hoverfade btn_small';
            autoCraft.style.cssText = 'cursor:pointer; user-select:none;';
            autoCraft.setAttribute('role', 'button');
            autoCraft.tabIndex = 0;
            autoCraft.title =
                'Craft every complete card set across all badge pages';

            const autoCraftLabel = document.createElement('span');
            autoCraftLabel.textContent = 'Auto Craft All Badges';
            autoCraft.appendChild(autoCraftLabel);

            statusGroup.appendChild(status);
            statusGroup.appendChild(craftStatus);
            actionGroup.appendChild(toggle);
            actionGroup.appendChild(autoCraft);
            bar.appendChild(statusGroup);
            bar.appendChild(actionGroup);

            const container = rows[0].parentElement;

            container.insertBefore(bar, rows[0]);

            let active = false;
            let busy = false;
            let craftBusy = false;
            let stopCrafting = false;
            let extraRows = [];

            function setBusy(isBusy) {
                busy = isBusy;

                toggle.style.pointerEvents = isBusy ? 'none' : '';
                toggle.style.opacity = isBusy ? '0.6' : '';

                if (!craftBusy) {
                    autoCraft.style.pointerEvents = isBusy ? 'none' : '';
                    autoCraft.style.opacity = isBusy ? '0.6' : '';
                }
            }

            function setCraftBusy(isBusy) {
                craftBusy = isBusy;

                toggle.style.pointerEvents = isBusy || busy ? 'none' : '';
                toggle.style.opacity = isBusy || busy ? '0.6' : '';

                autoCraft.style.pointerEvents = '';
                autoCraft.style.opacity = '';
                autoCraftLabel.textContent = isBusy
                    ? 'Stop Auto Craft'
                    : 'Auto Craft All Badges';
                autoCraft.title = isBusy
                    ? 'Stop after the current badge'
                    : 'Craft every complete card set across all badge pages';
            }

            function setCraftStatus(text, withReload = false) {
                craftStatus.textContent = text;

                if (withReload) {
                    craftStatus.appendChild(document.createTextNode(' '));

                    const link = document.createElement('a');

                    link.href = location.href;
                    link.textContent = 'Reload badges';
                    link.style.color = '#67c1f1';

                    craftStatus.appendChild(link);
                }
            }

            // Steam's button styles have no pressed state, so add an inset
            // border while the filter is active.
            function setActiveStyle(isActive) {
                toggle.style.boxShadow =
                    isActive ? 'inset 0 0 0 1px #67c1f1' : '';
            }

            async function runFilter() {
                getRows().forEach((row) => {
                    row.style.display = hasDropsRemaining(row) ? '' : 'none';
                });

                const currentPage = getCurrentPageNumber();

                setBusy(true);

                // Bound the scan with Steam's pagination; empty or repeated
                // responses are not reliable terminators.
                const maxPage = Math.min(
                    Math.max(
                        currentPage,
                        getMaxPageFromPagination() || 1
                    ),
                    MAX_PAGES
                );

                for (let page = 1; page <= maxPage && active; page += 1) {
                    if (page === currentPage) {
                        continue;
                    }

                    status.textContent =
                        `Loading page ${page} of ${maxPage}...`;

                    const rows = await fetchPageRowsWithRetry(page);

                    if (rows === null) {
                        continue;
                    }

                    // Preserve every row: normal and foil badges share an app
                    // ID and detail URL but represent separate drop states.
                    rows
                        .filter(hasDropsRemaining)
                        .forEach((row) => {
                            const clone = row.cloneNode(true);

                            clone.dataset.sptDropFilterClone = '1';
                            container.appendChild(clone);
                            extraRows.push(clone);
                        });

                    await sleep(200);
                }

                const visibleCount = getRows()
                    .filter((r) => r.style.display !== 'none')
                    .length;

                status.textContent =
                    `Showing ${visibleCount} games with drops remaining across all pages.`;

                setBusy(false);
            }

            async function onToggle() {
                if (busy || craftBusy) {
                    return;
                }

                active = !active;

                setActiveStyle(active);

                if (!active) {
                    getRows().forEach((row) => {
                        row.style.display = '';
                    });

                    extraRows.forEach((row) => {
                        row.remove();
                    });

                    extraRows = [];

                    status.textContent = '';

                    return;
                }

                await runFilter();
            }

            async function collectCraftTargets(freshAllPages = false) {
                const currentPage = getCurrentPageNumber();
                const detectedMaxPage = Math.max(
                    currentPage,
                    getMaxPageFromPagination() || 1
                );

                if (detectedMaxPage > MAX_PAGES) {
                    throw new Error(
                        `Badge list has more than the ${MAX_PAGES}-page safety limit`
                    );
                }

                const targets = new Map();

                for (let page = 1; page <= detectedMaxPage; page += 1) {
                    if (stopCrafting) {
                        return {
                            targets: [...targets.values()],
                            cancelled: true,
                        };
                    }

                    setCraftStatus(
                        `Scanning badge page ${page} of ${detectedMaxPage}...`
                    );

                    let pageRows;

                    if (page === currentPage && !freshAllPages) {
                        pageRows = getRows()
                            .filter((row) => (
                                !row.dataset.sptDropFilterClone
                            ));
                    } else {
                        pageRows = await fetchPageRowsWithRetry(page);

                        if (pageRows === null) {
                            throw new Error(
                                `Could not scan badge page ${page}`
                            );
                        }
                    }

                    pageRows.forEach((row) => {
                        const target = getCraftTarget(row);

                        if (target) {
                            targets.set(target.key, target);
                        }
                    });

                    if (page !== currentPage || freshAllPages) {
                        await sleep(150);
                    }
                }

                return {
                    targets: [...targets.values()],
                    cancelled: false,
                };
            }

            function requestCraftConfirmation(count) {
                const description =
                    `Found ${count} ready badge type(s). ` +
                    'Craft every complete card set available for them? ' +
                    'Steam Page Tools will use the 5x option when Steam ' +
                    'offers it and will also craft badges made ready by ' +
                    'crafting rewards. This consumes cards and cannot be undone.';

                if (typeof window.ShowConfirmDialog === 'function') {
                    try {
                        return new Promise((resolve) => {
                            window.ShowConfirmDialog(
                                'Auto Craft All Badges',
                                description,
                                'Craft All',
                                'Cancel'
                            )
                                .done(() => resolve(true))
                                .fail(() => resolve(false));
                        });
                    } catch (err) {
                        console.error(
                            'Steam Page Tools: failed opening Steam confirmation',
                            err
                        );
                    }
                }

                return Promise.resolve(window.confirm(description));
            }

            function addCraftFailure(summary, target, err) {
                if (!summary.failed.has(target.key)) {
                    summary.failed.set(target.key, {
                        name: target.name,
                        message: err.message,
                    });
                }
            }

            async function craftEveryLevel(
                target,
                sessionid,
                summary,
                position,
                total
            ) {
                let craftedForTarget = 0;
                let attemptedMutation = false;
                let consecutiveAmbiguous = 0;
                let throttleCount = 0;

                while (
                    !stopCrafting &&
                    summary.batches < MAX_CRAFT_BATCHES
                ) {
                    setCraftStatus(
                        `Checking ${position} of ${total}: ${target.name}...`
                    );

                    let option;

                    try {
                        option = await fetchCraftOption(target);
                    } catch (err) {
                        console.error(
                            'Steam Page Tools: failed checking craft state',
                            target.key,
                            err
                        );

                        if (err.fatal) {
                            throw err;
                        }

                        addCraftFailure(summary, target, err);
                        return craftedForTarget;
                    }

                    if (!option) {
                        if (
                            !craftedForTarget &&
                            !attemptedMutation &&
                            !summary.badges.has(target.key)
                        ) {
                            summary.skipped.add(target.key);
                        }

                        return craftedForTarget;
                    }

                    if (stopCrafting) {
                        return craftedForTarget;
                    }

                    if (!refreshCraftLock()) {
                        const err = new Error(
                            'Another tab took over the badge craft queue'
                        );

                        err.fatal = true;
                        throw err;
                    }

                    const levelWord =
                        option.levels === 1 ? 'level' : 'levels';

                    setCraftStatus(
                        `Crafting ${position} of ${total}: ${target.name} ` +
                        `(${option.levels} ${levelWord})...`
                    );

                    attemptedMutation = true;
                    summary.attempts += 1;

                    try {
                        await postCraft(
                            target,
                            option.levels,
                            sessionid
                        );

                        summary.batches += 1;
                        summary.levels += option.levels;
                        summary.badges.add(target.key);
                        summary.skipped.delete(target.key);
                        craftedForTarget += option.levels;
                        consecutiveAmbiguous = 0;
                        throttleCount = 0;
                    } catch (err) {
                        console.error(
                            'Steam Page Tools: failed crafting badge',
                            target.key,
                            err
                        );

                        if (err.fatal) {
                            throw err;
                        }

                        if (err.status === 429) {
                            throttleCount += 1;

                            if (throttleCount > 3) {
                                addCraftFailure(summary, target, err);
                                return craftedForTarget;
                            }

                            const waitSeconds = Math.ceil(
                                err.retryAfterMs / 1000
                            );

                            setCraftStatus(
                                `Steam is rate limiting requests. ` +
                                `Retrying ${target.name} in ` +
                                `${waitSeconds} seconds...`
                            );

                            await sleep(err.retryAfterMs);
                            continue;
                        }

                        if (err.ambiguous) {
                            summary.uncertain += 1;
                            consecutiveAmbiguous += 1;

                            if (consecutiveAmbiguous >= 3) {
                                addCraftFailure(summary, target, err);
                                return craftedForTarget;
                            }

                            // Reconcile an ambiguous mutation against fresh
                            // badge state before issuing another POST.
                            setCraftStatus(
                                `Rechecking ${target.name} after an ` +
                                'uncertain response...'
                            );
                            await sleep(1500);
                            continue;
                        }

                        addCraftFailure(summary, target, err);
                        return craftedForTarget;
                    }

                    if (!stopCrafting) {
                        await sleep(
                            800 + Math.floor(Math.random() * 401)
                        );
                    }
                }

                return craftedForTarget;
            }

            function renderCraftSummary(summary, runError) {
                const prefix = stopCrafting ? 'Stopped.' : (
                    runError ? 'Stopped after an error.' : 'Finished.'
                );
                const totals = summary.uncertain
                    ? `Confirmed ${summary.levels} level(s) across ` +
                        `${summary.badges.size} badge(s); totals may be higher.`
                    : `Crafted ${summary.levels} level(s) across ` +
                        `${summary.badges.size} badge(s).`;
                const parts = [
                    prefix,
                    totals,
                ];

                if (summary.skipped.size) {
                    parts.push(
                        `${summary.skipped.size} stale badge(s) skipped.`
                    );
                }

                if (summary.failed.size) {
                    parts.push(
                        `${summary.failed.size} badge(s) failed; ` +
                        'details are in the console.'
                    );
                }

                if (summary.uncertain) {
                    parts.push(
                        `${summary.uncertain} response(s) were uncertain; ` +
                        'fresh badge state was checked before continuing.'
                    );
                }

                if (summary.safetyLimit) {
                    parts.push('Stopped at the automatic safety limit.');
                }

                if (runError) {
                    parts.push(runError.message);
                }

                setCraftStatus(
                    parts.join(' '),
                    summary.attempts > 0
                );
            }

            async function onAutoCraft() {
                if (craftBusy) {
                    stopCrafting = true;
                    autoCraftLabel.textContent = 'Stopping...';
                    autoCraft.style.pointerEvents = 'none';
                    autoCraft.style.opacity = '0.6';
                    setCraftStatus(
                        'Stopping after the current badge request...'
                    );
                    return;
                }

                if (busy) {
                    setCraftStatus(
                        'Wait for the card-drop filter to finish first.'
                    );
                    return;
                }

                const sessionid = getSessionId();

                if (!sessionid || !profileUrl) {
                    setCraftStatus(
                        'Could not verify your Steam session. Refresh and try again.'
                    );
                    return;
                }

                stopCrafting = false;
                setCraftBusy(true);

                const summary = {
                    attempts: 0,
                    batches: 0,
                    levels: 0,
                    uncertain: 0,
                    badges: new Set(),
                    skipped: new Set(),
                    failed: new Map(),
                    safetyLimit: false,
                };
                let lockHeld = false;
                let lockHeartbeat = null;
                let runError = null;

                try {
                    setCraftStatus('Verifying this is your badges page...');

                    if (!await verifyOwnProfilePage()) {
                        setCraftStatus(
                            'Auto craft is only available on your own badges page.'
                        );
                        return;
                    }

                    const initialScan = await collectCraftTargets(false);

                    if (initialScan.cancelled || stopCrafting) {
                        setCraftStatus('Auto craft stopped before crafting.');
                        return;
                    }

                    if (!initialScan.targets.length) {
                        setCraftStatus(
                            'No badges are currently ready to craft.'
                        );
                        return;
                    }

                    const confirmed = await requestCraftConfirmation(
                        initialScan.targets.length
                    );

                    if (!confirmed) {
                        setCraftStatus('Auto craft cancelled.');
                        return;
                    }

                    if (!acquireCraftLock()) {
                        setCraftStatus(
                            'Another tab is already auto crafting badges.'
                        );
                        return;
                    }

                    lockHeld = true;
                    lockHeartbeat = setInterval(() => {
                        if (!refreshCraftLock()) {
                            stopCrafting = true;
                            setCraftStatus(
                                'Another tab took over auto craft. ' +
                                'Stopping after the current request...'
                            );
                        }
                    }, 20000);

                    let targets = initialScan.targets;

                    for (
                        let pass = 1;
                        pass <= MAX_CRAFT_PASSES && targets.length;
                        pass += 1
                    ) {
                        const attemptsBeforePass = summary.attempts;

                        for (
                            let index = 0;
                            index < targets.length;
                            index += 1
                        ) {
                            if (
                                stopCrafting ||
                                summary.batches >= MAX_CRAFT_BATCHES
                            ) {
                                break;
                            }

                            const target = targets[index];

                            if (summary.failed.has(target.key)) {
                                continue;
                            }

                            await craftEveryLevel(
                                target,
                                sessionid,
                                summary,
                                index + 1,
                                targets.length
                            );
                        }

                        if (
                            stopCrafting ||
                            summary.batches >= MAX_CRAFT_BATCHES
                        ) {
                            summary.safetyLimit =
                                summary.batches >= MAX_CRAFT_BATCHES;
                            break;
                        }

                        // A pass without mutation attempts indicates stale
                        // rows; stop instead of rescanning indefinitely.
                        if (summary.attempts === attemptsBeforePass) {
                            break;
                        }

                        setCraftStatus(
                            'Rescanning for badges made ready by rewards...'
                        );

                        const nextScan = await collectCraftTargets(true);

                        if (nextScan.cancelled || stopCrafting) {
                            break;
                        }

                        targets = nextScan.targets
                            .filter((target) => (
                                !summary.failed.has(target.key)
                            ));

                        if (
                            pass === MAX_CRAFT_PASSES &&
                            targets.length
                        ) {
                            summary.safetyLimit = true;
                        }
                    }
                } catch (err) {
                    runError = err;
                    console.error(
                        'Steam Page Tools: auto craft stopped',
                        err
                    );
                } finally {
                    if (lockHeartbeat !== null) {
                        clearInterval(lockHeartbeat);
                    }

                    if (lockHeld) {
                        releaseCraftLock();
                    }

                    if (
                        summary.attempts ||
                        summary.skipped.size ||
                        summary.failed.size ||
                        runError
                    ) {
                        renderCraftSummary(summary, runError);
                    }

                    stopCrafting = false;
                    autoCraft.style.pointerEvents = '';
                    autoCraft.style.opacity = '';
                    setCraftBusy(false);
                }
            }

            bindButtonActivation(toggle, onToggle);
            bindButtonActivation(autoCraft, onAutoCraft);

            window.addEventListener('storage', (e) => {
                if (
                    craftBusy &&
                    e.key === CRAFT_LOCK_KEY
                ) {
                    const current = readCraftLock();

                    if (
                        current &&
                        current.owner !== craftLockOwner &&
                        current.expiresAt > Date.now()
                    ) {
                        stopCrafting = true;
                        setCraftStatus(
                            'Another tab started auto craft. ' +
                            'Stopping this queue after the current request...'
                        );
                    }
                }
            });

            return true;
        }

        // Steam may render the badge list after DOMContentLoaded, so poll
        // briefly.
        let attempts = 0;

        const interval = setInterval(() => {
            attempts += 1;

            if (insertControl() || attempts > 20) {
                clearInterval(interval);
            }
        }, 250);
    }

    // Store search tools.
    // Bundle results are skipped because they require bundle-package lookup.
    // Apps with multiple purchase options use Steam's first/default package,
    // matching the primary action on the app page.
    function initStoreSearchTools() {
        const STORAGE_KEY = 'spt-search-cart-selection';
        const LEGACY_STORAGE_KEY = 'dbf-search-cart-selection';
        const FAMILY_FILTER_STORAGE_KEY = 'spt-search-hide-family-shared';
        const FAMILY_FILTER_ACTIVE_CLASS = 'spt-hide-family-shared';
        const FAMILY_SHARED_ROW_CLASS = 'spt-family-shared';

        // Map app IDs to their display names and rendered checkboxes.
        const selected = new Map();
        let familyOnlyAppIds = null;
        let familyFilterControl = null;
        let familyDataRequest = null;
        let familyFilterEnabled = loadFamilyFilterPreference();
        let busy = false;

        injectStyles();

        const bar = buildBar();
        document.body.appendChild(bar.el);

        restoreSelection();
        initFamilyFilter();

        // Persist selections until each game succeeds or the user clears
        // them, including across navigation and browser restarts.
        function loadStoredSelection() {
            try {
                let raw = localStorage.getItem(STORAGE_KEY);

                // Migrate selections saved under the previous script name.
                if (!raw) {
                    raw = localStorage.getItem(LEGACY_STORAGE_KEY);

                    if (raw) {
                        // Restore readable legacy data even if migration is
                        // blocked by storage permissions or quota.
                        try {
                            localStorage.setItem(STORAGE_KEY, raw);
                            localStorage.removeItem(LEGACY_STORAGE_KEY);
                        } catch (err) {
                            console.warn(
                                'Steam Page Tools: could not migrate saved selection',
                                err
                            );
                        }
                    }
                }

                if (!raw) {
                    return new Map();
                }

                return new Map(Object.entries(JSON.parse(raw)));
            } catch (err) {
                console.error('Steam Page Tools: failed to read saved selection', err);
                return new Map();
            }
        }

        function saveSelection() {
            try {
                const obj = {};

                selected.forEach((info, appid) => {
                    obj[appid] = info.name;
                });

                localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
            } catch (err) {
                console.error('Steam Page Tools: failed to save selection', err);
            }
        }

        // Restored selections acquire a checkbox reference when their row is
        // rendered.
        function restoreSelection() {
            const stored = loadStoredSelection();

            if (!stored.size) {
                return;
            }

            stored.forEach((name, appid) => {
                selected.set(appid, { name, box: null });
            });

            updateBar();
            setStatus(`Restored ${stored.size} selected game(s) from before.`);
        }

        function clearSelection() {
            if (busy) {
                return;
            }

            selected.forEach((info) => {
                if (info.box) {
                    info.box.classList.remove('spt-checked');
                    info.box.setAttribute('aria-checked', 'false');
                }
            });

            selected.clear();
            saveSelection();
            updateBar();
        }

        function loadFamilyFilterPreference() {
            try {
                return localStorage.getItem(FAMILY_FILTER_STORAGE_KEY) === '1';
            } catch (err) {
                console.warn(
                    'Steam Page Tools: could not read the family filter preference',
                    err
                );
                return false;
            }
        }

        function saveFamilyFilterPreference() {
            try {
                localStorage.setItem(
                    FAMILY_FILTER_STORAGE_KEY,
                    familyFilterEnabled ? '1' : '0'
                );
            } catch (err) {
                console.warn(
                    'Steam Page Tools: could not save the family filter preference',
                    err
                );
            }
        }

        // Place the custom filter beside Steam's client-side library filters.
        function initFamilyFilter() {
            let attempts = 0;

            document.documentElement.classList.toggle(
                FAMILY_FILTER_ACTIVE_CLASS,
                familyFilterEnabled
            );

            const interval = setInterval(() => {
                attempts += 1;

                if (insertFamilyFilter() || attempts > 20) {
                    clearInterval(interval);
                }
            }, 250);
        }

        function insertFamilyFilter() {
            if (familyFilterControl) {
                return true;
            }

            const nativeOwnedFilter = document.querySelector(
                '#client_filter .tab_filter_control_row[data-value="hide_owned"]'
            );
            const filterContainer =
                nativeOwnedFilter?.parentElement ||
                document.querySelector('#client_filter .block_content_inner');

            if (!filterContainer) {
                return false;
            }

            const row = document.createElement('div');

            row.className = 'tab_filter_control_row spt-family-filter-row';

            const label = document.createElement('label');

            label.className = 'spt-family-filter-control';
            label.title =
                "Hide games available through Steam Families unless this account owns a copy";

            const input = document.createElement('input');

            input.className = 'spt-family-filter-input';
            input.type = 'checkbox';
            input.checked = familyFilterEnabled;

            const labelContainer = document.createElement('span');

            labelContainer.className = 'tab_filter_label_container';

            const checkbox = document.createElement('span');

            checkbox.className = 'spt-family-filter-checkbox';
            checkbox.setAttribute('aria-hidden', 'true');

            const text = document.createElement('span');

            text.className = 'tab_filter_control_label';
            text.textContent = "Hide family-shared games I don't own";

            const status = document.createElement('span');

            status.className =
                'tab_filter_control_count spt-family-filter-status';

            labelContainer.appendChild(checkbox);
            labelContainer.appendChild(text);
            labelContainer.appendChild(status);
            label.appendChild(input);
            label.appendChild(labelContainer);
            row.appendChild(label);

            if (nativeOwnedFilter) {
                nativeOwnedFilter.after(row);
            } else {
                filterContainer.appendChild(row);
            }

            familyFilterControl = { row, label, input, status };
            syncFamilyFilterControl();

            input.addEventListener('change', () => {
                setFamilyFilterEnabled(input.checked);

                if (familyFilterEnabled && familyOnlyAppIds === null) {
                    loadFamilyOnlyApps();
                }
            });

            if (familyFilterEnabled) {
                loadFamilyOnlyApps();
            }

            return true;
        }

        function setFamilyFilterEnabled(enabled, persist = true) {
            familyFilterEnabled = Boolean(enabled);

            document.documentElement.classList.toggle(
                FAMILY_FILTER_ACTIVE_CLASS,
                familyFilterEnabled
            );

            syncFamilyFilterControl();

            if (persist) {
                saveFamilyFilterPreference();
            }
        }

        function syncFamilyFilterControl() {
            if (!familyFilterControl) {
                return;
            }

            const { row, input } = familyFilterControl;

            input.checked = familyFilterEnabled;
            row.classList.toggle('checked', familyFilterEnabled);
        }

        function setFamilyFilterStatus(text, state = '') {
            if (!familyFilterControl) {
                return;
            }

            const { row, label, input, status } = familyFilterControl;

            status.textContent = text;
            status.style.display = text ? '' : 'none';
            row.classList.toggle('spt-loading', state === 'loading');
            row.classList.toggle('spt-error', state === 'error');
            input.setAttribute(
                'aria-busy',
                state === 'loading' ? 'true' : 'false'
            );

            label.title =
                state === 'error'
                    ? 'Steam family data is unavailable. Click to retry.'
                    : "Hide games available through Steam Families unless this account owns a copy";
        }

        function loadFamilyOnlyApps() {
            if (familyOnlyAppIds !== null) {
                return Promise.resolve(familyOnlyAppIds);
            }

            if (familyDataRequest) {
                return familyDataRequest;
            }

            setFamilyFilterStatus('Loading...', 'loading');

            familyDataRequest = fetchFamilyOnlyAppIds()
                .then((appids) => {
                    familyOnlyAppIds = appids;
                    markFamilyOnlyRows();
                    setFamilyFilterStatus('');
                    return appids;
                })
                .catch((err) => {
                    familyOnlyAppIds = null;
                    markFamilyOnlyRows();
                    setFamilyFilterEnabled(false);
                    setFamilyFilterStatus('Unavailable', 'error');
                    console.warn(
                        'Steam Page Tools: could not load the family library',
                        err
                    );
                    return null;
                })
                .finally(() => {
                    familyDataRequest = null;
                });

            return familyDataRequest;
        }

        async function fetchFamilyOnlyAppIds() {
            const tokenResponse = await fetch(
                `${location.origin}/pointssummary/ajaxgetasyncconfig`,
                {
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                }
            );

            if (!tokenResponse.ok) {
                throw new Error(`token request returned HTTP ${tokenResponse.status}`);
            }

            const tokenPayload = await tokenResponse.json();
            const accessToken = tokenPayload?.data?.webapi_token;

            if (!tokenPayload?.success || !accessToken) {
                throw new Error('Steam did not return a Web API token');
            }

            const url = new URL(
                'https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/'
            );

            url.searchParams.set('access_token', accessToken);
            // The authenticated service resolves the group from the token.
            url.searchParams.set('family_groupid', '0');
            // Steam returns both personal and family licenses only when this
            // counterintuitive flag is enabled.
            url.searchParams.set('include_own', 'true');
            url.searchParams.set('include_excluded', 'true');
            url.searchParams.set('include_free', 'false');
            url.searchParams.set('include_non_games', 'false');

            const libraryResponse = await fetch(url.toString(), {
                credentials: 'omit',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });

            if (!libraryResponse.ok) {
                throw new Error(
                    `family library request returned HTTP ${libraryResponse.status}`
                );
            }

            const payload = await libraryResponse.json();

            return getFamilyOnlyAppIds(payload?.response);
        }

        function markFamilyOnlyRows() {
            document
                .querySelectorAll('.search_result_row')
                .forEach((row) => markFamilyOnlyRow(row, extractAppId(row)));
        }

        function markFamilyOnlyRow(row, appid) {
            row.classList.toggle(
                FAMILY_SHARED_ROW_CLASS,
                Boolean(appid && familyOnlyAppIds?.has(appid))
            );
        }

        let scanAttempts = 0;

        const scanInterval = setInterval(() => {
            scanAttempts += 1;

            const container =
                document.querySelector('#search_resultsRows') ||
                document.querySelector('.search_results_rows');

            if (container) {
                container
                    .querySelectorAll('.search_result_row')
                    .forEach(processRow);

                observeResults(container);

                clearInterval(scanInterval);
            } else if (scanAttempts > 20) {
                clearInterval(scanInterval);
            }
        }, 250);

        // Observe infinite-scroll results as well as the initial result set.
        function observeResults(container) {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType !== 1) {
                            return;
                        }

                        if (node.matches && node.matches('.search_result_row')) {
                            processRow(node);
                        } else if (node.querySelectorAll) {
                            node
                                .querySelectorAll('.search_result_row')
                                .forEach(processRow);
                        }
                    });
                }
            });

            observer.observe(container, { childList: true, subtree: true });
        }

        function extractAppId(row) {
            const raw = row.getAttribute('data-ds-appid');

            if (raw) {
                // Comma-separated app IDs identify an unsupported bundle.
                return raw.includes(',') ? null : raw.trim();
            }

            // Fall back to the app ID embedded in the result URL.
            const href = row.getAttribute('href') || '';
            const match = href.match(/\/app\/(\d+)\//);

            return match ? match[1] : null;
        }

        function processRow(row) {
            if (row.dataset.sptProcessed) {
                return;
            }

            row.dataset.sptProcessed = '1';

            const appid = extractAppId(row);

            if (!appid) {
                return;
            }

            markFamilyOnlyRow(row, appid);

            const nameEl = row.querySelector('.title');
            const name = nameEl ? nameEl.textContent.trim() : `App ${appid}`;

            // Position against the capsule; the full row includes the price
            // column.
            const capsule = row.querySelector('.search_capsule') || row;

            if (getComputedStyle(capsule).position === 'static') {
                capsule.style.position = 'relative';
            }

            const box = document.createElement('div');

            box.className = 'spt-cart-checkbox';
            box.tabIndex = 0;
            box.setAttribute('role', 'checkbox');
            box.setAttribute('aria-checked', 'false');
            box.title = 'Select for bulk cart or wishlist actions';

            if (selected.has(appid)) {
                const info = selected.get(appid);

                info.box = box;
                box.classList.add('spt-checked');
                box.setAttribute('aria-checked', 'true');
            }

            // Prevent the checkbox from following the enclosing result link.
            box.addEventListener('mousedown', (e) => e.stopPropagation());
            box.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSelection(appid, name, box);
            });

            box.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSelection(appid, name, box);
                }
            });

            capsule.appendChild(box);
        }

        function toggleSelection(appid, name, box) {
            if (busy) {
                return;
            }

            if (selected.has(appid)) {
                selected.delete(appid);
                box.classList.remove('spt-checked');
                box.setAttribute('aria-checked', 'false');
            } else {
                selected.set(appid, { name, box });
                box.classList.add('spt-checked');
                box.setAttribute('aria-checked', 'true');
            }

            saveSelection();
            updateBar();
        }

        function updateBar() {
            const count = selected.size;

            bar.cartLabel.textContent = `Add ${count} to Cart`;
            bar.wishlistLabel.textContent = `Add ${count} to Wishlist`;

            if (count > 0) {
                bar.el.classList.add('spt-visible');
            } else if (!busy) {
                bar.el.classList.remove('spt-visible');
                setStatus('');
            }
        }

        function setStatus(text, destination) {
            bar.status.textContent = text;

            if (destination) {
                bar.status.appendChild(document.createTextNode(' '));

                const link = document.createElement('a');

                if (destination === 'wishlist') {
                    link.href = 'https://store.steampowered.com/wishlist/';
                    link.textContent = 'View wishlist';
                } else {
                    link.href = 'https://store.steampowered.com/cart/';
                    link.textContent = 'View cart';
                }

                link.style.color = '#67c1f1';

                bar.status.appendChild(link);
            }
        }

        function readStoreAccount() {
            const configEl = document.querySelector('#application_config');
            let userInfo = {};
            let appConfig = {};

            if (configEl) {
                try {
                    userInfo = JSON.parse(configEl.dataset.userinfo || '{}');
                } catch (err) {
                    console.warn(
                        'Steam Page Tools: could not read Steam user info',
                        err
                    );
                }

                try {
                    appConfig = JSON.parse(configEl.dataset.config || '{}');
                } catch (err) {
                    console.warn(
                        'Steam Page Tools: could not read Steam store config',
                        err
                    );
                }
            }

            const accountid = String(
                userInfo.accountid || window.g_AccountID || ''
            );
            const country = String(
                userInfo.country_code || appConfig.COUNTRY || ''
            ).toUpperCase();

            if (!accountid || accountid === '0' || !country) {
                throw new Error('not signed in or account data is unavailable');
            }

            return { accountid, country };
        }

        function bumpDynamicStoreVersion() {
            try {
                const current =
                    parseInt(
                        localStorage.getItem('unUserdataVersion') || '0',
                        10
                    ) || 0;
                const next = current + 1;

                localStorage.setItem('unUserdataVersion', String(next));

                return next;
            } catch {
                return Date.now();
            }
        }

        // Refresh the complete account wishlist before each run because DOM
        // state can be stale or incomplete.
        async function fetchCurrentWishlist() {
            const { accountid, country } = readStoreAccount();
            const version = bumpDynamicStoreVersion();
            const url = new URL(
                'https://store.steampowered.com/dynamicstore/userdata/'
            );

            url.searchParams.set('id', accountid);
            url.searchParams.set('cc', country);
            url.searchParams.set('origin', location.origin);
            url.searchParams.set('v', String(version));
            url.searchParams.set('_', String(Date.now()));

            const res = await fetch(url.toString(), {
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const json = await res.json();

            if (!json || !Array.isArray(json.rgWishlist)) {
                throw new Error('Steam returned invalid wishlist data');
            }

            return new Set(json.rgWishlist.map((appid) => String(appid)));
        }

        async function addAppToWishlist(appid, sessionid) {
            const body = new URLSearchParams({
                sessionid,
                appid: String(appid),
            });

            const res = await fetch(
                'https://store.steampowered.com/api/addtowishlist',
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                    },
                    body: body.toString(),
                }
            );

            if (!res.ok) {
                const err = new Error(`HTTP ${res.status}`);

                err.rateLimited = res.status === 429;
                throw err;
            }

            const json = await res.json();

            if (!json || (json.success !== true && json.success !== 1)) {
                throw new Error('Steam did not confirm the wishlist change');
            }
        }

        function removeHandledSelection(appid, info) {
            selected.delete(appid);

            if (info.box) {
                info.box.classList.remove('spt-checked');
                info.box.setAttribute('aria-checked', 'false');
            }
        }

        function syncDynamicWishlist(appids) {
            const dynamicStore = window.GDynamicStore;

            try {
                if (dynamicStore && dynamicStore.s_rgWishlist) {
                    appids.forEach((appid) => {
                        dynamicStore.s_rgWishlist[appid] = true;
                    });
                }

                if (
                    dynamicStore &&
                    typeof dynamicStore.InvalidateCache === 'function'
                ) {
                    dynamicStore.InvalidateCache();
                } else {
                    bumpDynamicStoreVersion();
                }
            } catch {
                bumpDynamicStoreVersion();
            }
        }

        // Cart mutations require a package (sub) ID, so resolve Steam's
        // default purchase option for each app.
        async function resolveSubId(appid) {
            const res = await fetch(
                `https://store.steampowered.com/api/appdetails?appids=${appid}`,
                { credentials: 'include' }
            );

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const json = await res.json();
            const entry = json[appid];

            if (!entry || !entry.success || !entry.data) {
                throw new Error('no purchase data for this app');
            }

            const groups = entry.data.package_groups;

            if (groups && groups.length && groups[0].subs && groups[0].subs.length) {
                return groups[0].subs[0].packageid;
            }

            if (entry.data.packages && entry.data.packages.length) {
                return entry.data.packages[0];
            }

            throw new Error('no purchasable package found');
        }

        async function addSubToCart(subid, sessionid) {
            const body = new URLSearchParams({
                action: 'add_to_cart',
                sessionid,
                subid: String(subid),
            });

            const res = await fetch('https://store.steampowered.com/cart/', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
        }

        function buildBar() {
            const el = document.createElement('div');

            el.id = 'spt-cart-bar';

            const status = document.createElement('span');

            status.id = 'spt-cart-status';

            const actions = document.createElement('div');

            actions.id = 'spt-store-actions';

            const addWrap = document.createElement('div');

            addWrap.className = 'btn_addtocart';

            const addBtn = document.createElement('a');

            addBtn.id = 'spt-add-to-cart-btn';
            addBtn.className = 'btnv6_green_white_innerfade btn_medium';
            addBtn.setAttribute('role', 'button');
            addBtn.tabIndex = 0;

            const cartLabel = document.createElement('span');

            cartLabel.textContent = 'Add 0 to Cart';

            addBtn.appendChild(cartLabel);
            addWrap.appendChild(addBtn);

            const wishlistWrap = document.createElement('div');

            wishlistWrap.className = 'btn_addtocart';

            const wishlistBtn = document.createElement('a');

            wishlistBtn.id = 'spt-add-to-wishlist-btn';
            wishlistBtn.className = 'btnv6_blue_hoverfade btn_medium';
            wishlistBtn.setAttribute('role', 'button');
            wishlistBtn.tabIndex = 0;
            wishlistBtn.title =
                'Already-wishlisted games are checked and skipped automatically';

            const wishlistLabel = document.createElement('span');

            wishlistLabel.textContent = 'Add 0 to Wishlist';

            wishlistBtn.appendChild(wishlistLabel);
            wishlistWrap.appendChild(wishlistBtn);
            actions.appendChild(addWrap);
            actions.appendChild(wishlistWrap);

            const closeBtn = document.createElement('span');

            closeBtn.id = 'spt-cart-close';
            closeBtn.textContent = '\u2715';
            closeBtn.title = 'Clear selection';
            closeBtn.setAttribute('role', 'button');
            closeBtn.tabIndex = 0;

            closeBtn.addEventListener('click', () => {
                clearSelection();
            });

            closeBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    closeBtn.click();
                }
            });

            el.appendChild(status);
            el.appendChild(actions);
            el.appendChild(closeBtn);

            function setActionBusy(isBusy) {
                busy = isBusy;

                [addBtn, wishlistBtn].forEach((button) => {
                    button.style.pointerEvents = isBusy ? 'none' : '';
                    button.style.opacity = isBusy ? '0.6' : '';
                    button.setAttribute(
                        'aria-disabled',
                        isBusy ? 'true' : 'false'
                    );
                });

                closeBtn.style.pointerEvents = isBusy ? 'none' : '';
                closeBtn.style.opacity = isBusy ? '0.6' : '';
            }

            async function onAddToCart() {
                if (busy || selected.size === 0) {
                    return;
                }

                const sessionid = getSessionId();

                if (!sessionid) {
                    setStatus('Could not find your session ID - try refreshing the page.');
                    return;
                }

                setActionBusy(true);

                const entries = [...selected.entries()];
                const failed = [];

                try {
                    for (let i = 0; i < entries.length; i += 1) {
                        const [appid, info] = entries[i];

                        setStatus(
                            `Adding ${i + 1} of ${entries.length} to cart: ${info.name}...`
                        );

                        try {
                            const subid = await resolveSubId(appid);

                            await addSubToCart(subid, sessionid);

                            removeHandledSelection(appid, info);
                            saveSelection();
                        } catch (err) {
                            console.error(
                                'Steam Page Tools: failed to add to cart',
                                appid,
                                err
                            );
                            failed.push(info.name);
                        }

                        updateBar();

                        if (i < entries.length - 1) {
                            await sleep(400);
                        }
                    }

                    if (failed.length) {
                        setStatus(
                            `Added ${entries.length - failed.length} of ${entries.length} to cart. ${failed.length} failed and stayed selected.`,
                            'cart'
                        );
                    } else {
                        setStatus(
                            `Added ${entries.length} game(s) to cart.`,
                            'cart'
                        );
                    }
                } finally {
                    setActionBusy(false);
                }
            }

            async function onAddToWishlist() {
                if (busy || selected.size === 0) {
                    return;
                }

                const sessionid = getSessionId();

                if (!sessionid) {
                    setStatus(
                        'Could not find your session ID - try refreshing the page.'
                    );
                    return;
                }

                setActionBusy(true);

                try {
                    setStatus('Checking your current Steam wishlist...');

                    let currentWishlist;

                    try {
                        currentWishlist = await fetchCurrentWishlist();
                    } catch (err) {
                        console.error(
                            'Steam Page Tools: failed to verify wishlist',
                            err
                        );
                        setStatus(
                            'Could not verify your current wishlist, so nothing was added. Try refreshing the page.'
                        );
                        return;
                    }

                    const entries = [...selected.entries()];
                    const pending = [];
                    const skipped = [];
                    const addedAppids = [];
                    const failed = [];
                    let rateLimited = false;

                    entries.forEach(([appid, info]) => {
                        if (currentWishlist.has(appid)) {
                            skipped.push(info.name);
                            removeHandledSelection(appid, info);
                        } else {
                            pending.push([appid, info]);
                        }
                    });

                    if (skipped.length) {
                        saveSelection();
                        updateBar();
                    }

                    for (let i = 0; i < pending.length; i += 1) {
                        const [appid, info] = pending[i];

                        setStatus(
                            `Adding ${i + 1} of ${pending.length} to wishlist: ${info.name}...`
                        );

                        try {
                            await addAppToWishlist(appid, sessionid);

                            currentWishlist.add(appid);
                            addedAppids.push(appid);
                            removeHandledSelection(appid, info);
                            saveSelection();
                        } catch (err) {
                            console.error(
                                'Steam Page Tools: failed to add to wishlist',
                                appid,
                                err
                            );
                            failed.push(info.name);

                            if (err.rateLimited) {
                                rateLimited = true;
                            }
                        }

                        updateBar();

                        if (rateLimited) {
                            break;
                        }

                        if (i < pending.length - 1) {
                            await sleep(800);
                        }
                    }

                    if (addedAppids.length) {
                        syncDynamicWishlist(addedAppids);
                    }

                    let message =
                        `Added ${addedAppids.length} game(s) to wishlist.`;

                    if (skipped.length) {
                        message +=
                            ` Skipped ${skipped.length} already wishlisted.`;
                    }

                    if (failed.length) {
                        message +=
                            ` ${failed.length} failed and stayed selected.`;
                    }

                    if (rateLimited) {
                        message +=
                            ' Steam asked to slow down; remaining games stayed selected.';
                    }

                    setStatus(message, 'wishlist');
                } finally {
                    setActionBusy(false);
                }
            }

            bindButtonActivation(addBtn, onAddToCart);
            bindButtonActivation(wishlistBtn, onAddToWishlist);

            return { el, status, cartLabel, wishlistLabel };
        }

        function injectStyles() {
            const style = document.createElement('style');

            style.textContent = `
                .spt-cart-checkbox {
                    position: absolute;
                    bottom: 4px;
                    right: 4px;
                    width: 18px;
                    height: 18px;
                    border-radius: 2px;
                    background: rgba(27, 40, 56, 0.9);
                    border: 1px solid #67c1f1;
                    cursor: pointer;
                    z-index: 5;
                }

                .spt-cart-checkbox.spt-checked {
                    background: #67c1f1;
                }

                .spt-cart-checkbox.spt-checked::after {
                    content: '';
                    position: absolute;
                    left: 5px;
                    top: 1px;
                    width: 5px;
                    height: 9px;
                    border: solid #1b2838;
                    border-width: 0 2px 2px 0;
                    transform: rotate(45deg);
                }

                html.${FAMILY_FILTER_ACTIVE_CLASS}
                    .search_result_row.${FAMILY_SHARED_ROW_CLASS} {
                    display: none !important;
                }

                .spt-family-filter-control {
                    flex-grow: 1;
                    box-sizing: border-box;
                    min-width: 0;
                    padding: 0 8px;
                    color: #9fbbcb;
                    cursor: pointer;
                    font-family: "Motiva Sans", Arial, sans-serif;
                    font-size: 13px;
                    line-height: 28px;
                }

                .spt-family-filter-control
                    > .tab_filter_label_container {
                    display: grid;
                    grid-template-columns:
                        min-content minmax(0, 1fr) min-content;
                    width: 100%;
                }

                .spt-family-filter-row.checked
                    .spt-family-filter-control {
                    color: #ffffff;
                }

                .spt-family-filter-input {
                    position: absolute;
                    width: 1px;
                    height: 1px;
                    margin: 0;
                    opacity: 0;
                    pointer-events: none;
                }

                .spt-family-filter-checkbox {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    margin-right: 8px;
                    background-image:
                        url('/public/images/v6/store_checkbox_blue.png');
                    background-position: top center;
                    vertical-align: text-bottom;
                    transform: translateY(3px);
                }

                .spt-family-filter-input:checked
                    + .tab_filter_label_container
                    .spt-family-filter-checkbox {
                    background-position: bottom center;
                }

                .spt-family-filter-input:focus-visible
                    + .tab_filter_label_container
                    .spt-family-filter-checkbox {
                    outline: 1px solid #ffffff;
                    outline-offset: 1px;
                }

                .spt-family-filter-status {
                    display: none;
                    white-space: nowrap;
                }

                .spt-family-filter-row.spt-loading
                    .spt-family-filter-control {
                    cursor: progress;
                }

                .spt-family-filter-row.spt-error
                    .spt-family-filter-status {
                    color: #d94126;
                }

                #spt-cart-bar {
                    position: fixed;
                    right: 20px;
                    bottom: 20px;
                    z-index: 10000;
                    display: none;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 12px;
                    max-width: calc(100vw - 40px);
                    background: #1b2838;
                    border: 1px solid #2a475e;
                    border-radius: 3px;
                    padding: 10px 14px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
                    font-family: "Motiva Sans", Arial, sans-serif;
                }

                #spt-cart-bar.spt-visible {
                    display: flex;
                }

                #spt-cart-status {
                    color: #8f98a0;
                    font-size: 12px;
                    max-width: 280px;
                    flex: 0 1 auto;
                }

                #spt-cart-status:empty {
                    display: none;
                }

                #spt-store-actions {
                    display: flex;
                    align-items: center;
                    flex: 0 0 auto;
                    flex-wrap: nowrap;
                    gap: 4px;
                }

                #spt-store-actions .btn_addtocart {
                    float: none;
                    margin: 0;
                }

                #spt-cart-close {
                    cursor: pointer;
                    color: #8f98a0;
                    font-size: 13px;
                    padding: 2px 4px;
                }

                #spt-cart-close:hover {
                    color: #ffffff;
                }
            `;

            document.head.appendChild(style);
        }
    }
})();
