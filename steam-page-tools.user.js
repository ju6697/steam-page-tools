// ==UserScript==
// @name         Steam Page Tools
// @namespace    local.steam-page-tools
// @version      1.7.2
// @description  Userscript for Violentmonkey and Tampermonkey that enhances various Steam pages with quality-of-life tools.
// @author       x0697x
// @license      MIT
// @match        https://steamcommunity.com/id/*/badges*
// @match        https://steamcommunity.com/profiles/*/badges*
// @match        https://store.steampowered.com/search/*
// @match        https://store.steampowered.com/search*
// @grant        none
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3QgeD0iOCIgeT0iMTQiIHdpZHRoPSIzNiIgaGVpZ2h0PSI0MCIgcng9IjQiIGZpbGw9IiMxYjI4MzgiIHN0cm9rZT0iIzY2YzBmNCIgc3Ryb2tlLXdpZHRoPSIyIiB0cmFuc2Zvcm09InJvdGF0ZSgtOCAyNiAzNCkiLz48cmVjdCB4PSIxOCIgeT0iMTAiIHdpZHRoPSIzNiIgaGVpZ2h0PSI0MCIgcng9IjQiIGZpbGw9IiMyYTQ3NWUiIHN0cm9rZT0iIzY2YzBmNCIgc3Ryb2tlLXdpZHRoPSIyIi8+PHJlY3QgeD0iMjIiIHk9IjE0IiB3aWR0aD0iMjgiIGhlaWdodD0iNiIgcng9IjEuNSIgZmlsbD0iIzFiMjgzOCIvPjxyZWN0IHg9IjIyIiB5PSIyNCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIuNSIgcng9IjEiIGZpbGw9IiM2NmMwZjQiIG9wYWNpdHk9IjAuNSIvPjxyZWN0IHg9IjIyIiB5PSIzMCIgd2lkdGg9IjE2IiBoZWlnaHQ9IjIuNSIgcng9IjEiIGZpbGw9IiM2NmMwZjQiIG9wYWNpdHk9IjAuMzUiLz48cmVjdCB4PSIyMiIgeT0iMzYiIHdpZHRoPSIxOCIgaGVpZ2h0PSIyLjUiIHJ4PSIxIiBmaWxsPSIjNjZjMGY0IiBvcGFjaXR5PSIwLjM1Ii8+PGNpcmNsZSBjeD0iNDYiIGN5PSI0MiIgcj0iOSIgZmlsbD0iIzY2YzBmNCIgb3BhY2l0eT0iMC4xOCIvPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQwIDM2KSByb3RhdGUoMzUpIj48cmVjdCB4PSItMiIgeT0iLTEwIiB3aWR0aD0iNCIgaGVpZ2h0PSIxNCIgcng9IjEuNSIgZmlsbD0iIzY2YzBmNCIvPjxjaXJjbGUgY3g9IjAiIGN5PSItMTIiIHI9IjUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzY2YzBmNCIgc3Ryb2tlLXdpZHRoPSIzIi8+PGNpcmNsZSBjeD0iMCIgY3k9Ii0xMiIgcj0iMiIgZmlsbD0iIzFiMjgzOCIvPjwvZz48L3N2Zz4=
// @updateURL    https://raw.githubusercontent.com/x0697x/steam-page-tools/main/steam-page-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/x0697x/steam-page-tools/main/steam-page-tools.user.js
// @homepageURL  https://github.com/x0697x/steam-page-tools
// ==/UserScript==

