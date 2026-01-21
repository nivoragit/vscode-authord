(() => {
  const vscode = acquireVsCodeApi();
  let lineElements = [];
  let activeLineEl = null;
  let isSyncing = false;
  let rafHandle = 0;

  const collectLineElements = () => {
    lineElements = Array.from(document.querySelectorAll('[data-line]'))
      .map((el) => {
        const raw = el.getAttribute('data-line');
        const line = raw ? Number(raw) : NaN;
        return Number.isFinite(line) ? { el, line } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.line - b.line);
  };

  const setActiveLine = (el) => {
    if (activeLineEl === el) return;
    if (activeLineEl) activeLineEl.classList.remove('code-line--active');
    activeLineEl = el;
    if (activeLineEl) activeLineEl.classList.add('code-line--active');
  };

  const scrollToLine = (line) => {
    if (!lineElements.length) collectLineElements();
    if (!lineElements.length) return;

    let target = null;
    for (const item of lineElements) {
      if (item.line >= line) {
        target = item;
        break;
      }
    }
    if (!target) target = lineElements[lineElements.length - 1];

    isSyncing = true;
    target.el.scrollIntoView({ block: 'center', behavior: 'auto' });
    setActiveLine(target.el);
    window.setTimeout(() => {
      isSyncing = false;
    }, 50);
  };

  const sendActiveLine = () => {
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
    vscode.postMessage({ command: 'previewScrolled', line: current.line });
  };

  const onScroll = () => {
    if (isSyncing) return;
    if (rafHandle) return;
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = 0;
      sendActiveLine();
    });
  };

  const onClick = (event) => {
    const target = event.target.closest('[data-line]');
    if (!target) return;
    const line = Number(target.getAttribute('data-line'));
    if (!Number.isFinite(line)) return;
    setActiveLine(target);
    vscode.postMessage({ command: 'previewScrolled', line });
  };

  const initTabs = () => {
    const tabGroups = Array.from(document.querySelectorAll('.tabs'));
    tabGroups.forEach((tabsEl) => {
      if (tabsEl.dataset.tabsBound === 'true') return;
      tabsEl.dataset.tabsBound = 'true';

      const titles = Array.from(tabsEl.querySelectorAll('.tabs__title'));
      const contents = Array.from(tabsEl.querySelectorAll('.tabs__content'));
      if (!titles.length || !contents.length) return;

      const activate = (tabId) => {
        titles.forEach((title) => {
          title.classList.toggle('is-active', title.dataset.tabId === tabId);
        });
        contents.forEach((content) => {
          content.classList.toggle('is-active', content.dataset.tabId === tabId);
        });
      };

      titles.forEach((title) => {
        title.addEventListener('click', () => activate(title.dataset.tabId));
      });

      const firstId = titles[0].dataset.tabId;
      if (firstId) activate(firstId);
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onClick);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.command === 'syncScroll' && typeof msg.line === 'number') {
      scrollToLine(msg.line);
    }
    if (msg.command === 'setTheme') {
      const body = document.body;
      const themeClasses = ['vscode-light', 'vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light'];
      themeClasses.forEach((klass) => body.classList.remove(klass));
      if (typeof msg.className === 'string') {
        body.classList.add(msg.className);
      }
      if (typeof msg.extraClass === 'string') {
        body.classList.add(msg.extraClass);
      }
      if (typeof msg.kind === 'string') {
        body.setAttribute('data-vscode-theme-kind', msg.kind);
      }
    }
    if (msg.command === 'refreshLines') {
      collectLineElements();
      initTabs();
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    collectLineElements();
    initTabs();
    sendActiveLine();
  });
})();
