// ==UserScript==
// @name         TwojeWyniki — auto Zaloguj + Pacjenci
// @namespace    local.twojewyniki-auto-login
// @version      1.9.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/twojewyniki-alab-auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/twojewyniki-alab-auto-login.user.js
// @description  Auto Zaloguj, potem zakładka Pacjenci i fokus na szybki filtr
// @match        https://gdynia.twojewyniki.com.pl/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const LOGIN_DONE_KEY = 'twojewyniki_auto_login_done_v1';
  const PACJENCI_DONE_KEY = 'twojewyniki_pacjenci_done_v1';

  // --- Bezpiecznik: seria nieudanych logowań (wygasłe hasło) --------------
  // Po zmianie hasła w ALAB-ie menedżer haseł przeglądarki podstawia stare —
  // logowanie się nie udaje, serwer zwraca dokładnie ten sam ekran logowania
  // (LOGIN_HEADER nadal widoczny), a scheduleSubmit()/startLoginPoll() od
  // razu wysyłają formularz jeszcze raz. Bez bezpiecznika to się kręci
  // bez końca. Ten sam mechanizm co w serum-ui.user.js (bootLogin →
  // PROBY_KEY), tu w osobnym namespace localStorage.
  const PROBY_KEY = 'twojewyniki_auto_login_proby_v1';
  const MAX_PROB = 3;
  // localStorage (nie sessionStorage): pętla przechodzi przez przeładowania
  // strony i blokada ma obowiązywać też po otwarciu nowej karty.
  const SERIA_OKNO_MS = 5 * 60_000;
  const BANER_ID = 'twojewyniki-login-blokada';

  function zerujProby() {
    try { localStorage.removeItem(PROBY_KEY); } catch (_) {}
  }

  function zapiszProby(n) {
    try { localStorage.setItem(PROBY_KEY, JSON.stringify({ n, t: Date.now() })); } catch (_) {}
  }

  function wczytajProby() {
    try {
      const raw = localStorage.getItem(PROBY_KEY);
      if (!raw) return 0;
      const dane = JSON.parse(raw);
      const n = Number(dane?.n) || 0;
      const t = Number(dane?.t) || 0;
      if (!n || Date.now() - t > SERIA_OKNO_MS) { zerujProby(); return 0; }
      return n;
    } catch (_) { zerujProby(); return 0; }
  }

  // Czytane raz przy wstrzyknięciu skryptu (document-start) i trzymane w
  // pamięci — licznik zmienia się najwyżej raz na wczytanie strony (jedna
  // próba logowania).
  let probySerii = wczytajProby();

  function autoLogowanieZablokowane() {
    return probySerii >= MAX_PROB;
  }

  function odblokujAutoLogowanie(zrodlo) {
    if (!probySerii) return;
    probySerii = 0;
    zerujProby();
    document.getElementById(BANER_ID)?.remove();
    tlog('licznik nieudanych prób logowania wyzerowany (' + zrodlo + ')');
  }

  function pokazBanerBlokady() {
    if (!document.body || document.getElementById(BANER_ID)) return;

    const baner = document.createElement('div');
    baner.id = BANER_ID;
    Object.assign(baner.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: '0',
      right: '0',
      top: '0',
      padding: '10px 16px',
      background: '#c62828',
      color: '#fff',
      font: '600 13px/1.45 system-ui, -apple-system, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,.35)',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
    });

    const tresc = document.createElement('span');
    tresc.style.flex = '1';
    tresc.textContent =
      'Auto-logowanie zatrzymane po ' + MAX_PROB + ' nieudanych próbach z rzędu. ' +
      'Najczęstsza przyczyna: zmiana hasła w ALAB-ie, a menedżer haseł podstawia stare. ' +
      'Wyczyść pole hasła, wpisz nowe ręcznie i zaloguj się — licznik wyzeruje się sam.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Wznów auto-logowanie';
    Object.assign(btn.style, {
      flex: '0 0 auto',
      padding: '5px 12px',
      border: '1px solid rgba(255,255,255,.6)',
      borderRadius: '5px',
      background: 'transparent',
      color: '#fff',
      font: 'inherit',
      cursor: 'pointer',
    });
    btn.addEventListener('click', () => {
      odblokujAutoLogowanie('przycisk w banerze');
      loginPollStarted = false;
      startLoginPoll();
    });

    baner.append(tresc, btn);
    document.body.appendChild(baner);
  }

  const LABELS = {
    unit: 'Jednostka organizacyjna',
    login: 'Identyfikator',
    password: 'Hasło',
  };
  const SUBMIT_BUTTON = 'Zaloguj';
  const LOGIN_HEADER = 'Rozpoczęcie pracy';
  const PACJENCI_TAB = 'Pacjenci';
  const PATIENTS_HEADER = 'Kartoteka pacjentów';
  const QUICK_FILTER = 'Szybki filtr na nazwisko lub PESEL pacjenta';
  const MENU_TOP_MAX_Y = 200;

  // Potwierdzone inspektorem — pola formularza logowania nie mają id, ale mają
  // stałe atrybuty name:
  //   <input type="text"     name="jednostka"     value="GCZMEDI" …>
  //   <input type="text"     name="identyfikator" …>
  //   <input type="password" name="password"      …>
  //   <input type="submit"   value="Zaloguj">   (+ <input type="hidden" name="cmd" value="1">)
  const FIELD_NAMES = {
    unit: 'jednostka',
    login: 'identyfikator',
    password: 'password',
  };

  const CONFIG = {
    // Krótsza zwłoka niż dotąd (300 ms): od teraz spóźnione autouzupełnienie
    // i tak złapie pętla poniżej, więc nie ma po co czekać „na zapas”.
    autofillGraceMs: 120,
    // Menedżer haseł Firefoksa wypełnia pola, ustawiając WŁAŚCIWOŚĆ .value —
    // nie atrybut — i często NIE wysyła przy tym zdarzeń input/change. Dlatego
    // ani obserwator z attributeFilter:['value'], ani nasłuch input/change nie
    // muszą się w ogóle odpalić. Bez tej pętli, jeśli hasło wpadło później niż
    // ~300 ms po wczytaniu strony (a wpada — strona ma zewnętrzną ramkę
    // alabserwis.pl i własne <body onload>), logowanie NIE RUSZAŁO aż do
    // pierwszej interakcji użytkownika. To główna przyczyna wrażenia, że
    // „loguje się wolno”.
    pollMs: 150,
    maxWaitMs: 30_000,
  };

  // --- pomiar czasów (widoczny w konsoli przeglądarki, zakładka „Konsola”) ---
  // Nagranie ekranu pokazało, że hasło jest wypełnione JUŻ w pierwszej klatce
  // z formularzem, a mimo to przejście dalej następuje ~1,5 s później. To
  // rozstrzyga, czy zwleka skrypt, czy serwer ALAB-u: „gotowe po” to moment,
  // w którym dane były kompletne, „wysyłam po” — kiedy skrypt kliknął Zaloguj,
  // a „serwer oddał tę stronę w” — ile trwała sama odpowiedź serwera.
  function tlog(msg) {
    try {
      console.log('%c[TwojeWyniki +' + Math.round(performance.now()) + 'ms] ' + msg, 'color:#0a7;font-weight:bold');
    } catch (_) {}
  }

  function logNavigationTiming() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return;
      tlog(
        'serwer oddał tę stronę w ' + Math.round(nav.responseStart - nav.requestStart) + 'ms' +
        ' (pełna odpowiedź ' + Math.round(nav.responseEnd - nav.requestStart) + 'ms' +
        ', DOM gotowy ' + Math.round(nav.domContentLoadedEventEnd) + 'ms' +
        ', pełne wczytanie ' + Math.round(nav.loadEventEnd || 0) + 'ms)'
      );
    } catch (_) {}
  }

  // --- oś czasu przez WSZYSTKIE przeładowania stron ---
  // Logowanie to trzy kolejne wczytania strony (formularz → strona po
  // zalogowaniu → Pacjenci), a konsola czyści się przy każdym z nich. Kroki
  // zapisujemy więc w sessionStorage i na końcu wypisujemy całość naraz —
  // jeden zrzut ekranu pokaże, gdzie dokładnie ucieka czas.
  const TIMELINE_KEY = 'twojewyniki_timeline_v1';

  function markStep(name) {
    try {
      const arr = JSON.parse(sessionStorage.getItem(TIMELINE_KEY) || '[]');
      arr.push([Date.now(), name]);
      if (arr.length > 40) arr.shift();
      sessionStorage.setItem(TIMELINE_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  function resetTimeline() {
    try { sessionStorage.removeItem(TIMELINE_KEY); } catch (_) {}
  }

  function dumpTimeline(powod) {
    try {
      const arr = JSON.parse(sessionStorage.getItem(TIMELINE_KEY) || '[]');
      if (arr.length < 2) return;
      const t0 = arr[0][0];
      const linie = arr.map(([t, n], i) => {
        const odPocz = t - t0;
        const odPoprz = i ? t - arr[i - 1][0] : 0;
        return '  +' + String(odPocz).padStart(5) + 'ms  (+' + String(odPoprz).padStart(4) + 'ms)  ' + n;
      });
      console.log(
        '%c[TwojeWyniki] OŚ CZASU — ' + powod + ' (łącznie ' + (arr[arr.length - 1][0] - t0) + 'ms)\n' + linie.join('\n'),
        'color:#c60;font-weight:bold'
      );
    } catch (_) {}
  }

  let credentialsReadyLogged = false;

  let submitTimer = null;
  let pacjenciTimer = null;
  let pacjenciNavAttempts = 0;
  let loginObserver = null;
  let pacjenciObserver = null;

  function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInTopMenuArea(el) {
    if (!el) return false;
    if (el.closest('.sciezka, .footer, .wersja, .dolnemenu, .panels, .panels-caption')) {
      return false;
    }
    return el.getBoundingClientRect().top <= MENU_TOP_MAX_Y;
  }

  function pageHeaderText() {
    const header = document.querySelector('td.header, .header');
    return normalize(header?.textContent || '');
  }

  function matchesLabel(node, target) {
    const want = normalize(target).toLowerCase().replace(/:$/, '');
    const own = normalize(
      [...node.childNodes]
        .filter(
          (n) =>
            n.nodeType === Node.TEXT_NODE ||
            (n.nodeType === Node.ELEMENT_NODE && n.childElementCount === 0)
        )
        .map((n) => n.textContent)
        .join('')
    )
      .toLowerCase()
      .replace(/:$/, '');
    if (own === want) return true;
    const full = normalize(node.textContent).toLowerCase().replace(/:$/, '');
    return full === want && full.length <= 80;
  }

  function findInputNearLabel(labelNode) {
    if (labelNode.htmlFor) {
      const linked = document.getElementById(labelNode.htmlFor);
      if (linked && isVisible(linked)) return linked;
    }

    const row = labelNode.closest('tr');
    if (row) {
      const cells = [...row.querySelectorAll('td, th')];
      const idx = cells.findIndex((c) => c === labelNode || c.contains(labelNode));
      for (let i = idx + 1; i < cells.length; i++) {
        const input = cells[i].querySelector('input, textarea, select');
        if (input && isVisible(input)) return input;
      }
    }

    let sibling = labelNode.nextElementSibling;
    for (let i = 0; i < 5 && sibling; i++) {
      if (sibling.matches?.('input, textarea, select') && isVisible(sibling)) return sibling;
      const nested = sibling.querySelector?.('input, textarea, select');
      if (nested && isVisible(nested)) return nested;
      sibling = sibling.nextElementSibling;
    }

    const container = labelNode.closest('tr, fieldset, div, form') || labelNode.parentElement;
    const inContainer = container?.querySelector('input, textarea, select');
    if (inContainer && isVisible(inContainer)) return inContainer;

    return null;
  }

  function findFieldByLabel(labelText, root) {
    const scope = root || document;
    const nodes = [...scope.querySelectorAll('label, th, td, span, div, legend')];
    for (const node of nodes) {
      if (!matchesLabel(node, labelText)) continue;
      const input = findInputNearLabel(node);
      if (input) return input;
    }
    return null;
  }

  function findLoginForm() {
    const submit = [...document.querySelectorAll('input[type="submit"], button')].find(
      (el) => normalize(el.value || el.textContent) === SUBMIT_BUTTON && isVisible(el)
    );
    return submit?.closest('form') || null;
  }

  // Pola zapamiętane między sprawdzeniami — pętla odpytuje co 150 ms, a bez
  // tego KAŻDE sprawdzenie uruchamiało od nowa findLoginForm() + skan
  // wszystkich label/th/td/span/div/legend, i to trzy razy (a credentialsReady
  // wołało je po raz drugi, czyli sześć skanów na jedno sprawdzenie).
  const fieldCache = { unit: null, login: null, password: null };

  function findFieldFast(kind, labelText, extraSelector) {
    const cached = fieldCache[kind];
    if (cached && isVisible(cached)) return cached;

    // Stały atrybut name — potwierdzony inspektorem, rozstrzyga od razu.
    const byName = document.querySelector('input[name="' + FIELD_NAMES[kind] + '"]');
    if (byName && isVisible(byName)) {
      fieldCache[kind] = byName;
      return byName;
    }

    // Dopóki dokument się doczytuje, nie uruchamiamy kosztownych ścieżek
    // awaryjnych: pola mogą jeszcze nie mieć policzonego układu (isVisible
    // zwraca wtedy fałsz), a pętla i tak sprawdza ponownie za 150 ms.
    if (document.readyState === 'loading') return null;

    // Ścieżki awaryjne (gdyby ALAB zmienił formularz) — dopiero teraz drogie.
    const form = findLoginForm();
    const byLabel =
      (form && findFieldByLabel(labelText, form)) ||
      findFieldByLabel(labelText) ||
      (extraSelector ? document.querySelector(extraSelector) : null);
    fieldCache[kind] = byLabel || null;
    return fieldCache[kind];
  }

  function findUnitField() {
    return findFieldFast('unit', LABELS.unit);
  }

  function findLoginField() {
    return findFieldFast('login', LABELS.login);
  }

  function findPasswordField() {
    return findFieldFast('password', LABELS.password, 'form input[type="password"]');
  }

  function getValue(field) {
    return normalize(field?.value || '');
  }

  function isLoginPage() {
    if (!pageHeaderText().includes(LOGIN_HEADER)) return false;
    const unit = findUnitField();
    const login = findLoginField();
    const password = findPasswordField();
    return Boolean(
      unit && login && password && isVisible(unit) && isVisible(login) && isVisible(password)
    );
  }

  function credentialsReady() {
    if (!isLoginPage()) return false;
    const ready = Boolean(
      getValue(findUnitField()) && getValue(findLoginField()) && getValue(findPasswordField())
    );
    if (ready && !credentialsReadyLogged) {
      credentialsReadyLogged = true;
      tlog('dane logowania gotowe (menedżer haseł wypełnił pola)');
      markStep('dane logowania kompletne');
    }
    return ready;
  }

  function storageGet(key) {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function storageSet(key) {
    try {
      sessionStorage.setItem(key, '1');
    } catch (_) {}
  }

  function storageClear(key) {
    try {
      sessionStorage.removeItem(key);
    } catch (_) {}
  }

  function findSubmitButton() {
    const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], a')];
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = normalize(el.value || el.textContent);
      if (text === SUBMIT_BUTTON) return el;
    }
    return null;
  }

  // Formularz ma onsubmit="return OnSubmit(this, 0)", a OnSubmit pochodzi z
  // js/funkcje.js. Skoro wysyłamy teraz DUŻO wcześniej niż dotąd (już przy
  // document-start), musimy się upewnić, że ta funkcja zdążyła się wczytać —
  // inaczej ryzykujemy wysyłkę z pominięciem tego, co ona robi.
  // (@grant none → skrypt działa w kontekście strony, więc widzi jej window.)
  let formApiWaitStart = 0;

  let formApiWaitLogged = false;

  function pageFormApiReady() {
    if (typeof window.OnSubmit === 'function') {
      if (formApiWaitStart && !formApiWaitLogged) {
        formApiWaitLogged = true;
        markStep('doczekano się js/funkcje.js (OnSubmit) — czekano ' + (Date.now() - formApiWaitStart) + 'ms');
      }
      return true;
    }
    if (!formApiWaitStart) {
      formApiWaitStart = Date.now();
      markStep('CZEKAM na js/funkcje.js (OnSubmit jeszcze niezaładowane)');
    }
    if (Date.now() - formApiWaitStart > 2000) {
      tlog('UWAGA: window.OnSubmit nie pojawiło się przez 2s — wysyłam mimo to');
      return true;
    }
    return false;
  }

  function submitLogin() {
    if (!credentialsReady() || storageGet(LOGIN_DONE_KEY)) return false;
    if (!pageFormApiReady()) return false;
    if (autoLogowanieZablokowane()) {
      pokazBanerBlokady();
      tlog('WSTRZYMANE — ' + probySerii + ' nieudane próby logowania z rzędu (hasło do zmiany?)');
      markStep('WSTRZYMANE auto-logowanie (' + probySerii + '/' + MAX_PROB + ' prób)');
      return false;
    }

    const btn = findSubmitButton();
    const form = findLoginForm();

    storageSet(LOGIN_DONE_KEY);
    storageClear(PACJENCI_DONE_KEY);
    pacjenciNavAttempts = 0;
    loginObserver?.disconnect();

    // Zapisujemy PRZED wysłaniem — zaraz po nim strona się przeładowuje.
    probySerii += 1;
    zapiszProby(probySerii);

    tlog('WYSYŁAM formularz logowania (' + (btn ? 'klik Zaloguj' : 'submit formularza') + ')' +
      ' — próba ' + probySerii + '/' + MAX_PROB + ' — od tej chwili czekamy już tylko na serwer ALAB');
    markStep('WYSŁANO formularz logowania (próba ' + probySerii + '/' + MAX_PROB + ')');

    if (btn) {
      btn.click();
    } else if (form?.requestSubmit) {
      form.requestSubmit();
    } else if (form) {
      form.submit();
    }

    return true;
  }

  function scheduleSubmit() {
    if (autoLogowanieZablokowane()) { pokazBanerBlokady(); return; }
    if (submitTimer) return;
    if (credentialsReady()) {
      submitLogin();
      return;
    }
    submitTimer = setTimeout(() => {
      submitTimer = null;
      if (credentialsReady()) submitLogin();
    }, CONFIG.autofillGraceMs);
  }

  function directText(el) {
    return normalize(
      [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join('')
    );
  }

  function elementTextMatchesPacjenci(el) {
    const direct = directText(el);
    if (direct === PACJENCI_TAB) return true;
    return el.childElementCount === 0 && normalize(el.textContent) === PACJENCI_TAB;
  }

  function findPacjenciTarget() {
    const menuScopes = [
      ...document.querySelectorAll('.gornemenu, td.gornemenu, div.gornemenu, table.tabs'),
    ];

    for (const scope of menuScopes) {
      for (const a of scope.querySelectorAll('a')) {
        if (!isVisible(a)) continue;
        if (!elementTextMatchesPacjenci(a)) continue;
        return a;
      }
      for (const td of scope.querySelectorAll('td')) {
        if (!isVisible(td)) continue;
        if (!elementTextMatchesPacjenci(td)) continue;
        return td.querySelector('a') || td;
      }
    }

    for (const a of document.querySelectorAll('a[href]')) {
      if (!isVisible(a) || !isInTopMenuArea(a)) continue;
      const href = a.getAttribute('href') || '';
      if (/pacjent/i.test(href) || /pacjent/i.test(a.href)) return a;
      if (elementTextMatchesPacjenci(a)) return a;
    }

    for (const el of document.querySelectorAll('a, td, span, div')) {
      if (!isVisible(el) || !isInTopMenuArea(el)) continue;
      if (!elementTextMatchesPacjenci(el)) continue;
      return el.matches('a') ? el : el.querySelector('a') || el;
    }

    const topTable = document.querySelector('td.gornemenu table, div.gornemenu table, table.tabs');
    if (topTable) {
      for (const cell of topTable.querySelectorAll('td, a')) {
        if (!isVisible(cell)) continue;
        if (!elementTextMatchesPacjenci(cell)) continue;
        return cell.matches('a') ? cell : cell.querySelector('a') || cell;
      }
    }

    return null;
  }

  function isPacjenciTabActive() {
    if (pageHeaderText().includes(PATIENTS_HEADER)) return true;

    for (const el of document.querySelectorAll('.gornemenu a, td.gornemenu a, div.gornemenu a, a.tabs-selected')) {
      if (!isVisible(el)) continue;
      if (!elementTextMatchesPacjenci(el)) continue;
      if (el.classList.contains('tabs-selected')) return true;
    }

    const target = findPacjenciTarget();
    return Boolean(target?.classList?.contains('tabs-selected'));
  }

  function findQuickFilter() {
    if (!pageHeaderText().includes(PATIENTS_HEADER)) return null;

    const byTitle =
      document.querySelector('input[title*="Szybki filtr" i]') ||
      document.querySelector('input[title*="nazwisko lub PESEL" i]');
    if (byTitle && isVisible(byTitle)) return byTitle;

    const byLabel = findFieldByLabel(QUICK_FILTER);
    if (byLabel && isVisible(byLabel)) return byLabel;

    return null;
  }

  function activateTarget(target) {
    if (!target) return false;

    if (target.tagName === 'A') {
      const rawHref = target.getAttribute('href') || '';
      if (rawHref.startsWith('javascript:')) {
        target.click();
        return true;
      }
      if (rawHref && rawHref !== '#' && target.href && target.href !== location.href) {
        location.assign(target.href);
        return true;
      }
    }

    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    target.click();

    if (typeof target.onclick === 'function') {
      try {
        target.onclick();
      } catch (_) {}
    }

    return true;
  }

  function navigateToPacjenci() {
    if (isPacjenciTabActive()) return true;

    const target = findPacjenciTarget();
    if (!target) return false;

    pacjenciNavAttempts += 1;
    markStep('klikam zakładkę „Pacjenci” (próba ' + pacjenciNavAttempts + ')');
    return activateTarget(target);
  }

  function focusQuickFilter() {
    const input = findQuickFilter();
    if (!input) return false;
    input.focus({ preventScroll: false });
    if (typeof input.select === 'function') input.select();
    return true;
  }

  function setupPacjenci() {
    if (isLoginPage()) {
      storageClear(PACJENCI_DONE_KEY);
      pacjenciNavAttempts = 0;
      return;
    }
    if (storageGet(PACJENCI_DONE_KEY)) return;

    if (!isPacjenciTabActive()) {
      if (pacjenciNavAttempts < 20) navigateToPacjenci();
      return;
    }

    if (focusQuickFilter()) {
      storageSet(PACJENCI_DONE_KEY);
      pacjenciObserver?.disconnect();
      markStep('KONIEC: fokus w szybkim filtrze — gotowe do pracy');
      dumpTimeline('pełny przebieg logowania');
    }
  }

  function schedulePacjenci() {
    if (pacjenciTimer) return;
    pacjenciTimer = setTimeout(() => {
      pacjenciTimer = null;
      setupPacjenci();
    }, 350);
  }

  // Pętla wystartowana JUŻ PRZY document-start — czyli zanim dokument w ogóle
  // zostanie doczytany. Pomiar w konsoli pokazał, że przy @run-at document-end
  // skrypt ruszał nawet po 1492 ms, choć serwer oddawał stronę w 116 ms, a DOM
  // był gotowy po 311 ms. Te ~1,2 s bezczynności to były właśnie brakujące
  // „1–1,5 s” z nagrania — skrypt nie zdążył nawet spojrzeć na formularz.
  // Pola znajdujemy po atrybucie name, więc działa to od momentu, w którym
  // przeglądarka je sparsuje, bez czekania na DOMContentLoaded.
  let loginPollStarted = false;

  function startLoginPoll() {
    if (loginPollStarted) return;
    loginPollStarted = true;

    const pollStart = Date.now();
    const poll = setInterval(() => {
      if (storageGet(LOGIN_DONE_KEY)) {
        clearInterval(poll);
        return;
      }
      if (autoLogowanieZablokowane()) {
        pokazBanerBlokady();
        clearInterval(poll);
        loginPollStarted = false; // pozwala wznowić pętlę po kliku w banerze
        return;
      }
      if (credentialsReady()) submitLogin();

      // Dokument już doczytany i to nie jest ekran logowania — nie ma na co
      // czekać (np. zwykła podstrona po zalogowaniu). To też dowód udanego
      // logowania, więc przerywa ewentualną serię nieudanych prób.
      const notLoginPage = document.readyState !== 'loading' && !isLoginPage();
      if (notLoginPage) odblokujAutoLogowanie('poza ekranem logowania');
      if (storageGet(LOGIN_DONE_KEY) || notLoginPage || Date.now() - pollStart > CONFIG.maxWaitMs) {
        clearInterval(poll);
      }
    }, CONFIG.pollMs);
  }

  function bootLogin() {
    if (!isLoginPage()) {
      // Strona poza ekranem logowania = dowód udanego logowania.
      odblokujAutoLogowanie('poza ekranem logowania');
      return;
    }
    if (autoLogowanieZablokowane()) { pokazBanerBlokady(); return; }

    storageClear(LOGIN_DONE_KEY);
    scheduleSubmit();

    loginObserver = new MutationObserver(() => {
      if (!isLoginPage() || storageGet(LOGIN_DONE_KEY)) return;
      if (credentialsReady()) scheduleSubmit();
    });

    loginObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value'],
    });

    document.addEventListener('input', scheduleSubmit, true);
    document.addEventListener('change', scheduleSubmit, true);

    // Siatka bezpieczeństwa: menedżer haseł wypełnia pola po cichu (właściwość
    // .value, bez zdarzeń), więc obserwator i nasłuchy powyżej mogą się nigdy
    // nie odpalić. Pętla i tak już działa (startuje przy document-start), to
    // wywołanie jest bezpieczne — samo się pilnuje przed podwójnym startem.
    startLoginPoll();

    setTimeout(() => loginObserver?.disconnect(), CONFIG.maxWaitMs);
  }

  function bootPacjenci() {
    if (storageGet(PACJENCI_DONE_KEY)) return;

    // Od razu, bez czekania na 350 ms debounce'a — po zalogowaniu strona jest
    // już wczytana, więc zwlekanie tylko wydłużało drogę do listy pacjentów.
    setupPacjenci();
    setTimeout(setupPacjenci, 800);
    setTimeout(setupPacjenci, 3500);

    pacjenciObserver = new MutationObserver(() => {
      if (storageGet(PACJENCI_DONE_KEY)) {
        pacjenciObserver?.disconnect();
        return;
      }
      schedulePacjenci();
    });

    pacjenciObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => pacjenciObserver?.disconnect(), CONFIG.maxWaitMs);
  }

  function boot() {
    tlog('dokument gotowy, ekran logowania=' + isLoginPage());
    // Czas odpowiedzi serwera mierzymy po pełnym wczytaniu — loadEventEnd
    // dostaje wartość dopiero PO zakończeniu obsługi zdarzenia load, stąd
    // setTimeout (bez niego w logu było „pełne wczytanie 0ms”).
    if (document.readyState === 'complete') setTimeout(logNavigationTiming, 0);
    else window.addEventListener('load', () => setTimeout(logNavigationTiming, 0), { once: true });

    bootLogin();
    bootPacjenci();
  }

  // === START ===
  // Pętla logowania rusza NATYCHMIAST, bez czekania na DOMContentLoaded —
  // to jest właśnie ta oszczędność ~1,2 s (patrz komentarz przy
  // startLoginPoll). Pola są znajdowane po atrybucie name, więc pętla zaczyna
  // działać, gdy tylko przeglądarka sparsuje formularz.
  tlog('skrypt wstrzyknięty (readyState=' + document.readyState + ')');
  // Nowy przebieg zaczynamy liczyć od ekranu logowania. Rozpoznajemy go po
  // samym adresie/HTML-u, bo na document-start DOM jeszcze nie istnieje.
  if (!storageGet(LOGIN_DONE_KEY)) resetTimeline();
  markStep('start strony ' + location.pathname + location.search);
  startLoginPoll();

  // Reszta (obserwatory, nasłuchy, moduł „Pacjenci”) wymaga document.body.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();