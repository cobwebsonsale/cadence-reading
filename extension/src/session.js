import { loadSettings, onSettingsChanged, clampSpeed } from './settings.js';
import { createOverlay, resolveTheme } from './overlay.js';
import { buildCallout, positionCallout, layoutCallouts } from './render/comments.js';
import { buildSteps, buildBlockSteps, trimTrailingPauses } from './reveal/walker.js';
import { createLoop } from './reveal/loop.js';
import { attachInput } from './reveal/input.js';
import { createNotesPanel } from './notes/panel.js';
import { notesKey } from './notes/storage.js';

let activeSession = null;

export async function startSessionWithSource(source, opts = {}) {
  if (activeSession) return;

  const settings = await loadSettings();
  const session = new Session(source, settings, opts);
  activeSession = session;
  try {
    await session.run();
  } catch (error) {
    console.error('[cadence] session error:', error);
    session.showFatal(error);
  }
}

class Session {
  constructor(source, settings, opts = {}) {
    this.source = source;
    this.settings = { ...settings };
    this.startIndex = opts.startIndex || 0;
    this.onPosition = opts.onPosition || null;
    this.onPrepared = opts.onPrepared || null;
    this.onSwitchTab = opts.onSwitchTab || null;
    this.overlay = null;
    this.loop = null;
    this.detachInput = null;
    this.unsubscribeSettings = null;
    this.comments = null;
    this.commentsHidden = !this.settings.commentsVisible;
    this.focusEnabled = this.settings.focusMode;
    this.bionicEnabled = this.settings.bionicMode;
    this.notes = null;
    this.pageState = capturePageState();
    this.ended = false;
    this.lazy = null;
    this.steps = null;
    this.blockCursor = 0;
    this.builtIndex = 0;
    this.lazyDone = false;
  }

  setupLazyBuild({ blocks, buildBlock }) {
    this.lazy = { blocks, buildBlock };
  }

  buildAhead(targetStepCount) {
    if (!this.lazy || this.lazyDone) return;
    const { blocks, buildBlock } = this.lazy;
    while (this.blockCursor < blocks.length && this.steps.length < targetStepCount) {
      const el = buildBlock(blocks[this.blockCursor], this.builtIndex);
      this.blockCursor++;
      if (!el) continue;
      this.overlay.content.appendChild(el);
      this.builtIndex++;
      for (const step of buildBlockSteps(el, { pauseAt: this.settings.pauseAt })) {
        this.steps.push(step);
      }
    }
    if (this.blockCursor >= blocks.length) {
      trimTrailingPauses(this.steps);
      this.lazyDone = true;
    }
  }