(function () {
    'use strict';

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    if (location.hostname === 'steamcommunity.com') {
        initBadgesDropFilter();
    } else if (location.hostname === 'store.steampowered.com') {
        initSearchBulkCart();
    }

    // =====================================================================
    // Badges page: filter by card drops remaining
    // =====================================================================
    function initBadgesDropFilter() {
        // English-only fallback. Only used if the structural markers below
        // stop matching (e.g. after a Steam markup change). Not the primary
        // detection path, so it does not need one entry per language.
        const DROPS_REGEX_FALLBACK = /(\d+)\s*card drops?\s*remaining/i;

        function getRows(root = document) {
            return [...root.querySelectorAll('.badge_row')];
        }

        // Language-independent detection: Steam only renders the "Play Game"
        // control inside a badge's stats block when that badge still has card
        // drops remaining. That's a CSS class name, not translated text, so it
        // holds regardless of interface language.
        function hasDropsRemaining(row) {
            if (row.querySelector('.badge_title_playgame, .badge_title_stats_playgame')) {
                return true;
            }

            if (row.querySelector('.badge_title_stats_completed')) {
                return false;
            }

            // Ambiguous row (neither marker found) - fall back to text rather
            // than assume "no drops".
            return DROPS_REGEX_FALLBACK.test(row.textContent);
        }

        function getCurrentPageNumber() {
            return parseInt(new URL(location.href).searchParams.get('p') || '1', 10);
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

        // Structural, exact page count instead of guessing from empty or
        // repeated fetch results: Steam's own pagination links point to this
        // same URL with a different "p" value, so the highest one present is
        // the real last page. Returns null if no such links are found.
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

        const MAX_PAGES = 200; // absolute safety cap, not an expected page count

        function insertControl() {
            const rows = getRows();

            if (!rows.length) {
                return false;
            }

            // Bar layout only; the toggle itself reuses Steam's own button
            // component.
            const bar = document.createElement('div');

            bar.style.cssText =
                'display:flex; align-items:center; justify-content:flex-end; gap:10px; margin:10px 0;';

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

            bar.appendChild(status);
            bar.appendChild(toggle);

            const container = rows[0].parentElement;

            container.insertBefore(bar, rows[0]);

            let active = false;
            let busy = false;
            let extraRows = [];

            function setBusy(isBusy) {
                busy = isBusy;

                toggle.style.pointerEvents = isBusy ? 'none' : '';
                toggle.style.opacity = isBusy ? '0.6' : '';
            }

            // Steam's own button classes don't include a distinct "pressed"
            // look, so the on-state is layered on top with an inset border.
            function setActiveStyle(isActive) {
                toggle.style.boxShadow =
                    isActive ? 'inset 0 0 0 1px #67c1f1' : '';
            }

            async function runFilter() {
                // Immediately filter what's already on the current page.
                getRows().forEach((row) => {
                    row.style.display = hasDropsRemaining(row) ? '' : 'none';
                });

                const currentPage = getCurrentPageNumber();

                setBusy(true);

                // Read the real page count up front rather than stopping the
                // loop when a fetch happens to come back empty or repeated.
                const maxPage = Math.min(
                    getMaxPageFromPagination() || currentPage,
                    MAX_PAGES
                );

                for (let page = 1; page <= maxPage && active; page += 1) {
                    if (page === currentPage) {
                        continue;
                    }

                    status.textContent =
                        `Loading page ${page} of ${maxPage}...`;

                    let rows = null;

                    for (let attempt = 0; attempt < 2 && rows === null; attempt += 1) {
                        try {
                            rows = await fetchPageRows(page);
                        } catch (err) {
                            console.error(
                                'Steam Page Tools: failed loading page',
                                page,
                                err
                            );

                            if (attempt === 0) {
                                await sleep(500);
                            }
                        }
                    }

                    if (rows === null) {
                        continue;
                    }

                    // IMPORTANT:
                    // Do NOT deduplicate rows by appid.
                    //
                    // Steam can have separate normal and foil badge rows for
                    // the same game. Both rows link to the same
                    // /gamecards/{appid}/ URL, but they are separate badge
                    // states. A completed normal badge must not cause a foil
                    // badge with remaining drops to be discarded.
                    rows
                        .filter(hasDropsRemaining)
                        .forEach((row) => {
                            const clone = row.cloneNode(true);

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
                if (busy) {
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

            toggle.addEventListener('click', onToggle);

            toggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                }
            });

            return true;
        }

        // The badges list can render slightly after DOMContentLoaded,
        // so retry briefly.
        let attempts = 0;

        const interval = setInterval(() => {
            attempts += 1;

            if (insertControl() || attempts > 20) {
                clearInterval(interval);
            }
        }, 250);
    }

    // =====================================================================
    // Store search results page: bulk-select + Add to Cart
    //
    // Adds a small checkbox over each result's capsule image and a floating
    // "Add to Cart" button. Checking games and clicking the button queues
    // them up and adds each one to the cart without leaving the search page.
    //
    // Known limitations, by design rather than oversight:
    // - Bundle rows (a single result linking to more than one appid) are
    //   skipped. Bundles are purchased as a bundle package, not as the sum
    //   of their apps' packages, which is a different lookup than the one
    //   below.
    // - Games with multiple purchase options (editions, DLC bundles on the
    //   store page, etc.) are added using Steam's own default/first option
    //   for that app, same as clicking the app's own primary "Add to Cart"
    //   button would generally do.
    // =====================================================================
    function initSearchBulkCart() {
        const STORAGE_KEY = 'spt-search-cart-selection';
        const LEGACY_STORAGE_KEY = 'dbf-search-cart-selection';
        const selected = new Map(); // appid -> { name, box }
        let busy = false;

        injectStyles();

        const bar = buildBar();
        document.body.appendChild(bar.el);

        restoreSelection();

        // Selections are kept in localStorage (not just in memory) so they
        // survive a misclick to another page, a back-button navigation, or
        // even closing and reopening the tab. Cleared as each game is
        // successfully added, or via the bar's clear-selection control.
        function loadStoredSelection() {
            try {
                let raw = localStorage.getItem(STORAGE_KEY);

                // One-time migration from the old script name.
                if (!raw) {
                    raw = localStorage.getItem(LEGACY_STORAGE_KEY);

                    if (raw) {
                        localStorage.setItem(STORAGE_KEY, raw);
                        localStorage.removeItem(LEGACY_STORAGE_KEY);
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

        // Restored entries have no checkbox element yet - box stays null
        // until processRow() encounters that appid's row on some page and
        // attaches it.
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

        // The results list can grow via infinite scroll as well as full page
        // loads, so new rows need to be picked up as they appear rather than
        // just on the initial scan.
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
                // Multiple comma-separated appids means this row is a
                // bundle - not supported, see notes above.
                return raw.includes(',') ? null : raw.trim();
            }

            // Fallback if the data attribute is ever renamed or missing:
            // read the appid straight out of the row's own link.
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

            const nameEl = row.querySelector('.title');
            const name = nameEl ? nameEl.textContent.trim() : `App ${appid}`;

            // Anchored to the capsule thumbnail specifically, not the row -
            // the row spans the full width including the price column, so
            // positioning against it let the checkbox drift onto the price.
            const capsule = row.querySelector('.search_capsule') || row;

            if (getComputedStyle(capsule).position === 'static') {
                capsule.style.position = 'relative';
            }

            const box = document.createElement('div');

            box.className = 'spt-cart-checkbox';
            box.tabIndex = 0;
            box.setAttribute('role', 'checkbox');
            box.setAttribute('aria-checked', 'false');
            box.title = 'Select for bulk Add to Cart';

            if (selected.has(appid)) {
                const info = selected.get(appid);

                info.box = box;
                box.classList.add('spt-checked');
                box.setAttribute('aria-checked', 'true');
            }

            // Stop the click from also triggering the row's own link, since
            // the whole row is an <a>.
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

            bar.label.textContent = `Add ${count} to Cart`;

            if (count > 0) {
                bar.el.classList.add('spt-visible');
            } else if (!busy) {
                bar.el.classList.remove('spt-visible');
                setStatus('');
            }
        }

        function setStatus(text, withCartLink) {
            bar.status.textContent = text;

            if (withCartLink) {
                bar.status.appendChild(document.createTextNode(' '));

                const link = document.createElement('a');

                link.href = 'https://store.steampowered.com/cart/';
                link.textContent = 'View cart';
                link.style.color = '#67c1f1';

                bar.status.appendChild(link);
            }
        }

        function getSessionId() {
            if (window.g_sessionID) {
                return window.g_sessionID;
            }

            const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);

            return match ? decodeURIComponent(match[1]) : null;
        }

        // Search results only carry the appid. Buying happens by package
        // (subid), so each app's default purchase option is looked up via
        // Steam's own storefront API - the same data that populates the
        // app page's own "Add to Cart" button.
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
                sessionid: sessionid,
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

            const addWrap = document.createElement('div');

            addWrap.className = 'btn_addtocart';

            const addBtn = document.createElement('a');

            addBtn.id = 'spt-add-to-cart-btn';
            addBtn.className = 'btnv6_green_white_innerfade btn_medium';
            addBtn.setAttribute('role', 'button');
            addBtn.tabIndex = 0;

            const label = document.createElement('span');

            label.textContent = 'Add 0 to Cart';

            addBtn.appendChild(label);
            addWrap.appendChild(addBtn);

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
            el.appendChild(addWrap);
            el.appendChild(closeBtn);

            async function onAdd() {
                if (busy || selected.size === 0) {
                    return;
                }

                const sessionid = getSessionId();

                if (!sessionid) {
                    setStatus('Could not find your session ID - try refreshing the page.');
                    return;
                }

                busy = true;
                addBtn.style.pointerEvents = 'none';
                addBtn.style.opacity = '0.6';

                const entries = [...selected.entries()];
                const failed = [];

                for (let i = 0; i < entries.length; i += 1) {
                    const [appid, info] = entries[i];

                    setStatus(`Adding ${i + 1} of ${entries.length}: ${info.name}...`);

                    try {
                        const subid = await resolveSubId(appid);

                        await addSubToCart(subid, sessionid);

                        selected.delete(appid);

                        if (info.box) {
                            info.box.classList.remove('spt-checked');
                            info.box.setAttribute('aria-checked', 'false');
                        }

                        saveSelection();
                    } catch (err) {
                        console.error('Steam Page Tools: failed to add', appid, err);
                        failed.push(info.name);
                    }

                    label.textContent = `Add ${selected.size} to Cart`;

                    await sleep(400);
                }

                if (failed.length) {
                    setStatus(
                        `Added ${entries.length - failed.length} of ${entries.length}. Failed: ${failed.join(', ')}.`,
                        true
                    );
                } else {
                    setStatus(`Added ${entries.length} game(s) to cart.`, true);
                }

                busy = false;
                addBtn.style.pointerEvents = '';
                addBtn.style.opacity = '';
            }

            addBtn.addEventListener('click', onAdd);
            addBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onAdd();
                }
            });

            return { el, status, label };
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

                #spt-cart-bar {
                    position: fixed;
                    right: 20px;
                    bottom: 20px;
                    z-index: 10000;
                    display: none;
                    align-items: center;
                    gap: 12px;
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
