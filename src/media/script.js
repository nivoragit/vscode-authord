/**
 * tabs.js
 *
 * Switchable tabs without requiring any new CSS.
 * Works with either of these patterns:
 *
 * 1) "Classic" markup:
 *   <div class="tabs">
 *     <div class="tabs__titles">
 *       <div class="tabs__title" data-tab-id="tab-1">Title</div>
 *       ...
 *     </div>
 *     <div class="tabs__content" data-tab-id="tab-1">...</div>
 *     ...
 *   </div>
 *
 * 2) "API tabs" markup:
 *   <div class="tabs__content-wrapper">
 *     <div class="api-tabs">
 *       <div role="tab" data-test="tab tab-1 selected">Title</div>
 *       <div role="tab" data-test="tab tab-2">Title</div>
 *       <span class="_indicator_1fcqo6x_19"></span>
 *     </div>
 *     <div data-tab-id="tab-1">...</div>
 *     <div data-tab-id="tab-2">...</div>
 *   </div>
 *
 * Behavior:
 * - No inline styles are applied. Panels are toggled via the standard `hidden` attribute.
 * - Adds basic ARIA roles/attributes for accessibility.
 * - Keyboard: Left/Right (or Up/Down) to move, Home/End to jump, Enter/Space to activate.
 */

