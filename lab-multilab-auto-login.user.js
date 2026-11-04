// ==UserScript==
// @name         Multilab — logowanie, sesja i „Data od”
// @namespace    local.lab-multilab-auto-login
// @version      1.1.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-multilab-auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-multilab-auto-login.user.js
// @description  Multilab (10.1.1.140 i gniew.lab-online.pl): auto logowanie PESEL + PIN zapamiętanymi w menedżerze skryptów, podtrzymanie sesji w tle, „Data od” 60 dni wstecz na stronie Home
// @match        https://10.1.1.140/*
// @match        http://10.1.1.140/*
// @match        https://gniew.lab-online.pl/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

// Trzy niezależne części, każda uruchamiana tylko na swojej stronie:
//   autoLogin — /page,login
//   keepAlive — każda inna strona (tylko główne okno, nie ramki)
//   dataOd    — /page,Home  (dawniej osobny skrypt lab-data-od)
// Wyjątek w jednej części nie zatrzymuje pozostałych.

(function () {
  'use strict';

  const PATH = location.pathname;
  const IS_LOGIN_PAGE = PATH.startsWith('/page,login');
  const IS_HOME_PAGE = PATH.startsWith('/page,Home');
  const IS_TOP_WINDOW = window.top === window;

  // ───────────── wspólne ─────────────

  const DEBUG_LOG = [];
  function dbg(part, msg) {
    const now = new Date();
    const line = now.toLocaleTimeString('pl-PL', { hour12: false }) + '.' +
      String(now.getMilliseconds()).padStart(3, '0') + ' [' + part + '] ' + msg;
    DEBUG_LOG.push(line);
    if (DEBUG_LOG.length > 300) DEBUG_LOG.shift();
    console.info('[multilab] ' + line);
  }

  function runPart(part, fn) {
    try {
      fn();
    } catch (e) {
      dbg(part, 'błąd: ' + ((e && e.message) || e));
      console.error('[multilab]', part, e);
    }
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ───────────── autoLogin ─────────────

  const STORE_KEY_PESEL = 'multilab_tczew_pesel';
  const STORE_KEY_PIN = 'multilab_tczew_pin';
  const SUBMIT_GRACE_MS = 200;

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('Ustaw dane logowania (tczew)', () => {
      const pesel = window.prompt('PESEL (tczew):', GM_getValue(STORE_KEY_PESEL, ''));
      if (pesel === null) return;
      const pin = window.prompt('Numer PIN (tczew):', '');
      if (pin === null) return;
      GM_setValue(STORE_KEY_PESEL, pesel.trim());
      GM_setValue(STORE_KEY_PIN, pin.trim());
      alert('Zapisano dane logowania dla „tczew”.');
    });

    GM_registerMenuCommand('Wyczyść dane logowania (tczew)', () => {
      GM_deleteValue(STORE_KEY_PESEL);
      GM_deleteValue(STORE_KEY_PIN);
      alert('Wyczyszczono zapamiętane dane logowania.');
    });

    GM_registerMenuCommand('Pokaż log debug (Multilab)', () => {
      alert(DEBUG_LOG.join('\n') || '(pusty log)');
    });
  }

  function autoLogin() {
    const findUsernameField = () => document.getElementById('ctl0_Main_username');
    const findPasswordField = () => document.getElementById('ctl0_Main_password');
    const findSubmitButton = () => document.getElementById('ctl0_Main_ctl4');
    const findErrorMessage = () => document.getElementById('ctl0_Main_ctl5');

    const isLoginForm = () => isVisible(findUsernameField()) && isVisible(findPasswordField());

    function hasVisibleError() {
      const err = findErrorMessage();
      return isVisible(err) && (err.textContent || '').trim().length > 0;
    }

    let attempted = false;

    function tryLogin() {
      if (attempted) return;
      if (!isLoginForm()) return;

      if (hasVisibleError()) {
        dbg('login', 'widoczny komunikat błędu logowania — rezygnuję z auto-loginu na tej stronie');
        attempted = true;
        return;
      }

      const pesel = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY_PESEL, '') : '';
      const pin = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY_PIN, '') : '';
      if (!pesel || !pin) {
        dbg('login', 'brak zapisanych danych logowania (użyj menu menedżera skryptów „Ustaw dane logowania”)');
        attempted = true;
        return;
      }

      const userField = findUsernameField();
      const passField = findPasswordField();
      if (!userField || !passField) return;

      if (userField.value.trim() || passField.value.trim()) return; // pola już zajęte (ręczny wpis) — nie ruszamy

      attempted = true;
      dbg('login', 'wypełniam PESEL + PIN i wysyłam formularz za ' + SUBMIT_GRACE_MS + 'ms');
      setNativeValue(userField, pesel);
      setNativeValue(passField, pin);

      setTimeout(() => {
        const btn = findSubmitButton();
        if (btn) {
          dbg('login', 'klik Login');
          btn.click();
        }
      }, SUBMIT_GRACE_MS);
    }

    tryLogin();
    const observer = new MutationObserver(() => tryLogin());
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15_000);
  }

  // ───────────── keepAlive ─────────────
  // Serwer (PHP) kończy sesję po okresie bezczynności, domyślnie 24 min. Każde
  // zapytanie z ciasteczkiem sesji liczy ten czas od nowa, więc w tle co kilka
  // minut pobieramy /page,Home — bez przeładowania strony i utraty wyszukiwania.
  // Gdy sesja mimo to wygaśnie (uśpiony komputer, brak sieci), serwer odpowiada
  // przekierowaniem na /page,login — wtedy przeładowujemy stronę i autoLogin
  // loguje ponownie.

  const KEEPALIVE = {
    pingEveryMs: 4 * 60_000,
    retryAfterErrorMs: 60_000,
    pingTimeoutMs: 30_000,
    pingPath: '/page,Home',
    // Nie przeładowuj częściej niż raz na tyle — ochrona przed pętlą przeładowań,
    // gdyby serwer kończył sesję szybciej niż co pingEveryMs.
    minReloadGapMs: 10 * 60_000,
    reloadKey: 'multilab_keepalive_last_reload',
  };

  function keepAlive() {
    let lastPingAt = Date.now(); // samo załadowanie strony odświeżyło sesję
    let timer = null;
    let inFlight = false;
    let reloading = false;

    function schedule(delayMs) {
      clearTimeout(timer);
      if (reloading) return;
      timer = setTimeout(() => ping('co ' + Math.round(KEEPALIVE.pingEveryMs / 60_000) + ' min'), delayMs);
    }

    function readLastReload() {
      try {
        return Number(sessionStorage.getItem(KEEPALIVE.reloadKey)) || 0;
      } catch {
        return 0;
      }
    }

    function isLoginUrl(url) {
      try {
        return new URL(url, location.href).pathname.startsWith('/page,login');
      } catch {
        return false;
      }
    }

    function reloadForRelogin() {
      const sinceLast = Date.now() - readLastReload();
      if (sinceLast < KEEPALIVE.minReloadGapMs) {
        dbg('sesja', 'wygasła, ale przeładowanie było ' + Math.round(sinceLast / 1000) +
          ' s temu — nie przeładowuję ponownie (ochrona przed pętlą)');
        return false;
      }
      try {
        sessionStorage.setItem(KEEPALIVE.reloadKey, String(Date.now()));
      } catch { /* bez sessionStorage — przeładowujemy i tak */ }
      reloading = true;
      clearTimeout(timer);
      dbg('sesja', 'wygasła — przeładowuję, autologowanie zaloguje ponownie');
      // Zwykłe GET bieżącego adresu: location.reload() po wyszukiwaniu (POST)
      // pytałoby o ponowne wysłanie formularza.
      location.assign(location.pathname + location.search);
      return true;
    }

    async function ping(reason) {
      if (inFlight || reloading) return;
      inFlight = true;
      let nextDelay = KEEPALIVE.pingEveryMs;
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), KEEPALIVE.pingTimeoutMs);
      try {
        const res = await fetch(location.origin + KEEPALIVE.pingPath, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        await res.text();
        lastPingAt = Date.now();
        if (isLoginUrl(res.url)) {
          if (reloadForRelogin()) return;
        } else {
          dbg('sesja', 'podtrzymana (' + reason + '), HTTP ' + res.status);
        }
      } catch (e) {
        nextDelay = KEEPALIVE.retryAfterErrorMs;
        dbg('sesja', 'zapytanie nieudane (' + reason + '): ' +
          (e && e.name === 'AbortError' ? 'przekroczony czas' : (e && e.message) || e) +
          ' — ponowię za ' + Math.round(nextDelay / 1000) + ' s');
      } finally {
        clearTimeout(abortTimer);
        inFlight = false;
      }
      schedule(nextDelay);
    }

    function pingIfOverdue(reason) {
      if (Date.now() - lastPingAt >= KEEPALIVE.pingEveryMs) ping(reason);
    }

    // Po uśpieniu komputera albo przerwie w sieci nie czekamy na kolejny cykl.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pingIfOverdue('powrót do karty');
    });
    window.addEventListener('online', () => pingIfOverdue('powrót sieci'));

    schedule(KEEPALIVE.pingEveryMs);
    dbg('sesja', 'podtrzymanie włączone — zapytanie w tle co ' +
      Math.round(KEEPALIVE.pingEveryMs / 60_000) + ' min');
  }

  // ───────────── dataOd ─────────────
  // Po załadowaniu strony Home ustawia „Data od” na 60 dni przed dzisiejszą datą.

  const DATA_OD = {
    daysBack: 60,
    fieldLabel: 'Data od',
    searchPanelHeading: 'Szukaj',
    maxWaitMs: 120_000,
    retryIntervalMs: 500,
    dataOdSelectors: [
      '#ctl0_Main_edDt1_DateTextBox',
      'input[name="ctl0$Main$edDt1_DateTextBox"]',
      'input[name*="edDt1" i][type="date"]',
    ],
  };

  function dataOd() {
    function formatDateDaysAgo(days) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - days);

      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();

      return {
        iso: `${year}-${month}-${day}`,
        polish: `${day}.${month}.${year}`,
      };
    }

    function ownText(node) {
      return normalizeText(
        [...node.childNodes]
          .filter(
            (n) =>
              n.nodeType === Node.TEXT_NODE ||
              (n.nodeType === Node.ELEMENT_NODE && n.childElementCount === 0)
          )
          .map((n) => n.textContent)
          .join('')
      );
    }

    function findSectionRoot(headingText) {
      const target = headingText.trim().toLowerCase();
      const nodes = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, td, th, legend, label')];

      for (const node of nodes) {
        const own = ownText(node).toLowerCase();
        const full = normalizeText(node.textContent).toLowerCase();
        if (own === target || full === target) {
          return node.closest('section, article, fieldset, .panel, .card, div') || node.parentElement;
        }
      }

      return null;
    }

    function matchesFieldLabel(node, label) {
      const target = label.trim().toLowerCase().replace(/:$/, '');
      const own = ownText(node).toLowerCase().replace(/:$/, '');
      const full = normalizeText(node.textContent).toLowerCase().replace(/:$/, '');
      return own === target || (full === target && normalizeText(node.textContent).length <= 30);
    }

    function isDataOdField(input) {
      if (!input || input.tagName !== 'INPUT') return false;

      const name = normalizeText(input.name || input.id).toLowerCase();
      if (name.includes('eddt1')) return true;
      if (name.includes('eddt2')) return false;

      const meta = normalizeText(
        [input.name, input.id, input.placeholder, input.getAttribute('aria-label')].filter(Boolean).join(' ')
      ).toLowerCase();

      if (/\bdata\s*do\b/.test(meta) && !/\bdata\s*od\b/.test(meta)) return false;

      const row = input.closest('tr, .form-group, .field, label, div');
      const rowText = normalizeText(row?.textContent || '').toLowerCase();
      if (rowText.includes('data do') && !rowText.includes('data od')) return false;

      return true;
    }

    function findInputNearLabel(labelNode) {
      if (labelNode.htmlFor) {
        const linked = document.getElementById(labelNode.htmlFor);
        if (linked && isDataOdField(linked)) return linked;
      }

      const row = labelNode.closest('tr');
      if (row) {
        const cells = [...row.querySelectorAll('td, th')];
        const labelIdx = cells.findIndex((cell) => cell === labelNode || cell.contains(labelNode));
        if (labelIdx >= 0) {
          for (let i = labelIdx + 1; i < cells.length; i++) {
            const input = cells[i].querySelector('input[type="date"], input');
            if (input && isDataOdField(input)) return input;
          }
        }
      }

      let sibling = labelNode.nextElementSibling;
      for (let step = 0; step < 4 && sibling; step++) {
        if (sibling.matches?.('input') && isDataOdField(sibling)) return sibling;
        const nested = sibling.querySelector?.('input[type="date"], input');
        if (nested && isDataOdField(nested)) return nested;
        sibling = sibling.nextElementSibling;
      }

      return null;
    }

    function findDataOdField() {
      for (const selector of DATA_OD.dataOdSelectors) {
        try {
          const input = document.querySelector(selector);
          if (input) return input;
        } catch {
          // nieprawidłowy selektor
        }
      }

      const panel = findSectionRoot(DATA_OD.searchPanelHeading) || document;
      const nodes = [...panel.querySelectorAll('label, span, td, th, legend, p, div')];

      for (const node of nodes) {
        if (!matchesFieldLabel(node, DATA_OD.fieldLabel)) continue;
        const input = findInputNearLabel(node);
        if (input) return input;
      }

      return null;
    }

    function applyDataOd(field) {
      const target = formatDateDaysAgo(DATA_OD.daysBack);

      if (normalizeText(field.value) === target.iso) {
        dbg('data od', 'już ustawiona: ' + target.polish);
        return;
      }

      setNativeValue(field, target.iso);

      if (field.value === target.iso) {
        dbg('data od', 'ustawiono ' + target.polish + ' (' + target.iso + ')');
      } else {
        dbg('data od', 'nie udało się ustawić daty, pole: ' + field.value);
      }
    }

    // Odpytywanie i obserwator kończą się razem — data ustawiana jest dokładnie raz.
    const start = Date.now();
    let done = false;
    let timer = null;
    let observer = null;

    const finish = () => {
      done = true;
      clearTimeout(timer);
      observer?.disconnect();
    };

    const attempt = () => {
      if (done) return;
      const field = findDataOdField();
      if (field) {
        finish();
        applyDataOd(field);
        return;
      }
      if (Date.now() - start >= DATA_OD.maxWaitMs) {
        finish();
        dbg('data od', 'nie znaleziono pola „Data od”');
        return;
      }
      timer = setTimeout(attempt, DATA_OD.retryIntervalMs);
    };

    attempt();
    if (done) return;

    observer = new MutationObserver(() => {
      if (done) return;
      const field = findDataOdField();
      if (field) {
        finish();
        applyDataOd(field);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ───────────── start ─────────────

  function boot() {
    if (IS_TOP_WINDOW) runPart('menu', registerMenu);
    if (IS_LOGIN_PAGE) {
      runPart('login', autoLogin);
      return;
    }
    if (IS_TOP_WINDOW) runPart('sesja', keepAlive);
    if (IS_HOME_PAGE) runPart('data od', dataOd);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
