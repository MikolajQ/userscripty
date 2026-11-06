// ==UserScript==
// @name         Multilab — logowanie, sesja i „Data od”
// @namespace    local.lab-multilab-auto-login
// @version      1.2.0
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
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// Trzy niezależne części, każda uruchamiana tylko na swojej stronie:
//   autoLogin — /page,login
//   keepAlive — każda inna strona (tylko główne okno, nie ramki)
//   dataOd    — /page,Home  (dawniej osobny skrypt lab-data-od)
// Wyjątek w jednej części nie zatrzymuje pozostałych.
//
// Diagnostyka (od 1.2.0): każdy wpis dbg() trafia też do localStorage strony
// (klucz multilab_diag_v1, ostatnie 800 wpisów), więc przeżywa przeładowanie
// i wylogowanie. Dochodzą wpisy o wejściu na stronę (typ nawigacji, skąd),
// o zapytaniach XHR strony (status, czy odpowiedź to strona logowania),
// o powrocie do karty i o tym, ile minęło od ostatniego udanego podtrzymania,
// gdy pojawia się strona logowania. Niczego nie zmienia w działaniu strony.

(function () {
  'use strict';

  const PATH = location.pathname;
  const IS_LOGIN_PAGE = PATH.startsWith('/page,login');
  const IS_HOME_PAGE = PATH.startsWith('/page,Home');
  const IS_TOP_WINDOW = window.top === window;

  // ───────────── wspólne ─────────────

  const DEBUG_LOG = [];
  const DIAG = {
    key: 'multilab_diag_v1',
    max: 800,
    lastOkPingKey: 'multilab_diag_last_ok_ping',
    lastLeaveKey: 'multilab_diag_last_leave',
  };
  const FRAME_TAG = IS_TOP_WINDOW ? '' : ' (ramka)';

  function diagRead() {
    try {
      const arr = JSON.parse(localStorage.getItem(DIAG.key) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function diagPush(line) {
    try {
      const arr = diagRead();
      arr.push(line);
      if (arr.length > DIAG.max) arr.splice(0, arr.length - DIAG.max);
      localStorage.setItem(DIAG.key, JSON.stringify(arr));
    } catch { /* bez localStorage — zostaje log w pamięci i w konsoli */ }
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* bez localStorage */ }
  }

  function agoText(t) {
    if (!t) return 'nigdy';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 120 ? s + ' s temu' : Math.round(s / 60) + ' min temu';
  }

  function dbg(part, msg) {
    const now = new Date();
    const time = now.toLocaleTimeString('pl-PL', { hour12: false }) + '.' +
      String(now.getMilliseconds()).padStart(3, '0');
    const line = time + ' [' + part + '] ' + msg + FRAME_TAG;
    DEBUG_LOG.push(line);
    if (DEBUG_LOG.length > 300) DEBUG_LOG.shift();
    console.info('[multilab] ' + line);
    const day = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0');
    diagPush(day + ' ' + line);
  }

  // Krótki skrót identyfikatora sesji — pokazuje, czy serwer wydał nową sesję,
  // bez zapisywania samego identyfikatora.
  function sessionTag() {
    const m = document.cookie.match(/(?:^|;\s*)PHPSESSID=([^;]+)/);
    if (!m) return 'brak ciasteczka';
    let h = 0;
    for (const c of m[1]) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    return h.toString(36).slice(-4);
  }

  function navigationInfo() {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    let from = '(brak)';
    if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        from = ref.origin === location.origin ? ref.pathname : ref.origin;
      } catch { from = '(?)'; }
    }
    return 'typ ' + (nav ? nav.type : '?') + ', z ' + from;
  }

  function injectMode() {
    try {
      return (typeof GM_info !== 'undefined' && GM_info.injectInto) || '?';
    } catch {
      return '?';
    }
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
      const lines = diagRead();
      alert(lines.length ? lines.slice(-80).join('\n') : (DEBUG_LOG.join('\n') || '(pusty log)'));
    });
  }

  // Komunikaty strony logowania widoczne dla użytkownika: „Błędne dane…”
  // (ctl0_Main_validationMessage, ukryty przez visibility:hidden), walidatory
  // pól (ctl0_Main_ctl0/ctl1) i captcha (ctl0_Main_pCaptcha). Wg strony z 06.11.2026.
  function visibleLoginMessages() {
    const parts = [];
    for (const id of ['ctl0_Main_validationMessage', 'ctl0_Main_ctl0', 'ctl0_Main_ctl1']) {
      const el = document.getElementById(id);
      const text = normalizeText(el?.textContent);
      if (text && isVisible(el)) parts.push('„' + text + '”');
    }
    const captcha = document.getElementById('ctl0_Main_pCaptcha');
    if (isVisible(captcha)) parts.push('captcha');
    return parts.join(', ');
  }

  function autoLogin() {
    const findUsernameField = () => document.getElementById('ctl0_Main_username');
    const findPasswordField = () => document.getElementById('ctl0_Main_password');
    const findSubmitButton = () => document.getElementById('ctl0_Main_ctl4');

    const isLoginForm = () => isVisible(findUsernameField()) && isVisible(findPasswordField());

    function hasVisibleError() {
      const msg = visibleLoginMessages();
      if (!msg) return false;
      dbg('login', 'na stronie: ' + msg);
      return true;
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
  // Serwer (PHP) kończy sesję po okresie bezczynności (dokładny czas nieznany;
  // PHP domyślnie 24 min). Każde zapytanie z ciasteczkiem sesji liczy ten czas
  // od nowa, więc w tle co kilka
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
    let dueAt = 0;
    let inFlight = false;
    let reloading = false;
    let lastTag = sessionTag();

    function schedule(delayMs) {
      clearTimeout(timer);
      if (reloading) return;
      dueAt = Date.now() + delayMs;
      timer = setTimeout(() => ping('co ' + Math.round(KEEPALIVE.pingEveryMs / 60_000) + ' min', true), delayMs);
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

    async function ping(reason, fromTimer) {
      if (inFlight || reloading) return;
      inFlight = true;
      let nextDelay = KEEPALIVE.pingEveryMs;
      const late = fromTimer ? Date.now() - dueAt : 0;
      const t0 = Date.now();
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), KEEPALIVE.pingTimeoutMs);
      try {
        const res = await fetch(location.origin + KEEPALIVE.pingPath, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        const html = await res.text();
        lastPingAt = Date.now();
        const tag = sessionTag();
        const details = 'HTTP ' + res.status + ', ' + new URL(res.url).pathname +
          (res.redirected ? ' (przekierowanie)' : '') + ', ' + Math.round(html.length / 1024) + ' kB, ' +
          (Date.now() - t0) + ' ms' +
          (html.includes('ctl0_Main_username') ? ', W ODPOWIEDZI FORMULARZ LOGOWANIA' : '') +
          (late > 5000 ? ', timer spóźniony ' + Math.round(late / 1000) + ' s' : '') +
          (tag !== lastTag ? ', NOWA SESJA ' + lastTag + ' → ' + tag : '');
        lastTag = tag;
        if (isLoginUrl(res.url)) {
          dbg('sesja', 'serwer odesłał na logowanie (' + reason + '): ' + details);
          if (reloadForRelogin()) return;
        } else {
          writeJson(DIAG.lastOkPingKey, { t: Date.now(), path: location.pathname });
          dbg('sesja', 'podtrzymana (' + reason + '): ' + details);
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
    let hiddenSince = document.hidden ? Date.now() : 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        return;
      }
      if (hiddenSince && Date.now() - hiddenSince >= 60_000) {
        dbg('karta', 'powrót do karty po ' + Math.round((Date.now() - hiddenSince) / 60_000) +
          ' min; ostatnie podtrzymanie ' + agoText(lastPingAt));
      }
      hiddenSince = 0;
      pingIfOverdue('powrót do karty');
    });
    window.addEventListener('online', () => pingIfOverdue('powrót sieci'));
    window.addEventListener('offline', () => dbg('sesja', 'przeglądarka zgłasza brak sieci'));

    schedule(KEEPALIVE.pingEveryMs);
    dbg('sesja', 'podtrzymanie włączone — zapytanie w tle co ' +
      Math.round(KEEPALIVE.pingEveryMs / 60_000) + ' min');
  }

  // ───────────── diagnostyka strony ─────────────
  // Zapytania XHR samej strony (wyszukiwanie, przyciski „Wynik” — callbacki
  // PRADO): status, adres po przekierowaniach i czy w odpowiedzi przyszła
  // strona logowania. Tylko odczyt, nie zmienia zapytań.

  function watchPageRequests() {
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const proto = W.XMLHttpRequest?.prototype;
    if (!proto || proto.__multilabDiag) return;
    const origSend = proto.send;
    proto.send = function (...args) {
      const xhr = this;
      const t0 = Date.now();
      xhr.addEventListener('loadend', () => {
        try {
          let path = '?';
          try { path = new URL(xhr.responseURL).pathname; } catch { /* brak adresu */ }
          let text = '';
          try {
            if (xhr.responseType === '' || xhr.responseType === 'text') text = xhr.responseText || '';
          } catch { /* odpowiedź nietekstowa */ }
          const login = path.startsWith('/page,login') || text.includes('ctl0_Main_username');
          dbg('strona', 'XHR ' + xhr.status + ' ' + path + ', ' + Math.round(text.length / 1024) + ' kB, ' +
            (Date.now() - t0) + ' ms' + (login ? ' — ODPOWIEDŹ TO STRONA LOGOWANIA' : ''));
        } catch { /* diagnostyka nie może psuć strony */ }
      });
      return origSend.apply(this, args);
    };
    proto.__multilabDiag = true;
  }

  function logPageStart() {
    dbg('start', 'wersja ' + (typeof GM_info !== 'undefined' ? GM_info.script?.version : '?') +
      ', tryb ' + injectMode() + ', ' + location.pathname + ', ' + navigationInfo() +
      ', sesja ' + sessionTag());
    window.addEventListener('pagehide', () => {
      writeJson(DIAG.lastLeaveKey, { t: Date.now(), path: location.pathname });
    });
  }

  function logLoginArrival() {
    const ok = readJson(DIAG.lastOkPingKey);
    const leave = readJson(DIAG.lastLeaveKey);
    dbg('login', 'strona logowania; ostatnie udane podtrzymanie ' + agoText(ok?.t) +
      ', poprzednia strona opuszczona ' + agoText(leave?.t) + (leave?.path ? ' (' + leave.path + ')' : ''));
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
    if (IS_TOP_WINDOW) {
      runPart('start', logPageStart);
      runPart('menu', registerMenu);
    }
    if (IS_LOGIN_PAGE) {
      if (IS_TOP_WINDOW) runPart('login', logLoginArrival);
      runPart('login', autoLogin);
      return;
    }
    if (IS_TOP_WINDOW) {
      runPart('strona', watchPageRequests);
      runPart('sesja', keepAlive);
    }
    if (IS_HOME_PAGE) runPart('data od', dataOd);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