(function () {
  "use strict";

  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  const themeClasses = [
    "vscode-light",
    "vscode-dark",
    "vscode-high-contrast",
    "vscode-high-contrast-light",
  ];

  let lineElements = [];
  let activeLineEl = null;
  let isSyncing = false;
  let rafHandle = 0;
  let headingElements = [];
  let scrollAnimationHandle = 0;

  function setHtmlThemeClass(kind) {
    if (typeof kind !== "string") return;
    const root = document.documentElement;
    const isDark = kind === "vscode-dark" || kind === "vscode-high-contrast";
    root.classList.toggle("theme-dark", isDark);
  }

  function applyThemeMessage(msg) {
    if (!msg || typeof msg !== "object" || msg.command !== "setTheme") return;
    const body = document.body;
    if (!body) return;

    themeClasses.forEach((klass) => body.classList.remove(klass));
    if (typeof msg.className === "string") body.classList.add(msg.className);
    if (typeof msg.extraClass === "string") body.classList.add(msg.extraClass);
    if (typeof msg.kind === "string") body.setAttribute("data-vscode-theme-kind", msg.kind);

    const kind = typeof msg.kind === "string" ? msg.kind : msg.className;
    setHtmlThemeClass(kind);
  }

  function collapseWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeAnchorText(text) {
    const collapsed = collapseWhitespace(text);
    if (!collapsed) return "";
    return collapsed.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  }

  function getAnchorWord(text) {
    const match = String(text || "").match(/[a-z0-9]+/i);
    return match ? match[0] : "";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getMaxScroll() {
    const root = document.documentElement;
    const maxScroll = root ? root.scrollHeight - window.innerHeight : 0;
    return Math.max(0, maxScroll);
  }

  function cancelScrollAnimation() {
    if (scrollAnimationHandle) {
      window.cancelAnimationFrame(scrollAnimationHandle);
      scrollAnimationHandle = 0;
    }
    isSyncing = false;
  }

  function smoothScrollTo(targetTop, baseDuration) {
    cancelScrollAnimation();
    const startTop = window.scrollY;
    const maxScroll = getMaxScroll();
    const safeTarget = clamp(targetTop, 0, maxScroll);
    const diff = safeTarget - startTop;
    if (Math.abs(diff) < 1) return;

    const duration =
      typeof baseDuration === "number"
        ? baseDuration
        : clamp(Math.abs(diff) * 0.4, 180, 600);
    const startTime = performance.now();
    isSyncing = true;

    function step(now) {
      const t = clamp((now - startTime) / duration, 0, 1);
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      window.scrollTo(0, startTop + diff * eased);
      if (t < 1) {
        scrollAnimationHandle = window.requestAnimationFrame(step);
        return;
      }
      scrollAnimationHandle = 0;
      window.setTimeout(() => {
        isSyncing = false;
      }, 120);
    }

    scrollAnimationHandle = window.requestAnimationFrame(step);
  }

  function collectLineElements() {
    lineElements = Array.from(document.querySelectorAll("[data-line]"))
      .map((el) => {
        const raw = el.getAttribute("data-line");
        const line = raw ? Number(raw) : NaN;
        if (!Number.isFinite(line)) return null;
        const text = collapseWhitespace(el.textContent || "");
        return {
          el,
          line,
          text,
          textNorm: normalizeAnchorText(text),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.line - b.line);
    collectHeadingElements();
  }

  function collectHeadingElements() {
    headingElements = Array.from(
      document.querySelectorAll("h1[data-line], h2[data-line], h3[data-line], h4[data-line], h5[data-line], h6[data-line]")
    )
      .map((el) => {
        const raw = el.getAttribute("data-line");
        const line = raw ? Number(raw) : NaN;
        if (!Number.isFinite(line)) return null;
        const title = (el.textContent || "").trim();
        if (!title) return null;
        return { el, line, title };
      })
      .filter(Boolean)
      .sort((a, b) => a.line - b.line);
  }

  function normalizeHeadingText(text) {
    return text.replace(/\s+#+\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findHeadingByTitle(title) {
    if (!headingElements.length) collectHeadingElements();
    const needle = normalizeHeadingText(title);
    if (!needle) return null;
    return headingElements.find((item) => normalizeHeadingText(item.title) === needle) || null;
  }

  function findForwardHeading(line) {
    if (!headingElements.length) collectHeadingElements();
    for (const item of headingElements) {
      if (item.line >= line) return item;
    }
    return null;
  }

  function adjustLineWithHeading(line, heading) {
    if (!heading || typeof heading.title !== "string" || typeof heading.line !== "number") {
      return line;
    }
    const match = findHeadingByTitle(heading.title);
    if (!match) return line;
    const delta = line - heading.line;
    return match.line + delta;
  }

  function setActiveLine(el) {
    if (activeLineEl === el) return;
    if (activeLineEl) activeLineEl.classList.remove("code-line--active");
    activeLineEl = el;
    if (activeLineEl) activeLineEl.classList.add("code-line--active");
  }

  function findElementByLine(line) {
    let target = null;
    for (const item of lineElements) {
      if (item.line <= line) {
        target = item;
      } else {
        break;
      }
    }
    return target || lineElements[0] || null;
  }

  function findElementByAnchor(anchorNorm, line) {
    if (!anchorNorm) return null;
    let best = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const item of lineElements) {
      if (!item.textNorm || !item.textNorm.includes(anchorNorm)) continue;
      const diff = Math.abs(item.line - line);
      if (diff < bestDiff) {
        best = item;
        bestDiff = diff;
      }
    }
    return best;
  }

  function scrollToAnchorWord(el, word) {
    if (!word) return false;
    const needle = word.toLowerCase();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue || "";
      const index = text.toLowerCase().indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + word.length);
      const rect = range.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.top)) return false;
      const targetTop = window.scrollY + rect.top - 6;
      smoothScrollTo(targetTop);
      return true;
    }
    return false;
  }

  function scrollToAnchor(line, anchor, ratio) {
    if (!lineElements.length) collectLineElements();
    if (!lineElements.length) return;

    const anchorNorm = typeof anchor === "string" ? normalizeAnchorText(anchor) : "";
    const hasAnchor = anchorNorm && anchorNorm.length >= 3;
    const anchorTarget = hasAnchor ? findElementByAnchor(anchorNorm, line) : null;
    const target = anchorTarget || findElementByLine(line);
    if (!target) return;

    const anchorWord = hasAnchor ? getAnchorWord(anchorNorm) : "";
    const didScroll = anchorWord ? scrollToAnchorWord(target.el, anchorWord) : false;
    if (!didScroll) {
      const rect = target.el.getBoundingClientRect();
      const anchorTop = window.scrollY + rect.top - 6;
      const maxScroll = getMaxScroll();
      const ratioTop =
        typeof ratio === "number" && Number.isFinite(ratio)
          ? clamp(ratio, 0, 1) * maxScroll
          : null;
      const useRatio =
        ratioTop !== null &&
        (!hasAnchor || Math.abs(anchorTop - ratioTop) > window.innerHeight * 2);
      smoothScrollTo(useRatio ? ratioTop : anchorTop);
    }
    setActiveLine(target.el);
  }

  function scrollToLine(line) {
    scrollToAnchor(line);
  }

  function sendActiveLine() {
    if (!lineElements.length) collectLineElements();
    if (!lineElements.length) return;

    let current = null;
    for (const item of lineElements) {
      const rect = item.el.getBoundingClientRect();
      if (rect.bottom >= 0) {
        current = item;
        break;
      }
    }
    if (!current) current = lineElements[lineElements.length - 1];

    setActiveLine(current.el);
    if (vscode) {
      const heading = findForwardHeading(current.line);
      const anchor = current.text ? current.text.slice(0, 120) : "";
      const anchorValue = anchor.length >= 3 ? anchor : undefined;
      vscode.postMessage({
        command: "previewScrolled",
        line: current.line,
        heading: heading ? { title: heading.title, line: heading.line } : undefined,
        anchor: anchorValue,
      });
    }
  }

  function uniqId(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  function parseTabIdFromDataTest(el) {
    const dt = el.getAttribute("data-test") || "";
    const tokens = dt.split(/\s+/).filter(Boolean);
    // Prefer tokens like "tab-1", "tab-foo", etc.
    const explicit = tokens.find(t => /^tab[-_]/i.test(t));
    if (explicit) return explicit;
    // Otherwise, the token after "tab"
    const tabIndex = tokens.findIndex(t => t.toLowerCase() === "tab");
    if (tabIndex >= 0 && tokens[tabIndex + 1]) return tokens[tabIndex + 1];
    return null;
  }

  function getTabId(el) {
    if (el.dataset && el.dataset.tabId) return el.dataset.tabId;
    const attr = el.getAttribute("data-tab-id");
    if (attr) return attr;
    if (el.getAttribute("role") === "tab") return parseTabIdFromDataTest(el);
    return null;
  }

  function setSelectedTokenInDataTest(el, selected) {
    const dt = (el.getAttribute("data-test") || "").trim();
    if (!dt) return;

    const tokens = dt.split(/\s+/).filter(Boolean);
    const has = tokens.includes("selected");
    if (selected && !has) tokens.push("selected");
    if (!selected && has) {
      const i = tokens.indexOf("selected");
      tokens.splice(i, 1);
    }
    el.setAttribute("data-test", tokens.join(" "));
  }

  function isTabButton(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute("role") === "tab") return true;
    if (el.classList && el.classList.contains("tabs__title")) return true;
    // Fallback: anything in a titles bar with a data-tab-id
    if (el.hasAttribute("data-tab-id") && el.closest(".tabs__titles")) return true;
    return false;
  }

  function findTabGroups(root) {
    const groups = new Set();

    // Common containers
    root.querySelectorAll(".tabs").forEach(g => groups.add(g));
    root.querySelectorAll(".tabs__content-wrapper").forEach(g => groups.add(g));

    // If someone used .api-tabs alone
    root.querySelectorAll(".api-tabs").forEach(api => groups.add(api.closest(".tabs__content-wrapper") || api.parentElement || api));

    return Array.from(groups);
  }

  function collectTabsAndPanels(groupEl) {
    // Find a "header" area if present
    const titlesEl =
      groupEl.querySelector(".tabs__titles") ||
      groupEl.querySelector(".api-tabs") ||
      groupEl.querySelector('[data-test="tab-list"]') ||
      groupEl;

    // Tabs
    const candidateTabs = Array.from(
      titlesEl.querySelectorAll('[role="tab"], .tabs__title[data-tab-id], [data-tab-id]')
    ).filter(isTabButton);

    // Panels: any element in the group with a data-tab-id that is NOT one of the tab buttons
    const allWithId = Array.from(groupEl.querySelectorAll("[data-tab-id]"));
    const panels = allWithId.filter(el => !candidateTabs.includes(el));

    // Ensure every tab has a corresponding panel by id
    const panelsById = new Map();
    panels.forEach(p => {
      const id = p.getAttribute("data-tab-id");
      if (id) panelsById.set(id, p);
    });

    const tabs = candidateTabs
      .map(t => ({ el: t, id: getTabId(t) }))
      .filter(t => t.id);

    return { titlesEl, tabs, panelsById };
  }

  function activate(group, tabId, focusTab) {
    const { titlesEl, tabs, panelsById } = group;

    const active = tabs.find(t => t.id === tabId) || tabs[0];
    if (!active) return;

    // Roles
    if (!titlesEl.getAttribute("role")) titlesEl.setAttribute("role", "tablist");

    tabs.forEach((t) => {
      const isActive = t.id === active.id;
      t.el.setAttribute("role", "tab");
      t.el.setAttribute("aria-selected", String(isActive));
      t.el.setAttribute("tabindex", isActive ? "0" : "-1");
      setSelectedTokenInDataTest(t.el, isActive);

      // Link tab -> panel
      const panel = panelsById.get(t.id);
      if (panel) {
        if (!t.el.id) t.el.id = uniqId("tab");
        if (!panel.id) panel.id = uniqId("panel");
        t.el.setAttribute("aria-controls", panel.id);
        panel.setAttribute("aria-labelledby", t.el.id);
      }

      // Hide/show panel
      if (panel) {
        panel.hidden = !isActive;
        panel.setAttribute("role", "tabpanel");
      }
    });

    if (focusTab) active.el.focus({ preventScroll: true });
  }

  function initGroup(groupEl) {
    if (groupEl.dataset && groupEl.dataset.authordTabsBound === "true") return;
    if (groupEl.dataset) groupEl.dataset.authordTabsBound = "true";
    const { titlesEl, tabs, panelsById } = collectTabsAndPanels(groupEl);
    if (!tabs.length) return;

    const group = { groupEl, titlesEl, tabs, panelsById };

    // Initial active tab:
    // 1) data-test contains "selected"
    // 2) aria-selected="true"
    // 3) first tab
    let initial =
      (tabs.find(t => (t.el.getAttribute("data-test") || "").includes("selected")) || {}).id ||
      (tabs.find(t => t.el.getAttribute("aria-selected") === "true") || {}).id ||
      tabs[0].id;

    // Hash deep link: #tab-2 etc.
    if (location.hash) {
      const hash = location.hash.slice(1);
      if (tabs.some(t => t.id === hash)) initial = hash;
    }

    // Ensure only the initial panel is visible
    activate(group, initial, false);

    // Click
    tabs.forEach(t => {
      t.el.addEventListener("click", (e) => {
        e.preventDefault();
        activate(group, t.id, true);
      });
    });

    // Keyboard
    titlesEl.addEventListener("keydown", (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " "];
      if (!keys.includes(e.key)) return;

      const currentIndex = tabs.findIndex(t => t.el.getAttribute("aria-selected") === "true");
      if (currentIndex < 0) return;

      const move = (newIndex) => {
        const idx = (newIndex + tabs.length) % tabs.length;
        tabs[idx].el.focus({ preventScroll: true });
      };

      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          move(currentIndex - 1);
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          move(currentIndex + 1);
          break;
        case "Home":
          e.preventDefault();
          move(0);
          break;
        case "End":
          e.preventDefault();
          move(tabs.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          {
            const focused = document.activeElement;
            const t = tabs.find(x => x.el === focused);
            if (t) activate(group, t.id, true);
          }
          break;
      }
    });
  }

  function initAll() {
    setHtmlThemeClass(document.body?.getAttribute("data-vscode-theme-kind") || "");
    const groups = findTabGroups(document);
    groups.forEach(initGroup);
    collectLineElements();
  }

  function initAllAndMaybeSync(shouldSync) {
    initAll();
    if (shouldSync) {
      sendActiveLine();
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    applyThemeMessage(msg);
    if (!msg || typeof msg !== "object") return;
    if (msg.command === "syncScroll" && typeof msg.line === "number") {
      const adjustedLine = adjustLineWithHeading(msg.line, msg.heading);
      scrollToAnchor(Math.max(1, adjustedLine), msg.anchor, msg.ratio);
    }
    if (msg.command === "refreshLines") {
      initAllAndMaybeSync(Boolean(msg.sync));
    }
  });

  window.addEventListener(
    "scroll",
    () => {
      if (isSyncing) return;
      if (rafHandle) return;
      rafHandle = window.requestAnimationFrame(() => {
        rafHandle = 0;
        sendActiveLine();
      });
    },
    { passive: true }
  );

  window.addEventListener("wheel", cancelScrollAnimation, { passive: true });
  window.addEventListener("touchstart", cancelScrollAnimation, { passive: true });
  window.addEventListener("keydown", cancelScrollAnimation);

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-line]");
    if (!target) return;
    const line = Number(target.getAttribute("data-line"));
    if (!Number.isFinite(line)) return;
    setActiveLine(target);
    if (vscode) {
      const heading = findForwardHeading(line);
      const anchor = collapseWhitespace(target.textContent || "").slice(0, 120);
      const anchorValue = anchor.length >= 3 ? anchor : undefined;
      vscode.postMessage({
        command: "previewScrolled",
        line,
        heading: heading ? { title: heading.title, line: heading.line } : undefined,
        anchor: anchorValue,
      });
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initAllAndMaybeSync(false));
  } else {
    initAllAndMaybeSync(false);
  }
})();