  async run() {
    this.overlay = createOverlay({ theme: this.settings.theme });
    this.applyReaderStyle();
    this.overlay.hud.setStatus('Loading…');
    this.overlay.hud.setSpeed(this.settings.charsPerSec);
    this.overlay.content.style.visibility = 'hidden';
    lockPage();
    focusOverlay(this.overlay.root);
    this.overlay.content.addEventListener('click', (e) => this.onDocLinkClick(e));

    this.comments = (await this.source.prepare(this)) || new Map();
    this.onPrepared?.(this.docTitle || '');
    if (this.comments.size) this.mountCallouts();
    this.applyComments();

    let steps;
    let onNeedMore;
    let totalParagraphs;
    if (this.lazy) {
      this.steps = [];
      steps = this.steps;
      onNeedMore = (target) => this.buildAhead(target);
      totalParagraphs = this.lazy.blocks.length;
      this.buildAhead(Math.max(3000, this.startIndex + 3000));
    } else {
      steps = buildSteps(this.overlay.content, { pauseAt: this.settings.pauseAt });
    }

    this.loop = createLoop({
      steps,
      settings: this.settings,
      hud: this.overlay.hud,
      root: this.overlay.root,
      startIndex: this.startIndex,
      onComment: (commentId) => this.revealComment(commentId),
      onEnd: () => this.overlay.hud.setStatus('End of document'),
      onRewind: (paraEl) => this.hideCommentsInParagraph(paraEl),
      onPosition: this.onPosition,
      onNeedMore,
      totalParagraphs,
    });

    this.notes = createNotesPanel({
      mount: this.overlay.root,
      contentEl: this.overlay.content,
      storageKey: notesKey(location.href),
      title: this.docTitle || '',
      onOpen: () => this.closeCommentsForNotes(),
    });

    this.detachInput = attachInput(this.loop, this);
    this.unsubscribeSettings = onSettingsChanged((patch) => this.applySettings(patch));

    this.loop.setFocus(this.focusEnabled);
    this.overlay.hud.setToggle('focus', this.focusEnabled);

    this.overlay.root.classList.toggle('dr-bionic', this.bionicEnabled);
    this.overlay.hud.setToggle('bionic', this.bionicEnabled);

    if (this.source.type === 'docs' && this.tabs?.length > 1) {
      this.overlay.hud.setTabs(this.tabs, this.tabId, (tabId) => this.switchTab(tabId));
    }

    this.overlay.hud.setStatus('');
    this.overlay.content.style.visibility = '';
    this.loop.start();

    // Flush the exact position on the way out; the periodic save can be up to 1s stale.
    this.flushPosition = () => {
      if (this.loop && this.onPosition) this.onPosition(this.loop.position(), false);
    };
    window.addEventListener('pagehide', this.flushPosition);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushPosition();
    });
  }

  mountCallouts() {
    for (const record of this.comments.values()) {
      const node = buildCallout(record);
      node.style.opacity = '0';
      const cohighlight = (on) =>
        this.commentAnchors(record.id).forEach((s) => s.classList.toggle('dr-comment-cohighlight', on));
      node.addEventListener('mouseenter', () => cohighlight(true));
      node.addEventListener('mouseleave', () => cohighlight(false));
      node.addEventListener('click', () => this.jumpToAnchors(record));
      this.overlay.gutter.appendChild(node);
      record.node = node;
    }
    this.overlay.content.addEventListener('click', (e) => this.onCommentClick(e));
    this.overlay.gutter.addEventListener('click', (e) => this.onDocLinkClick(e));
  }

  commentAnchors(id) {
    return [...this.overlay.content.querySelectorAll('[data-comment-id]')].filter((el) =>
      (el.getAttribute('data-comment-id') || '').split(',').includes(id)
    );
  }

  // Bring a comment beside its text, on top, dimming the rest; returns its anchor.
  focusComment(record) {
    const anchors = this.commentAnchors(record.id);
    const anchor = anchors.find((a) => a.hasAttribute('data-revealed')) || anchors[0];
    record.node.classList.add('dr-comment-revealed');
    record.node.style.opacity = '';
    for (const r of this.comments.values()) r.node?.classList.remove('dr-comment-active');
    record.node.classList.add('dr-comment-active');
    this.overlay.gutter.classList.add('dr-comments-focused');
    if (anchor) {
      const gutterRect = this.overlay.gutter.getBoundingClientRect();
      const aRect = anchor.getBoundingClientRect();
      record.node.style.top = `${Math.max(0, aRect.top - gutterRect.top + this.overlay.gutter.scrollTop)}px`;
    }
    flashEls([record.node], 'dr-comment-flash');
    return anchor;
  }

  clearCommentFocus() {
    this.overlay.gutter.classList.remove('dr-comments-focused');
    for (const r of this.comments?.values() || []) r.node?.classList.remove('dr-comment-active');
  }

  jumpToAnchors(record) {
    const anchor = this.focusComment(record);
    anchor?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    flashEls(this.commentAnchors(record.id), 'dr-comment-anchor-flash');
  }

  onDocLinkClick(e) {
    const link = e.target.closest?.('a[href]');
    if (link && !(e.metaKey || e.ctrlKey)) e.preventDefault();
  }

  onCommentClick(e) {
    if (this.commentsHidden) return;
    const span = e.target.closest?.('.dr-commented');
    if (!span) {
      this.clearCommentFocus();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.target.closest?.('a[href]')) return; // Cmd/Ctrl+click follows the link
    if (!window.getSelection?.().isCollapsed) return;
    const id = (span.getAttribute('data-comment-id') || '').split(',')[0];
    const record = this.comments?.get(id);
    if (record?.node) this.focusComment(record);
  }

  revealComment(commentId) {
    const record = this.comments?.get(commentId);
    if (!record || !record.node) return;
    positionCallout(record, this.overlay);
    record.node.style.opacity = '';
    record.node.classList.add('dr-comment-revealed');
  }

  hideCommentsInParagraph(paraEl) {
    if (!this.comments) return;
    const anchors = [...paraEl.querySelectorAll('[data-comment-end]')];
    for (const record of this.comments.values()) {
      if (!record.node) continue;
      const inParagraph = anchors.some((anchor) =>
        (anchor.getAttribute('data-comment-end') || '').split(',').includes(record.id)
      );
      if (inParagraph) {
        record.node.style.opacity = '0';
        record.node.classList.remove('dr-comment-revealed');
      }
    }
  }

  applyReaderStyle() {
    if (!this.overlay) return;
    const { root, content } = this.overlay;
    const { lineHeight, contentWidth, paperBg, paperFg, fontFamily } = this.settings;
    root.style.setProperty('--dr-reader-leading', lineHeight);
    root.style.setProperty('--dr-content-width', `${contentWidth}px`);
    const dark = resolveTheme(this.settings.theme) === 'dark';
    root.style.setProperty('--dr-paper-bg', dark ? this.settings.paperBgDark : paperBg);
    root.style.setProperty('--dr-paper-fg', dark ? this.settings.paperFgDark : paperFg);
    content.style.fontFamily = fontFamily || '';
  }

  applySettings(patch) {
    Object.assign(this.settings, patch);
    if ('charsPerSec' in patch && this.loop) {
      this.loop.setSpeed(clampSpeed(patch.charsPerSec));
    }
    if ('theme' in patch && this.overlay) {
      this.overlay.root.setAttribute('data-theme', resolveTheme(patch.theme));
    }
    const styleKeys = ['lineHeight', 'contentWidth', 'paperBg', 'paperFg', 'fontFamily', 'theme'];
    if (styleKeys.some((k) => k in patch)) this.applyReaderStyle();
  }

  toggleComments() {
    this.commentsHidden = !this.commentsHidden;
    if (!this.commentsHidden) this.notes?.close?.(); // comments and notes are mutually exclusive
    this.applyComments();
  }

  applyComments() {
    const show = !this.commentsHidden && !!this.comments?.size;
    this.overlay.setGutterHidden(!show);
    this.overlay.setCommentsHidden(!show);
    this.overlay.hud.setToggle('comments', show);
    if (!show) return;
    for (const [id, record] of this.comments) {
      if (record.node && this.commentAnchors(id).some((a) => a.hasAttribute('data-revealed'))) {
        record.node.classList.add('dr-comment-revealed');
        record.node.style.opacity = '';
      }
    }
    layoutCallouts(this.comments, this.overlay);
  }

  toggleFocus() {
    this.focusEnabled = !this.focusEnabled;
    this.loop?.setFocus(this.focusEnabled);
    this.overlay.hud.setToggle('focus', this.focusEnabled);
  }

  toggleBionic() {
    this.bionicEnabled = !this.bionicEnabled;
    this.overlay.root.classList.toggle('dr-bionic', this.bionicEnabled);
    this.overlay.hud.setToggle('bionic', this.bionicEnabled);
  }

  toggleNotes() {
    this.notes?.toggle();
  }

  // The reader reopens the doc at the new tab (fresh fetch + build), keeping per-tab
  // position/notes; flush the current tab's position first so it resumes correctly.
  switchTab(tabId) {
    if (!tabId || tabId === this.tabId || !this.onSwitchTab) return;
    this.flushPosition?.();
    this.onSwitchTab(tabId);
  }

  // Opening notes (by key or by clicking the panel) closes comments — mutually exclusive.
  closeCommentsForNotes() {
    if (this.commentsHidden) return;
    this.commentsHidden = true;
    this.applyComments();
  }

  showFatal(error) {
    if (!this.overlay) return;
    this.overlay.hud.setStatus(`Error: ${error?.message || error}`);
    if (!this.detachInput) {
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          window.removeEventListener('keydown', onKey, true);
          this.end();
        }
      };
      window.addEventListener('keydown', onKey, true);
    }
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.detachInput?.();
    this.unsubscribeSettings?.();
    this.notes?.destroy();
    this.loop?.destroy();
    this.overlay?.destroy();
    restorePage(this.pageState);
    if (activeSession === this) activeSession = null;
  }
}

function flashEls(els, cls) {
  for (const el of els) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation even if it's still running
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }
}

function capturePageState() {
  return {
    overflow: document.body.style.overflow,
    activeElement: document.activeElement,
  };
}

function lockPage() {
  document.body.style.overflow = 'hidden';
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
}

function restorePage(state) {
  document.body.style.overflow = state.overflow || '';
}

function focusOverlay(root) {
  root.focus({ preventScroll: true });
}
