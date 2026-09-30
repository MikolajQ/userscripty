// ==UserScript==
// @name         MEGA - zamknij okno pełnej pamięci
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/mega-zamknij-pamiec.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/mega-zamknij-pamiec.user.js
// @description  Automatycznie zamyka natrętne okna MEGA: "pamięć prawie pełna" (quota) i reklamę "Zyskaj więcej dzięki planowi Pro" (upgrade-to-pro)
// @match        https://mega.nz/*
// @match        https://mega.co.nz/*
// @match        https://mega.io/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Dopasowanie tekstowe — MEGA co jakiś czas zmienia treść komunikatu
  // (dawniej stały tekst „...jest prawie pełna”, teraz z dynamicznym
  // procentem „Twoja pojemność jest w 93% pełna”), dlatego wzorce z %.
  const MARKER_PATTERNS = [
    /pamięć w chmurze mega jest prawie pełna/i,
    /cloud storage is almost full/i,
    /pojemnoś[ćc] jest w \d+\s*%\s*pełna/i,
    /storage is \d+\s*%\s*full/i,
  ];

  const closed = new WeakSet();
  let megaHooked = false;
  let scheduled = false;

  function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function matchesMarker(text) {
    const t = normalize(text);
    return MARKER_PATTERNS.some((re) => re.test(t));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function pageMayHavePopup() {
    const t = document.body?.textContent;
    if (!t) return false;
    const lower = t.toLowerCase();
    return MARKER_PATTERNS.some((re) => re.test(lower));
  }

  // Wykrywanie po strukturze (odporne na kolejne zmiany treści):
  // - „pojemność prawie pełna” → div[role="dialog"] z klasą zawierającą „quota”,
  // - reklama „Zyskaj więcej dzięki planowi Pro” → klasa „upgrade-to-pro”.
  const NAG_DIALOG_CLASS_RE = /quota|upgrade-to-pro/i;

  function findNagDialog() {
    return (
      [...document.querySelectorAll('div[role="dialog"]')].find(
        (el) => isVisible(el) && NAG_DIALOG_CLASS_RE.test(el.className)
      ) || null
    );
  }

  function resolvedPromise() {
    if (typeof MegaPromise !== 'undefined') {
      const p = new MegaPromise();
      p.resolve();
      return p;
    }
    return Promise.resolve();
  }

  function hookMegaApi() {
    if (megaHooked) return;
    if (typeof window.MegaUtils === 'undefined' && typeof window.FileManager === 'undefined') {
      return;
    }
    megaHooked = true;

    try {
      if (typeof FileManager !== 'undefined' && FileManager.prototype) {
        FileManager.prototype.showOverStorageQuota = function () {
          return resolvedPromise();
        };
      }
    } catch (_) {}

    try {
      if (typeof M !== 'undefined' && typeof M.showOverStorageQuota === 'function') {
        M.showOverStorageQuota = function () {
          return resolvedPromise();
        };
      }
    } catch (_) {}
  }

  function findCloseButton(root) {
    const selectors = [
      '.fm-dialog-close',
      '.close-dialog',
      '.icon-close',
      '[class*="dialog-close"]',
      '[class*="close-dialog"]',
      'button.close',
      '.close',
    ];

    for (const sel of selectors) {
      const btn = root.querySelector(sel);
      if (btn && isVisible(btn)) return btn;
    }

    for (const btn of root.querySelectorAll('button, i, span, div, a')) {
      if (!isVisible(btn)) continue;
      const cls = String(btn.className || '');
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      if (/close|zamknij/i.test(cls) || label === 'close' || title === 'close') {
        return btn;
      }
      const text = btn.textContent.trim();
      if (text === '×' || text === '✕' || text === 'X') return btn;
    }

    // Dialog „upgrade-to-pro” nie ma krzyżyka — zamyka go przycisk odmowy
    // typu „Może później” / „Maybe later”. Uwaga: dopasowujemy PEŁNY tekst
    // przycisku (nie substring), żeby nie kliknąć np. „Wybierz PRO”.
    const DISMISS_TEXTS = ['może później', 'maybe later', 'nie teraz', 'not now', 'dismiss', 'zamknij'];
    for (const btn of root.querySelectorAll('button')) {
      if (!isVisible(btn)) continue;
      const text = normalize(btn.textContent);
      if (DISMISS_TEXTS.includes(text)) return btn;
    }

    return null;
  }

  function findModalFromTitle(titleEl) {
    let el = titleEl;
    for (let i = 0; i < 25 && el; i++) {
      const close = findCloseButton(el);
      const rect = el.getBoundingClientRect();
      if (close && rect.width >= 200 && rect.height >= 120) {
        return { root: el, close };
      }
      el = el.parentElement;
    }
    return null;
  }

  function pressEscape(target) {
    const opts = {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    };
    const el = target || document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    document.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function closeModal(modal) {
    if (!modal || closed.has(modal.root)) return;
    closed.add(modal.root);

    if (modal.close) {
      modal.close.click();
      return;
    }

    pressEscape(modal.root);
  }

  function scanForPopup() {
    const dialog = findNagDialog();
    if (dialog) {
      const close = findCloseButton(dialog);
      if (close) {
        closeModal({ root: dialog, close });
        return true;
      }
    }

    if (!pageMayHavePopup()) return false;

    const nodes = document.querySelectorAll('h1, h2, h3, p, span, div');
    for (const node of nodes) {
      if (!matchesMarker(node.textContent)) continue;
      if (normalize(node.textContent).length > 1200) continue;

      const modal = findModalFromTitle(node);
      if (modal) {
        closeModal(modal);
        return true;
      }
    }
    return false;
  }

  function tick() {
    hookMegaApi();
    scanForPopup();
  }

  function scheduleTick() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      tick();
    });
  }

  const observer = new MutationObserver(scheduleTick);

  function start() {
    tick();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();