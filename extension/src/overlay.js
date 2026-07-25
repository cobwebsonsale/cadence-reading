import { el } from './dom.js';

const OVERLAY_CLASS = 'dr-overlay';
const HUD_KEYS = [
  ['Space', 'Continue · hold to fast-forward'],
  ['←', 'Replay paragraph'],
  ['↑ ↓', 'Previous / next paragraph'],
  ['[ ]', 'Slower / faster'],
  ['F', 'Focus mode'],
  ['B', 'Bionic reading'],
  ['C', 'Comments'],
  ['N', 'Notes'],
  ['Esc', 'Exit'],
]
  .map(([k, d]) => `<div class="dr-hud-keys-row"><kbd>${k}</kbd><span>${d}</span></div>`)
  .join('');

export function createOverlay({ theme }) {
  injectStylesheet();

  const root = document.createElement('div');
  root.className = OVERLAY_CLASS;
  root.setAttribute('data-theme', resolveTheme(theme));
  root.tabIndex = -1;

  const stage = el('div', 'dr-stage');
  const content = el('div', 'dr-content');
  const gutter = el('div', 'dr-gutter');
  stage.append(content, gutter);

  const hudEl = el('div', 'dr-hud');

  const hudStatus = el('span', 'dr-hud-status');
  const hudSpeed = el('span', 'dr-hud-speed');

  const flags = el('div', 'dr-hud-flags');
  const flagEls = {};
  for (const [key, label] of [['comments', 'Comments'], ['focus', 'Focus'], ['bionic', 'Bionic']]) {
    const chip = el('span', 'dr-hud-flag');
    chip.textContent = label;
    flags.appendChild(chip);
    flagEls[key] = chip;
  }

  const help = el('div', 'dr-hud-help');
  const helpBtn = el('button', 'dr-hud-help-btn');
  helpBtn.type = 'button';
  helpBtn.textContent = '?';
  helpBtn.setAttribute('aria-label', 'Keyboard shortcuts');
  const keys = el('div', 'dr-hud-keys');
  keys.innerHTML = HUD_KEYS;
  help.append(helpBtn, keys);

  const tabPicker = el('div', 'dr-hud-tabs');
  tabPicker.style.display = 'none';
  const tabBtn = el('button', 'dr-hud-tabs-btn');
  tabBtn.type = 'button';
  const tabMenu = el('div', 'dr-hud-tabs-menu');
  tabPicker.append(tabBtn, tabMenu);

  const onTabDocClick = (e) => {
    if (!tabPicker.contains(e.target)) closeTabMenu();
  };
  const closeTabMenu = () => {
    tabPicker.classList.remove('dr-open');
    document.removeEventListener('click', onTabDocClick);
  };
  tabBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tabPicker.classList.toggle('dr-open')) {
      document.addEventListener('click', onTabDocClick);
    } else {
      document.removeEventListener('click', onTabDocClick);
    }
  });

  hudEl.append(tabPicker, hudStatus, hudSpeed, flags, help);

  root.append(stage, hudEl);
  document.documentElement.appendChild(root);

  const hud = {
    el: hudEl,
    setSpeed(charsPerSec) {
      hudSpeed.textContent = `${charsPerSec} c/s`;
    },
    setStatus(text) {
      hudStatus.textContent = text || '';
    },
    setToggle(name, on) {
      flagEls[name]?.classList.toggle('dr-hud-flag-on', on);
    },
    setHidden(hidden) {
      hudEl.classList.toggle('dr-hud-hidden', hidden);
    },
    setTabs(tabs, currentTabId, onSelect) {
      if (!tabs || tabs.length <= 1) {
        tabPicker.style.display = 'none';
        return;
      }
      const current = tabs.find((t) => t.tabId === currentTabId) || tabs[0];
      tabBtn.textContent = current.title || 'Tab';
      tabMenu.replaceChildren();
      for (const tab of tabs) {
        const item = el('button', 'dr-hud-tab-item');
        item.type = 'button';
        item.textContent = tab.title || 'Untitled tab';
        item.style.paddingLeft = `${12 + tab.level * 14}px`;
        item.classList.toggle('dr-hud-tab-current', tab.tabId === current.tabId);
        item.addEventListener('click', () => {
          closeTabMenu();
          onSelect(tab.tabId);
        });
        tabMenu.appendChild(item);
      }
      tabPicker.style.display = '';
    },
  };

  return {
    root,
    content,
    gutter,
    hud,
    setCommentsHidden(hidden) {
      root.classList.toggle('dr-comments-hidden', hidden);
    },
    setGutterHidden(hidden) {
      gutter.style.display = hidden ? 'none' : '';
    },
    destroy() {
      root.remove();
    },
  };
}

export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  const prefersDark =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function injectStylesheet() {
  const id = 'dr-overlay-stylesheet';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles/overlay.css');
  document.documentElement.appendChild(link);
}
