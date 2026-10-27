// ==UserScript==
// @name         Serum — automatyzacja (zbiorczy)
// @namespace    local.serum-ui
// @version      3.120.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-ui.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-ui.user.js
// @description  WYNIKI OPERACJI, SMS, Podpisz e-receptę, eZLA OSTRZEŻENIE (przerwa między zwolnieniami) auto Wyślij, Powód edycji, Podpisz, LUX MED, login, auto Wizyty (EDM), klik wiersz→Edytuj, toast, mini paginacja obok Filtruj, auto Filtruj + Rozwiń w Historii wizyt, auto kod ICD-9 wg uwag z terminarza, auto OK dialogi, przekierowanie z błędu 404 (dawniej 3 osobne skrypty — połączone dla wydajności, jeden wspólny obserwator DOM zamiast kilku)
// @match        https://*.serum.com.pl/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Czas wstrzyknięcia TEGO uruchomienia skryptu — jeśli po jakimś czasie
  // log debugowania milknie na godziny mimo dalszej pracy, ten znacznik (przez
  // menu „Pokaż log debug”) od razu pokaże, czy to wciąż ten sam, „żywy”
  // egzemplarz skryptu, czy strona się w międzyczasie przeładowała.
  const SCRIPT_BOOT_AT = Date.now();
  const SCRIPT_VERSION = '3.120.0';

  // Uruchamia funkcję `fn` w kontekście strony (wstrzyknięty <script>), a nie
  // w kontekście, który Tampermonkey dał skryptowi. Domyślnie (bez @sandbox)
  // TM i w Firefoksie, i w Chromium/Brave i tak wpuszcza skrypt na stronę
  // (tryb „raw”), ale gdyby kiedyś przełączył na piaskownicę, kod strony
  // dalej działałby tak samo. Na document-start kod strony jeszcze nie ruszył.
  function wstrzyknijDoStrony(fn) {
    function inject() {
      const el = document.createElement('script');
      el.textContent = '(' + fn + ')();';
      (document.documentElement || document.head || document).appendChild(el);
      el.remove();
    }
    if (document.documentElement) inject();
    else document.addEventListener('DOMContentLoaded', inject, { once: true });
  }

  // =====================================================================
  // MODUŁ: natywne okna alert/confirm strony (dawniej serum-dialogs.user.js)
  // + fałszywe „Dawkomat chwilowo nie odpowiada”
  // Jeden kod, wyłącznie w kontekście strony. Wcześniej reguły były dwa razy
  // (kopia dla piaskownicy i kopia wstrzykiwana) i zdążyły się rozjechać.
  // Łatane jest samo okno: alert/confirm to własne pola window, a
  // Window.prototype.alert nie istnieje ani w Firefoksie, ani w Chromium
  // (sprawdzone), więc łatka prototypu nic nie robiła.
  // Musi wystartować na document-start, zanim strona zdąży wywołać własne
  // alert/confirm — dlatego to pierwsza rzecz w tym pliku.
  //
  // Dawkomat: prescriptions.js (initDawkomat) trzyma JEDEN wspólny timer 15 s
  // (self.dawkomatTimer) dla wszystkich recept. Przy kilku receptach naraz
  // każda nadpisuje uchwyt poprzedniej, a pierwsza wiadomość z dowolnej ramki
  // Dawkomatu kasuje tylko ostatni timer — wcześniejsze odpalają confirm,
  // choć ich Dawkomat dawno się załadował. „OK” przełączałoby wtedy działającą
  // receptę na standardowe dawkowanie.
  // Tu: zapamiętujemy, które ramki Dawkomatu już się odezwały (postMessage).
  // Gdy wszystkie się odezwały — to fałszywy alarm, cicho „Anuluj”.
  // Gdy któraś naprawdę milczy — przeładowujemy ją i dajemy jej jeszcze 20 s;
  // dopiero potem pytamy jak Serum i przy „OK” przełączamy jak initDawkomat.
  // Działa w oknie głównym i w ramkach z tej samej domeny.
  // =====================================================================
  function dialogiStrony() {
    var KEY = '__serumDialogi';
    if (window[KEY]) return;

    function norm(msg) { return msg == null ? '' : String(msg).toLowerCase(); }

    function smsWyslany() {
      try { document.dispatchEvent(new CustomEvent('serum-sms-sent')); } catch (e) {}
    }

    // Powiadomienia bez decyzji do podjęcia — zamykane jak „OK”, czy przyszły
    // jako alert, czy jako confirm.
    function powiadomienie(s) {
      if (s.trim().indexOf('wysłano sms o treści') === 0) {
        smsWyslany();
        return true;
      }
      if (s.indexOf('dokument został podpisany') !== -1) return true;
      // „Wysłano do P1” po podpisaniu IPOM-u.
      if (s.trim().indexOf('wysłano do p1') === 0) return true;
      if (s.indexOf('dokumenty zostały wysłane do zus') !== -1) return true;
      if (s.indexOf('zapisać świadczenie') !== -1 && s.indexOf('odznaczony') !== -1 && s.indexOf('kontynuować') !== -1) return true;
      return false;
    }

    // Lista ostrzeżeń recepty to linie „ - …” (prescriptions.js,
    // validateCommonFieldsWarn) — po jednej liście na każdą receptę.
    // true tylko, gdy na wszystkich listach jest wyłącznie brak rozpoznania.
    function tylkoBrakRozpoznania(s) {
      var linie = s.split('\n');
      var jest = false;
      for (var i = 0; i < linie.length; i++) {
        var l = linie[i].trim();
        if (l.charAt(0) !== '-') continue;
        if (l !== '- nie wybrano rozpoznania.') return false;
        jest = true;
      }
      return jest;
    }

    function handleAlert(msg) {
      var s = norm(msg);
      if (powiadomienie(s)) return true;
      // „Wróciły wyniki badań laboratoryjnych do zlecenia nr: 0003553105” —
      // powiadomienie (jeden przycisk OK), wyskakujące w trakcie pracy nad
      // inną wizytą. Numer zlecenia jest za każdym razem inny.
      if (s.indexOf('wróciły wyniki badań laboratoryjnych') !== -1) return true;
      return false;
    }

    // true/false = odpowiedź za użytkownika, null = pokaż okno.
    function handleConfirm(msg) {
      var s = norm(msg);
      if (s.indexOf('antropometrii') !== -1) {
        if (s.indexOf('zapisać wizytę') !== -1 || s.indexOf('zapisac wizyte') !== -1) return true;
        if (s.indexOf('uzupełnić') !== -1 || s.indexOf('uzupelnic') !== -1) return false;
      }
      if (powiadomienie(s)) return true;
      // „Nie podano kodu procedury ICD-9. Czy kontynuować?” przy zapisie
      // SKIEROWANIA (f_zapisz_skier_spec). Bez sztywnego „icd-9”, żeby
      // zadziałało też przy zapisie „ICD9”.
      if (s.indexOf('nie podano kodu procedury') !== -1 && s.indexOf('kontynuować') !== -1) return true;
      // „Co najmniej jedno z pól jest już uzupełnione. Czy chcesz dopisać
      // wartości z szablonu charakteru wizyty…?”
      if (s.indexOf('szablonu charakteru wizyty') !== -1) return true;
      // „ - Nie wybrano rozpoznania. … Czy na pewno zapisać receptę?” przy
      // zapisie/wysyłce recepty (prescriptions.js: validateCommonFieldsWarn,
      // klucz prescriptions.form.validationMessage.noDiagnosis). „OK” tylko,
      // gdy to jedyne ostrzeżenie — brak oddziału NFZ, odpłatności, dawkowania
      // itd. dalej pyta. „…na recepcie refundowanej” to blokujący alert z
      // błędem i zostaje bez zmian.
      if (s.indexOf('czy na pewno zapisać receptę') !== -1 && tylkoBrakRozpoznania(s)) return true;
      return null;
    }

    function dawkomat(win) {
      var doc = win.document;
      var odezwane = new WeakSet();
      var ponowione = new WeakSet();
      win.addEventListener('message', function (e) {
        if (e.source) odezwane.add(e.source);
      }, true);
      function milczy(f) {
        try { return !f.contentWindow || !odezwane.has(f.contentWindow); } catch (e) { return true; }
      }
      function naStandard(f) {
        var row = f.closest('.x-prescriptionDrugRow');
        if (!row) return;
        var $ = win.$Q;
        if ($) {
          $('.x-dawkomatCheck', row).prop('checked', false);
          $('.x-drugDaysPanel, .x-drugDosagePanel', row).show();
          $('.x-drugDosageDawkomatPanel', row).hide();
          $(row).find('.x-drugDosageDawkomat').html('');
          $(row).find('.x-dosageDocumentDescription, .x-dosageDocumentId, .x-dosageDocument').val('');
        }
      }
      var nativeConfirm = win.confirm;
      win.confirm = function (msg) {
        if (norm(msg).indexOf('dawkomat chwilowo nie odpowiada') === -1) {
          return nativeConfirm.apply(this, arguments);
        }
        var ramki = Array.prototype.slice.call(doc.querySelectorAll('iframe.dawkomat-frame')).filter(milczy);
        if (!ramki.length) {
          console.log('[serum-ui] Dawkomat: fałszywy alarm (wszystkie ramki odpowiedziały) — Anuluj');
          return false;
        }
        var nowe = ramki.filter(function (f) { return !ponowione.has(f); });
        if (!nowe.length) return nativeConfirm.apply(this, arguments);
        nowe.forEach(function (f) {
          ponowione.add(f);
          console.log('[serum-ui] Dawkomat: ramka milczy 15 s — przeładowuję');
          f.src = f.src;
        });
        var self = this;
        win.setTimeout(function () {
          var wciaz = nowe.filter(function (f) { return f.isConnected && milczy(f); });
          if (!wciaz.length) return;
          console.log('[serum-ui] Dawkomat: nadal milczy po przeładowaniu');
          if (nativeConfirm.call(self, msg)) wciaz.forEach(naStandard);
        }, 20000);
        return false;
      };
    }

    function patch(win) {
      if (!win || win[KEY]) return;
      win[KEY] = true;
      var nativeAlert = win.alert.bind(win);
      var nativeConfirm = win.confirm.bind(win);
      win.alert = function (msg) {
        if (handleAlert(msg)) return undefined;
        return nativeAlert.apply(this, arguments);
      };
      win.confirm = function (msg) {
        var answer = handleConfirm(msg);
        if (answer !== null) return answer;
        return nativeConfirm.apply(this, arguments);
      };
      // Po naszej łatce, żeby Dawkomat owijał już ją, a nie gołe okno.
      dawkomat(win);
    }

    var widziane = new WeakSet();
    function ramka(f) {
      if (widziane.has(f)) return;
      widziane.add(f);
      try { patch(f.contentWindow); } catch (e) {}
      // Każda nawigacja ramki to nowe okno bez łatki.
      f.addEventListener('load', function () { try { patch(f.contentWindow); } catch (e) {} });
    }
    function skanuj(root) {
      if (root.nodeName === 'IFRAME' || root.nodeName === 'FRAME') ramka(root);
      if (!root.firstElementChild) return;
      var n = root.querySelectorAll('iframe, frame');
      for (var i = 0; i < n.length; i++) ramka(n[i]);
    }

    patch(window);
    skanuj(document);
    // Jeden obserwator ramek dla obu łatek (wcześniej dwa osobne).
    new MutationObserver(function (rs) {
      for (var i = 0; i < rs.length; i++) {
        var a = rs[i].addedNodes;
        for (var j = 0; j < a.length; j++) if (a[j].nodeType === 1) skanuj(a[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  wstrzyknijDoStrony(dialogiStrony);

  // =====================================================================
  // MODUŁ: przekierowanie z błędu 404 (dawniej serum-redirect-404.user.js)
  // Aktywny tylko na /serum-web/error?code=404 — dla każdej innej strony
  // funkcja zwraca się natychmiast i nic więcej nie robi.
  // =====================================================================
  (function serumRedirect404Module() {
    if (!location.pathname.startsWith('/serum-web/error')) return;

    const params = new URLSearchParams(location.search);
    if (params.get('code') !== '404') return;

    const NOT_FOUND_TEXT = 'poszukiwany zasób nie istnieje';
    const HOME_BUTTON_LABEL = 'strona główna';

    function findHomeButton() {
      for (const el of document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')) {
        const label = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (label === HOME_BUTTON_LABEL) return el;
      }
      return null;
    }

    function tryRedirect() {
      const bodyText = (document.body?.textContent || '').toLowerCase();
      if (!bodyText.includes(NOT_FOUND_TEXT)) return false;

      const homeBtn = findHomeButton();
      if (homeBtn) {
        homeBtn.click();
      } else {
        location.replace('https://s2.serum.com.pl/');
      }
      return true;
    }

    function boot404() {
      if (tryRedirect()) return;

      const observer = new MutationObserver(() => {
        if (tryRedirect()) observer.disconnect();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10_000);
    }

    if (document.body) {
      boot404();
    } else {
      document.addEventListener('DOMContentLoaded', boot404, { once: true });
    }
  })();

  // =====================================================================
  // Reszta: UI automatyzacja (dawniej serum-ui.user.js), start dopiero
  // gdy <body> jest dostępne — patrz start() na końcu pliku.
  // =====================================================================

  function normalize(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function normLabel(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  // Elementy wstrzykiwane przez TEN skrypt. Mutacje na nich muszą być
  // ignorowane przez wspólny MutationObserver — inaczej skrypt sam siebie
  // napędza w nieskończoność: syncTopPager/modLabKopiujWyniki zapisują styl
  // (pozycję) tych elementów na każdym ticku → zmiana atrybutu „style” →
  // obserwator → scheduleUi → kolejny tick za 400ms → znowu zapis stylu...
  // Dowód z realnych logów: karta robocza tykała co ~0,40s (czyli dokładnie
  // próg debounce'a scheduleUi) NIEPRZERWANIE przez 20+ minut, podczas gdy
  // karta bezczynna — co 3,07s, czyli dokładnie setInterval(uiTick, 3000).
  const OWN_UI_IDS = new Set([
    'serum-ui-toast',
    'serum-ui-top-pager',
    'serum-ui-lab-copy-btn',
    'serum-ui-clipboard-helper',
    'serum-ui-login-blokada',
  ]);

  // Mutacje, które NIGDY nie interesują żadnego modułu — czysty szum.
  // Ranking wyzwalaczy z logu 18.08 (710 ticków w 445s):
  //     432 × childList span#czas_sesji_pozostaly_info   ← zegar sesji Serum
  //     176 × attributes tr.tr_over[class]               ← podświetlenie wiersza pod kursorem
  //     134 × attributes input#czas_sesji_pozostaly_data_do[value]
  //     101 × attributes tr.tr_nieparzysty[class]        ← paskowanie tabel
  //      83 × attributes tr.tr_parzysty[class]
  //      ~180 × attributes div.ui-tooltip[style]         ← dymki jQuery UI
  // Czyli ~80% wszystkich ticków brało się z odliczania czasu sesji i
  // kosmetyki tabel. Każdy taki tick to pełny przebieg wszystkich modułów.
  // Realne zmiany (dodanie/usunięcie węzłów) i tak generują własne mutacje,
  // więc odsianie tego szumu niczego nie psuje.
  const SZUM_IDS = new Set(['czas_sesji_pozostaly_info', 'czas_sesji_pozostaly_data_do']);

  function isNoiseMutation(rec) {
    const t = rec.target;
    if (!t) return false;

    // Zmiana tekstu WEWNĄTRZ zegara sesji — celem jest wtedy węzeł tekstowy.
    if (t.nodeType !== Node.ELEMENT_NODE) {
      const rodzic = t.parentElement;
      if (rodzic?.classList?.contains('div_znaki_style')) return true;
      return !!(rodzic?.id && SZUM_IDS.has(rodzic.id));
    }

    if (t.id && SZUM_IDS.has(t.id)) return true;

    // Liczniki znaków pod polami tekstowymi (div.div_znaki_style) przepisują
    // swoją treść przy KAŻDYM naciśnięciu klawisza — w logu z 08.09.2026
    // 68 wyzwolonych ticków z jednego takiego licznika. Żaden nasz moduł nie
    // patrzy na liczbę znaków.
    if (t.classList?.contains('div_znaki_style')) return true;
    if (t.parentElement?.classList?.contains('div_znaki_style')) return true;

    // a.guziczek_bez_marg_szary.zal_sms — Serum przepisuje jego zawartość
    // przez cały dzień: w logach 16–1047 ticków na sesję (28.09: 1047 w 3 h
    // 22 min, drugi wyzwalacz po childList body). Żaden moduł go nie czyta.
    if (rec.type === 'childList' && t.classList?.contains('zal_sms')) return true;

    if (rec.type === 'attributes') {
      // Podświetlenie wiersza pod kursorem i paskowanie tabel.
      if (rec.attributeName === 'class' && t.tagName === 'TR') return true;
      // Klasy komórek: numerowanie wierszy przez Serum (td.s.lp) ORAZ nasze
      // WŁASNE serum-pacjent-hit z markPatientCells — to drugie napędzało
      // kolejne ticki samo z siebie. Nic u nas nie zależy od klasy komórki.
      if (rec.attributeName === 'class' && t.tagName === 'TD') return true;
      // Dymki jQuery UI — pozycjonowane stylem przy każdym najechaniu.
      if (rec.attributeName === 'style' && t.classList?.contains('ui-tooltip')) return true;
      if (rec.attributeName === 'style') {
        // Przyklejony nagłówek tabeli przelicza szerokości kolumn przy każdym
        // przewinięciu (table.przyklej + jej komórki nagłówka), a Serum stale
        // przestyla listy rozwijane. Razem 350+ ticków w jednym logu, wszystkie
        // czysto kosmetyczne. Widoczność elementów i tak sprawdzamy wprost
        // wtedy, gdy nas interesuje — nie przez nasłuchiwanie stylu.
        if (t.tagName === 'TH' || t.tagName === 'SELECT') return true;
        if (t.classList?.contains('przyklej')) return true;
      }
    }
    return false;
  }

  function isOwnUiNode(node) {
    for (let el = node; el; el = el.parentElement) {
      if (el.nodeType === Node.ELEMENT_NODE && el.id && OWN_UI_IDS.has(el.id)) return true;
    }
    return false;
  }

  // Zapis stylu tylko gdy wartość FAKTYCZNIE się zmienia. Przypisanie tej
  // samej wartości i tak przechodzi przez CSSOM i potrafi zgłosić mutację
  // atrybutu (a przy okazji unieważnia style) — a te funkcje wołane są na
  // każdym ticku, więc to czysty, powtarzalny narzut.
  function setStyleIfChanged(el, prop, value) {
    if (el.style[prop] !== value) el.style[prop] = value;
  }

  // Wszystkie elementy o danym id — Serum zostawia w DOM stare kopie okien
  // z tym samym id, a getElementById zwraca tylko pierwszą. Ale getElementById
  // to O(1): null znaczy, że nie ma ANI JEDNEJ kopii, więc pełny przelot
  // dokumentu selektorem [id="…"] (~0,45 ms na tick, log 28.09) robimy tylko
  // wtedy, gdy któraś istnieje.
  function wszystkieZId(id) {
    return document.getElementById(id) ? [...document.querySelectorAll('[id="' + id + '"]')] : [];
  }

  // Log przeżywa przeładowanie strony (sessionStorage). Dotąd był wyłącznie
  // w pamięci, więc każde przeładowanie Serum kasowało historię — a właśnie
  // wtedy log „kończył się wcześniej” i nie było w nim bieżących zdarzeń.
  const DEBUG_LOG_KEY = 'serum_ui_debug_log_v1';
  const DEBUG_LOG = (() => {
    try {
      const zapisany = JSON.parse(sessionStorage.getItem(DEBUG_LOG_KEY) || '[]');
      return Array.isArray(zapisany) ? zapisany : [];
    } catch (_) {
      return [];
    }
  })();

  // Zapis zdławiony do 1×/s — dbg() bywa wołane seriami, a serializacja
  // całego bufora przy każdym wpisie byłaby niepotrzebnym kosztem.
  let debugSaveTimer = null;
  function scheduleDebugSave() {
    if (debugSaveTimer) return;
    debugSaveTimer = setTimeout(() => {
      debugSaveTimer = null;
      zapiszLogTeraz();
    }, 5000);
  }

  function zapiszLogTeraz() {
    try {
      sessionStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(DEBUG_LOG));
    } catch (_) {}
  }

  // sessionStorage.setItem jest SYNCHRONICZNY i blokuje wątek główny, a bufor
  // to nawet 800 wierszy — przy zapisie co sekundę wychodziła z tego stała,
  // powtarzalna zadyszka dokładnie wtedy, gdy dzieje się najwięcej (bo wtedy
  // dbg() leci najgęściej). Co 5 s wystarczy, a przy zamykaniu/ukrywaniu
  // karty dopisujemy resztę, żeby nic z logu nie przepadło.
  window.addEventListener('pagehide', zapiszLogTeraz);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) zapiszLogTeraz();
  });

  function dbg(msg) {
    // Czas LOKALNY (nie UTC) — toISOString() dawał czas UTC, o 2h wcześniejszy
    // od czasu widocznego na zegarze systemowym/zrzutach ekranu latem w PL, co
    // przy porównywaniu logu ze zrzutem ekranu wyglądało jak wielogodzinna
    // cisza/zawieszenie pętli, choć log był w rzeczywistości świeży.
    const d = new Date();
    const t = d.toLocaleTimeString('pl-PL', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    DEBUG_LOG.push(t + ' ' + msg);
    // Bufor większy niż dawne 300 — log trafia teraz do pliku, więc nie ma
    // powodu go tak mocno przycinać.
    while (DEBUG_LOG.length > 800) DEBUG_LOG.shift();
    scheduleDebugSave();
  }
  // Aktualizowane na samym początku KAŻDEGO uiTick() — niezależnie od tego,
  // czy któryś moduł faktycznie coś zrobił i wywołał dbg(). Bez tego cisza w
  // logu jest niejednoznaczna: nie da się odróżnić „pętla żyje, po prostu nic
  // się nie dzieje” od „pętla w ogóle przestała się uruchamiać” — a to
  // rozróżnienie okazało się kluczowe przy niezamykającym się oknie WYNIKI
  // OPERACJI.
  let uiTickCount = 0;
  let uiLastTickAt = 0;

  // Kto właściwie wywołuje kolejne ticki? Log pokazywał, że karta robocza
  // tyka co ~0,40s (dokładnie próg debounce'a) NIEPRZERWANIE przez wiele
  // minut, choć nikt nic nie klika — czyli coś stale zmienia DOM. Ten licznik
  // pokazuje CO, zamiast zgadywania. Koszt: jeden krótki string na mutację,
  // która i tak przeszła przez filtr i zaplanowała tick (nie na każdą mutację).
  const tickTriggerStats = new Map();
  let szumOdfiltrowany = 0;

  function noteTickTrigger(rec) {
    if (tickTriggerStats.size > 200) return; // twardy limit — nie rośnie w nieskończoność
    const t = rec.target;
    let sig;
    if (t && t.nodeType === Node.ELEMENT_NODE) {
      sig =
        rec.type + ' ' + t.tagName.toLowerCase() +
        (t.id ? '#' + t.id : '') +
        (t.classList?.length ? '.' + [...t.classList].slice(0, 2).join('.') : '') +
        (rec.type === 'attributes' ? '[' + rec.attributeName + ']' : '');
    } else {
      sig = rec.type + ' ' + (t?.nodeName || '?');
    }
    tickTriggerStats.set(sig, (tickTriggerStats.get(sig) || 0) + 1);
  }

  function formatTickTriggers() {
    if (!tickTriggerStats.size) return '(brak zarejestrowanych wyzwalaczy)';
    return [...tickTriggerStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([sig, n]) => '  ' + String(n).padStart(6) + ' × ' + sig)
      .join('\n');
  }

  function buildLogText() {
    const now = Date.now();
    const bootAgo = ((now - SCRIPT_BOOT_AT) / 1000).toFixed(0);
    const tickAgo = uiLastTickAt ? ((now - uiLastTickAt) / 1000).toFixed(1) + 's temu' : 'jeszcze ani razu';
    const perTick = uiTickCount ? ((now - SCRIPT_BOOT_AT) / 1000 / uiTickCount).toFixed(2) : '—';
    return (
      'Wersja skryptu: ' + SCRIPT_VERSION + '\n' +
      'Adres strony: ' + location.href + '\n' +
      'Zrzut wykonany: ' + new Date(now).toLocaleString('pl-PL') + '\n' +
      'Skrypt wstrzyknięty: ' + new Date(SCRIPT_BOOT_AT).toLocaleTimeString('pl-PL') + ' (' + bootAgo + 's temu)\n' +
      'Ostatni uiTick(): ' + tickAgo + ' — łącznie ' + uiTickCount + ' ticków (średnio co ' + perTick + 's)\n' +
      'Wpisów w logu: ' + DEBUG_LOG.length + '\n' +
      'Mutacji odfiltrowanych jako szum: ' + szumOdfiltrowany + '\n' +
      'Co wyzwalało ticki (najczęstsze):\n' + formatTickTriggers() + '\n' +
      'Czas modułów (od wstrzyknięcia skryptu):\n' + formatModuleProfile() + '\n' +
      'Czas kroków w środku modułów:\n' + formatKrokProfile() + '\n\n' +
      (DEBUG_LOG.join('\n') || '(pusto)')
    );
  }

  GM_registerMenuCommand?.('Pokaż log debug (Serum)', () => {
    alert(buildLogText());
  });

  // Zapis do pliku — dużo wygodniejszy niż kopiowanie z okienka alert(),
  // a przy dłuższym logu w ogóle jedyny sensowny sposób.
  GM_registerMenuCommand?.('Zapisz log debug do pliku (Serum)', () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nazwa =
      'serum-log-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.txt';
    try {
      const blob = new Blob([buildLogText()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nazwa;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      alert('Nie udało się zapisać logu do pliku: ' + (e?.message || e));
    }
  });

  GM_registerMenuCommand?.('Wyczyść log debug (Serum)', () => {
    DEBUG_LOG.length = 0;
    try { sessionStorage.removeItem(DEBUG_LOG_KEY); } catch (_) {}
    dbg('log wyczyszczony ręcznie');
  });

  // --- WYNIKI OPERACJI ---

  // Okno siedzi zawsze w jednym z dwóch stałych kontenerów Serum, pokazywanych
  // klasą „show”. Logi 08–28.09.2026 (10 plików): 153 z 153 zamknięć poszło
  // pierwszym klikiem w button.popup-close kontenera, nagłówek .popup-header h1
  // to zawsze „Wyniki operacji”. W #ereferralFrame bywa też „Wydruk
  // potwierdzenia wysłania skierowania” — to obsługuje podgląd wydruku.
  // Dawne szukanie nagłówka po tekście i wspinaczka po przodkach aż do <body>
  // (tekst body: 9–10,5 mln znaków) kosztowały 200–630 ms przy KAŻDYM
  // pojawieniu się okna (15–31 „DŁUGI TICK” dziennie).
  const WYNIKI_KONTENERY = ['operationResultsPopup', 'ereferralFrame'];
  const WYNIKI_TYTUL_RE = /wyniki? operacji/i;

  // Przez wspólną listę pokazanych popupów (żywa lista klas) — strona jest
  // w trybie quirks (doctype HTML 4.0 bez adresu), a tam querySelector('#id')
  // nie korzysta z indeksu id i przechodzi cały dokument.
  function findWynikiFrame() {
    for (const frame of pokazanePopupy()) {
      if (!WYNIKI_KONTENERY.includes(frame.id)) continue;
      const h1 = frame.querySelector('.popup-header h1');
      if (h1 && WYNIKI_TYTUL_RE.test(h1.textContent)) return frame;
    }
    return null;
  }

  // „Identyfikator pakietu” jest inny przy każdym wystąpieniu okna recept
  // (potwierdzone logiem). Skierowania go nie mają — tam numer skierowania
  // + początek treści.
  function wynikiSignature(text) {
    const pakiet = text.match(/identyfikator\s*pakietu\D*(\d+)/i);
    if (pakiet) return 'pakiet:' + pakiet[1];
    const referralId = document.querySelector('input.referralId_main')?.value || '';
    return referralId + '|' + normLabel(text).slice(0, 80);
  }

  // Zamknięcie tego okna zwykle uruchamia w Serum odświeżenie leżącej pod spodem
  // listy (np. skierowań). Jeśli klikniemy „Zamknij” zbyt szybko, odświeżenie
  // czasem nie nadąża i lista dubluje wiersz zamiast zaktualizować status —
  // dlatego dajemy chwilę zwłoki zanim faktycznie klikniemy zamknięcie.
  const WYNIKI_CLOSE_DELAY_MS = 500;

  let wynikiHandledSignature = null;
  let wynikiNegatywnaFrame = null;

  function modWynikiOperacji() {
    const frame = findWynikiFrame();
    if (!frame) {
      wynikiHandledSignature = null;
      wynikiNegatywnaFrame = null;
      return;
    }

    const text = frame.textContent || '';
    // Weryfikacja negatywna (także częściowo, przy kilku receptach) zostaje na
    // ekranie do przeczytania — 21 takich okien w logach.
    if (normalize(text).includes('weryfikacja negatywna')) {
      if (wynikiNegatywnaFrame !== frame) dbg('modWynikiOperacji: weryfikacja negatywna — zostawiam okno #' + frame.id);
      wynikiNegatywnaFrame = frame;
      return;
    }

    const signature = wynikiSignature(text);
    if (wynikiHandledSignature === signature) return;
    wynikiHandledSignature = signature;
    dbg('modWynikiOperacji: #' + frame.id + ' — klik krzyżyka za ' + WYNIKI_CLOSE_DELAY_MS + 'ms');

    const ponow = (powod) => {
      dbg('modWynikiOperacji: ' + powod + ' — ponowię');
      if (wynikiHandledSignature === signature) wynikiHandledSignature = null;
      scheduleUi();
    };

    setTimeout(async () => {
      try {
        if (!frame.classList.contains('show')) return; // zamknięte w międzyczasie
        const btn = [...frame.querySelectorAll('button.popup-close')].find((b) => !b.disabled && isOverlayElementVisible(b));
        if (!btn) { ponow('brak widocznego button.popup-close'); return; }
        btn.click();
        await sleepMs(300);
        if (!frame.isConnected || !frame.classList.contains('show') || !isOverlayElementVisible(frame)) {
          dbg('modWynikiOperacji: zamknięto');
          return;
        }
        ponow('klik krzyżyka nie zamknął okna');
      } catch (e) {
        ponow('wyjątek ' + (e?.message || e));
      }
    }, WYNIKI_CLOSE_DELAY_MS);
  }
  // --- WYŚLIJ SMS ---

  let smsClicked = false;

  // Potwierdzone inspektorem:
  //   <span id="wysylkaSmsKodowDostepowychEdokumentow" class="h3_tytul">…</span>
  //   <a id="edokumenty_sms_wyslij" class="a_akc" href="#">Wyślij SMS</a>
  // Dawna bramka po tekście całego <body> (serializacja ~10 mln znaków)
  // i ścieżka awaryjna po tytule okna — usunięte, id wystarczają.
  const SMS_TITLE_ID = 'wysylkaSmsKodowDostepowychEdokumentow';
  const SMS_BUTTON_ID = 'edokumenty_sms_wyslij';

  function modWyslijSms() {
    if (!document.getElementById(SMS_TITLE_ID)) {
      smsClicked = false;
      return;
    }
    if (smsClicked) return;

    const btn = document.getElementById(SMS_BUTTON_ID);
    if (!isOverlayElementVisible(btn)) return;

    smsClicked = true;
    dbg('modWyslijSms: klik Wyślij SMS');
    btn.click();
  }
  // --- PODPISZ E-RECEPTĘ (PIN wpisany → klik „Podpisz”) ---

  let ereceptSigned = false;

  // getBoundingClientRect i getComputedStyle WYMUSZAJĄ synchroniczne
  // przeliczenie układu strony, jeśli cokolwiek od ostatniego przeliczenia
  // zmieniło DOM. W ciągu jednego ticka pytamy o widoczność tych samych
  // elementów wielokrotnie (kilka modułów + isOnTop), a między pytaniami
  // sami zapisujemy style — czyli klasyczne „zapis, odczyt, zapis, odczyt”,
  // gdzie każdy odczyt płaci za pełny reflow. Pamięć na czas JEDNEGO ticka
  // sprowadza to do jednego przeliczenia.
  // Uwaga: cache działa WYŁĄCZNIE wewnątrz uiTick() (visCache ustawiane tam i
  // od razu kasowane). Kod asynchroniczny — np. odpytywanie „PODGLĄD WYNIKÓW”
  // przy kopiowaniu badań — musi widzieć stan na żywo, więc poza tickiem
  // każde pytanie liczone jest od nowa.
  let visCache = null;

  function isOverlayElementVisible(el) {
    if (!el?.isConnected) return false;
    const zapamietane = visCache?.get(el);
    if (zapamietane !== undefined) return zapamietane;

    const rect = el.getBoundingClientRect();
    // Zerowy prostokąt i tak przesądza sprawę — nie ma po co pytać o styl.
    let widoczny = rect.width > 0 && rect.height > 0;
    if (widoczny) {
      const style = getComputedStyle(el);
      widoczny = style.visibility !== 'hidden' && style.display !== 'none';
    }
    visCache?.set(el, widoczny);
    return widoczny;
  }

  function findEreceptSignButton(pin) {
    let panel = pin.parentElement;
    for (let depth = 0; depth < 12 && panel; depth++) {
      const signBtn = [...panel.querySelectorAll('button.x-buttonSign, button, a, input[type="button"], input[type="submit"]')].find(
        (el) => normLabel(el.textContent || el.value) === 'Podpisz' && isOverlayElementVisible(el)
      );
      if (signBtn) return signBtn;
      panel = panel.parentElement;
    }
    return null;
  }

  // PIN do podpisu e-recepty/IPOM wpisywała dawniej przeglądarka (zapisane
  // hasło), ale Serum zmieniło pole na type="text" + autocomplete="off"
  // (kropki tylko przez CSS -webkit-text-security), więc menedżer haseł go
  // już nie wypełnia. Trzymamy go w pamięci Tampermonkeya, jak PIN do PUE —
  // pytamy raz, przy pierwszej potrzebie; zmiana przez menu.
  const KLUCZ_PODPIS_PIN = 'serum_podpis_pin';
  let podpisPinPytano = false;

  function zapytajOPodpisPin() {
    const wpisany = window.prompt('PIN do podpisu e-recept/IPOM (Serum) — zostanie zapamiętany w Tampermonkey:', '');
    if (wpisany == null) return '';
    const kod = wpisany.trim();
    if (!/^\d{4,}$/.test(kod)) {
      window.alert('PIN musi składać się z cyfr — nie zapisano.');
      return '';
    }
    GM_setValue(KLUCZ_PODPIS_PIN, kod);
    return kod;
  }

  function podpisPin() {
    const kod = GM_getValue(KLUCZ_PODPIS_PIN, '');
    if (kod) return kod;
    if (podpisPinPytano) return '';
    podpisPinPytano = true;
    return zapytajOPodpisPin();
  }

  GM_registerMenuCommand?.('Ustaw PIN do podpisu e-recept (Serum)', () => {
    if (zapytajOPodpisPin()) window.alert('Zapisano PIN do podpisu e-recept.');
  });

  // Wpisuje PIN raz na pojawienie się pola (WeakSet) i tylko do pustego —
  // jeśli ktoś go skasuje/poprawi ręcznie, nie nadpisujemy.
  const wypelnionePolaPin = new WeakSet();
  function wpiszPodpisPin(pin, modul) {
    if (wypelnionePolaPin.has(pin)) return;
    wypelnionePolaPin.add(pin);
    if (pin.value.trim()) return;
    const kod = podpisPin();
    if (!kod) {
      dbg(modul + ': brak zapisanego PIN-u do podpisu — wpisz ręcznie lub ustaw w menu');
      return;
    }
    pin.value = kod;
    pin.dispatchEvent(new Event('input', { bubbles: true }));
    pin.dispatchEvent(new Event('change', { bubbles: true }));
    dbg(modul + ': wpisano zapamiętany PIN');
  }

  function modPodpiszERecepte() {
    const pin = document.getElementById('eReceptaPin');
    if (!isOverlayElementVisible(pin)) {
      ereceptSigned = false;
      return;
    }
    if (ereceptSigned) return;
    wpiszPodpisPin(pin, 'modPodpiszERecepte');
    if (!/^\d{4,}$/.test(pin.value.trim())) return;

    const signBtn = findEreceptSignButton(pin);
    if (!signBtn || signBtn.disabled) return;

    ereceptSigned = true;
    dbg('modPodpiszERecepte: klik Podpisz');
    signBtn.click();
  }

  // --- PODPISZ IPOM (okno „IPOM - DOKUMENT”, PIN wpisany → klik „Podpisz”) ---
  // <div id="electronicIPOMPopup" class="popup-window show …"> … PIN: <input>
  // <button class="button x-buttonSign" type="button">Podpisz</button>

  let ipomSigned = false;
  let ipomBrakPinuZalogowany = false;

  function modPodpiszIpom() {
    const popup = document.getElementById('electronicIPOMPopup');
    if (!popup || !popup.classList.contains('show') || !isOverlayElementVisible(popup)) {
      ipomSigned = false;
      ipomBrakPinuZalogowany = false;
      return;
    }
    if (ipomSigned) return;

    const pin = [...popup.querySelectorAll('input[type="password"], input[id*="pin" i], input[name*="pin" i]')]
      .find((el) => isOverlayElementVisible(el));
    if (!pin) {
      if (!ipomBrakPinuZalogowany) dbg('modPodpiszIpom: brak widocznego pola PIN w #electronicIPOMPopup');
      ipomBrakPinuZalogowany = true;
      return;
    }
    wpiszPodpisPin(pin, 'modPodpiszIpom');
    if (!/^\d{4,}$/.test(pin.value.trim())) return;

    const signBtn = [...popup.querySelectorAll('button.x-buttonSign')].find(
      (el) => isOverlayElementVisible(el) && normLabel(el.textContent) === 'Podpisz'
    );
    if (!signBtn || signBtn.disabled) return;

    ipomSigned = true;
    dbg('modPodpiszIpom: klik Podpisz');
    signBtn.click();
  }

  // --- LOGOWANIE DO PUE (auto-PIN przy eZLA) ---

  // PIN nie siedzi w kodzie (skrypt jest w publicznym repozytorium) — trzymany
  // w pamięci Tampermonkeya. Pytamy o niego raz, przy pierwszej potrzebie;
  // zmiana przez menu „Ustaw PIN do PUE ZUS (Serum)”.
  const KLUCZ_PUE_PIN = 'serum_pue_pin';
  let puePinPytano = false;
  // Ustawiane, gdy serwer odrzuci logowanie (odpowiedź inna niż „OK”). Przy
  // złym PIN-ie każde kolejne okno byłoby kolejną nieudaną próbą — prosta
  // droga do blokady konta w PUE. Zdejmuje to zapisanie PIN-u z menu albo
  // przeładowanie strony.
  let pueAutoPinWstrzymany = false;

  function zapytajOPuePin() {
    const wpisany = window.prompt('PIN do PUE ZUS (Serum) — zostanie zapamiętany w Tampermonkey:', '');
    if (wpisany == null) return '';
    const kod = wpisany.trim();
    if (!/^\d{4,}$/.test(kod)) {
      window.alert('PIN musi składać się z cyfr — nie zapisano.');
      return '';
    }
    GM_setValue(KLUCZ_PUE_PIN, kod);
    pueAutoPinWstrzymany = false;
    return kod;
  }

  function puePin() {
    const kod = GM_getValue(KLUCZ_PUE_PIN, '');
    if (kod) return kod;
    if (puePinPytano) return '';
    puePinPytano = true;
    return zapytajOPuePin();
  }

  GM_registerMenuCommand?.('Ustaw PIN do PUE ZUS (Serum)', () => {
    if (zapytajOPuePin()) window.alert('Zapisano PIN do PUE ZUS.');
  });

  // --- EZLA: PIN i „Pobierz dane z ZUS” sterowane odpowiedziami serwera ---
  //
  // Kod Serum (funkcje strony zrzucone z konsoli 19.10.2026) rozstrzyga to,
  // co do 3.116.0 było wnioskowane z czasów w logu:
  //   fr_ezla_form(…, 'B')       → f_ezla_sprawdz_sesje('T')   [ap_zla.sprawdz_sesje]
  //   fr_ezla_sprawdz_sesje       → „OK”: Serum SAMO woła f_elza_pobierz_dane_z_zus(),
  //                                 inaczej f_ezla_zaloguj() → okno PIN
  //   f_ezla_zaloguj(txt)         → [ap_zla.zalogujzus_html] → okno PIN, o ile pola
  //                                 PIN nie ma w DOM (sprawdzane przed i po żądaniu)
  //   f_ezla_zaloguj2()           → uf_schowaj_div() — okno PIN znika OD RAZU, przed
  //                                 odpowiedzią — i dopiero [ap_zla.zalogujzus]
  //   fr_ezla_zaloguj2('OK')      → nic (wywołanie f_ezla_sprawdz_sesje zakomentowane)
  //   f_elza_pobierz_dane_z_zus() → 3–4 RÓWNOLEGŁE [ap_zla_zus.*]; każda odpowiedź
  //                                 „BLAD_SESJI” woła f_ezla_zaloguj('Błąd sesji')
  // Żądań ap_zla.* nie przejmuje serum2 (ser.handleSerum1AjaxRequest), więc
  // to zwykły XHR POST z uf_ajax — stąd podsłuch na XMLHttpRequest poniżej.
  //
  // Wnioski:
  //  1. Po zalogowaniu NIKT nie pobiera danych — robi to skrypt, od razu po
  //     odpowiedzi „OK” na ap_zla.zalogujzus. Dotąd czekał 8 s na „samodzielne
  //     dokończenie” przez Serum, którego nie ma; a liczył od zniknięcia okna
  //     PIN, które wcale nie oznacza zalogowania (uf_schowaj_div). Za wczesne
  //     ponowienie (28.09, 10:42) trafiało przed odpowiedź logowania →
  //     BLAD_SESJI → kolejne okno PIN.
  //  2. Przy otwarciu formularza z aktywną sesją Serum pobiera dane samo —
  //     własne wywołanie skryptu było dublem równoległych zapytań do ZUS,
  //     a przy wygasłej sesji mnożyło odpowiedzi BLAD_SESJI.
  //  3. Każde zapytanie eZLA w toku może jeszcze otworzyć NOWE okno PIN: po
  //     wysłaniu PIN-u pole znika, więc strażnik w f_ezla_zaloguj przepuszcza.
  //     PIN idzie więc, gdy nic z eZLA nie wisi — zamiast stałej pauzy
  //     (600 ms), która łapała to tylko statystycznie.
  //  4. Dane dotarły = odpowiedź pobierzDaneUbezpieczonego z KodBledu 0
  //     (tak samo sprawdza f_ezla_spr_odp), bez porównywania pól co tick.

  function podsluchEzlaXhr() {
    if (window.__serumEzlaXhr) return;
    window.__serumEzlaXhr = true;
    var proto = XMLHttpRequest.prototype;
    var open = proto.open;
    var send = proto.send;
    var RE = /(?:^|\/)(ap_zla(?:_zus)?\.\w+)/;
    function emit(d) {
      try {
        document.dispatchEvent(new CustomEvent('serum-ezla-xhr', { detail: JSON.stringify(d) }));
      } catch (e) {}
    }
    proto.open = function (method, url) {
      var m = RE.exec(String(url));
      this.__serumEzla = m ? m[1] : null;
      return open.apply(this, arguments);
    };
    proto.send = function () {
      var proc = this.__serumEzla;
      if (proc) {
        var xhr = this;
        var t0 = Date.now();
        emit({ faza: 'start', proc: proc });
        // loadend przychodzi po readystatechange, czyli już po callbacku Serum
        // (eval w uf_ajax) — okno PIN z fr_ezla_zaloguj jest wtedy w DOM.
        xhr.addEventListener('loadend', function () {
          var txt = '';
          var wynik;
          try { txt = xhr.responseText || ''; } catch (e) {}
          if (xhr.status !== 200) wynik = 'HTTP ' + xhr.status;
          else if (txt === 'OK' || txt === 'BLAD_SESJI') wynik = txt;
          else {
            var k = /<(?:\w+:)?KodBledu>\s*(-?\d+)/.exec(txt);
            wynik = k ? 'KodBledu ' + k[1] : 'inna odpowiedź';
          }
          emit({
            faza: 'koniec',
            proc: proc,
            ms: Date.now() - t0,
            wynik: wynik,
            tekst: proc === 'ap_zla.zalogujzus' && wynik !== 'OK' ? txt.slice(0, 160) : '',
          });
        });
      }
      return send.apply(this, arguments);
    };
  }

  wstrzyknijDoStrony(podsluchEzlaXhr);

  // Gdyby po zalogowaniu kolejne zapytania wciąż dostawały BLAD_SESJI, skrypt
  // nie kręci pętli PIN-ów: po tylu logowaniach z rzędu bez udanego pobrania
  // danych z ZUS okno PIN zostaje dla użytkownika.
  const PUE_LOGINY_Z_RZEDU_MAX = 2;
  // Górna granica czekania z PIN-em na zapytania eZLA w toku. Zwykła runda
  // BLAD_SESJI → okno PIN trwa ~0,3 s (log 28.09, 10:42); dłużej wiszą tylko
  // zapytania, na które ZUS nie odpowiada (16–19 s, logi 22.09 i 28.09) —
  // wtedy czekanie kosztuje więcej niż ewentualne drugie logowanie.
  const PUE_PIN_CZEKAJ_MAX_MS = 2000;

  const ezlaWToku = new Map(); // procedura → liczba żądań w toku
  let ezlaPodsluchDziala = false;
  let ezlaPodsluchMilczyLogged = false;
  let ezlaOknoPinLogged = null;
  let ezlaDaneZZus = false; // pobierzDaneUbezpieczonego z KodBledu 0 w bieżącym formularzu
  let ezlaPobierzPoZalogowaniu = false;
  let pueZalogowanoAt = 0;
  let pueLoginyZRzedu = 0;
  let puePinWyslanyDo = null; // jedna próba na jedno okno PIN
  let pueCzekaPole = null;
  let pueCzekaOd = 0;
  let pueCzekaTimer = null;
  let pueLimitLogged = null;

  function ezlaWTokuOpis() {
    let opis = '';
    for (const [proc, n] of ezlaWToku) {
      if (n > 0) opis += (opis ? ', ' : '') + proc + (n > 1 ? ' ×' + n : '');
    }
    return opis;
  }

  function ezlaPoOdpowiedzi(d) {
    const czas = ' (' + d.ms + ' ms)';
    switch (d.proc) {
      case 'ap_zla.form2':
        ezlaDaneZZus = false;
        ezlaPobierzPoZalogowaniu = false;
        pueLoginyZRzedu = 0;
        return;
      case 'ap_zla.sprawdz_sesje':
        dbg('eZLA: sesja PUE ' + (d.wynik === 'OK' ? 'aktywna — Serum samo pobiera dane z ZUS' : 'nieaktywna (' + d.wynik + ')') + czas);
        return;
      case 'ap_zla.zalogujzus_html': {
        const pin = document.getElementById('inp_ezla_logowanie_pin');
        if (pin) {
          // Kolejne odpowiedzi przy już otwartym oknie Serum pomija (strażnik
          // w fr_ezla_zaloguj) — w logu wystarczy pierwsza.
          if (pin !== ezlaOknoPinLogged) dbg('eZLA: okno PIN' + czas);
          ezlaOknoPinLogged = pin;
          return;
        }
        // Wg kodu Serum ta odpowiedź to zawsze okno PIN — jeśli go nie ma,
        // trzeba zobaczyć, co się pokazało zamiast niego.
        const okna = [...document.querySelectorAll('.przegladarka')].filter(isOverlayElementVisible);
        dbg('eZLA: po ap_zla.zalogujzus_html brak pola PIN — na wierzchu: „' +
          normLabel(okna[okna.length - 1]?.textContent).slice(0, 120) + '”' + czas);
        return;
      }
      case 'ap_zla.zalogujzus':
        if (d.wynik === 'OK') {
          pueZalogowanoAt = Date.now();
          ezlaPobierzPoZalogowaniu = true;
          dbg('eZLA: zalogowano do PUE' + czas);
        } else {
          pueAutoPinWstrzymany = true;
          dbg('eZLA: logowanie odrzucone — ' + d.wynik + ' „' + d.tekst + '”' + czas +
            '; auto-PIN wstrzymany do zapisania PIN-u z menu albo przeładowania strony');
        }
        return;
      case 'ap_zla_zus.pobierzDaneUbezpieczonego':
        if (d.wynik === 'KodBledu 0') {
          ezlaDaneZZus = true;
          pueLoginyZRzedu = 0;
        }
        dbg('eZLA: dane ubezpieczonego z ZUS — ' + d.wynik + czas);
        return;
    }
  }

  document.addEventListener('serum-ezla-xhr', (e) => {
    let d;
    try { d = JSON.parse(e.detail); } catch (_) { return; }
    ezlaPodsluchDziala = true;
    const n = ezlaWToku.get(d.proc) || 0;
    if (d.faza === 'start') {
      ezlaWToku.set(d.proc, n + 1);
      return;
    }
    ezlaWToku.set(d.proc, Math.max(0, n - 1));
    ezlaPoOdpowiedzi(d);
    // Poza zdarzeniem XHR — callback Serum ma się zakończyć, zanim ruszymy DOM.
    setTimeout(modEzlaPue, 0);
  });

  // Krzyżyk okna Serum — używany też przez modProceduryDodatkowe (słownik).
  function findPueCloseButton(root) {
    // Najpewniejszy sygnał — natywne klasy Serum dla krzyżyka. Dotąd ta
    // funkcja szukała WYŁĄCZNIE po tekście „×” (U+00D7) lub litery „x”, przez
    // co nie widziała ani wariantu „✕” (U+2715), ani krzyżyka rysowanego tłem
    // CSS (button.popup-close — element bez żadnego tekstu).
    const byClass = root.querySelector(
      'button.popup-close, a.popup-close, button.x-buttonClose, a.x-buttonClose, div.div_close'
    );
    if (isOverlayElementVisible(byClass)) return byClass;

    // Tekstowy krzyżyk — tani test treści PRZED sprawdzaniem widoczności
    // (to drugie wymusza przeliczenie układu strony).
    for (const el of root.querySelectorAll('a, span, div, button')) {
      const text = normLabel(el.textContent);
      if (text !== '×' && text !== '✕' && text !== '✖' && text.toLowerCase() !== 'x') continue;
      if (!isOverlayElementVisible(el)) continue;
      return el;
    }
    return null;
  }

  function submitPueLogin(pin, kod) {
    pin.value = kod;
    pin.dispatchEvent(new Event('input', { bubbles: true }));
    pin.dispatchEvent(new Event('change', { bubbles: true }));
    // Pole PIN bywa (po focusie) rozpoznawane przez przeglądarkę jako pole
    // logowania i dostaje własną podpowiedź zapisanych haseł — to natywny
    // dropdown przeglądarki (poza DOM-em strony), który nie znika sam po
    // zamknięciu okienka PUE. Realne odjęcie fokusu z pola zamyka tę
    // podpowiedź, zanim klikniemy Zaloguj.
    pin.blur();

    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof uw.f_ezla_zaloguj2 === 'function') {
      try {
        uw.f_ezla_zaloguj2();
        dbg('eZLA: PIN wpisany, f_ezla_zaloguj2()');
        return;
      } catch (e) {
        dbg('eZLA: błąd f_ezla_zaloguj2(): ' + e);
      }
    }

    let panel = pin.parentElement;
    for (let depth = 0; depth < 12 && panel; depth++) {
      const btn = [...panel.querySelectorAll('button, input[type="button"], input[type="submit"], a')].find(
        (el) => normLabel(el.textContent || el.value) === 'Zaloguj' && isOverlayElementVisible(el)
      );
      if (btn) {
        dbg('eZLA: PIN wpisany, klik Zaloguj');
        btn.click();
        return;
      }
      panel = panel.parentElement;
    }
    dbg('eZLA: PIN wpisany, ale nie znaleziono sposobu zalogowania');
  }

  function pueSprobujPin() {
    const pin = document.getElementById('inp_ezla_logowanie_pin');
    if (!pin || pin === puePinWyslanyDo || pueAutoPinWstrzymany || !isOverlayElementVisible(pin)) return;

    if (!ezlaPodsluchDziala && !ezlaPodsluchMilczyLogged) {
      ezlaPodsluchMilczyLogged = true;
      dbg('eZLA: okno PIN, a podsłuch XHR nie zgłosił żadnego żądania — po zalogowaniu dane z ZUS trzeba będzie pobrać ręcznie');
    }

    if (pueLoginyZRzedu >= PUE_LOGINY_Z_RZEDU_MAX) {
      if (pueLimitLogged !== pin) {
        pueLimitLogged = pin;
        dbg('eZLA: ' + pueLoginyZRzedu + ' logowania z rzędu bez danych z ZUS — PIN zostawiam do wpisania ręcznie');
      }
      return;
    }

    const wToku = ezlaWTokuOpis();
    if (wToku) {
      if (pueCzekaPole !== pin) {
        pueCzekaPole = pin;
        pueCzekaOd = Date.now();
      }
      const zostalo = pueCzekaOd + PUE_PIN_CZEKAJ_MAX_MS - Date.now();
      if (zostalo > 0) {
        // Koniec każdego z tych żądań i tak wywoła nas ponownie — timer to
        // tylko górna granica czekania.
        clearTimeout(pueCzekaTimer);
        pueCzekaTimer = setTimeout(modEzlaPue, zostalo + 10);
        return;
      }
      dbg('eZLA: po ' + PUE_PIN_CZEKAJ_MAX_MS + ' ms wciąż w toku: ' + wToku + ' — wysyłam PIN mimo to');
    }
    clearTimeout(pueCzekaTimer);

    puePinWyslanyDo = pin;
    const kod = puePin();
    if (!kod) {
      dbg('eZLA: brak zapisanego PIN-u do PUE — wpisz ręcznie lub ustaw w menu');
      return;
    }
    pueLoginyZRzedu++;
    submitPueLogin(pin, kod);
  }

  function ezlaPobierzPoZalogowaniuJesliTrzeba() {
    if (!ezlaPobierzPoZalogowaniu) return;
    // Bez formularza w trybie bieżącym f_elza_pobierz_dane_z_zus() i tak nic
    // nie robi (f_ezla_czy_tryb_biez), a dane mogły już przyjść.
    if (ezlaDaneZZus || document.getElementById('hid_ezla_tryb')?.value !== 'B') {
      ezlaPobierzPoZalogowaniu = false;
      return;
    }
    // Coś z eZLA wciąż w toku (spóźnione zapytanie sprzed logowania, kolejne
    // okno PIN w drodze) albo trwa następna runda PIN-u — równoległe
    // pobranie to dokładnie ten dubel, który kończył się „Błędem sesji”.
    // Czekamy; koniec każdego żądania wywoła nas ponownie.
    if (ezlaWTokuOpis() || isOverlayElementVisible(document.getElementById('inp_ezla_logowanie_pin'))) return;

    ezlaPobierzPoZalogowaniu = false;
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof uw.f_elza_pobierz_dane_z_zus !== 'function') {
      dbg('eZLA: brak funkcji f_elza_pobierz_dane_z_zus — nie pobieram');
      return;
    }
    uw.f_elza_pobierz_dane_z_zus();
    dbg('eZLA: wywołano f_elza_pobierz_dane_z_zus() ' + (Date.now() - pueZalogowanoAt) + ' ms po zalogowaniu');
  }

  // Wołane po każdej odpowiedzi eZLA oraz z uiTick() — w ticku to dwa tanie
  // sprawdzenia (getElementById i flaga), siatka na zmiany bez żądań XHR
  // (np. ręczne zamknięcie okna PIN).
  function modEzlaPue() {
    pueSprobujPin();
    ezlaPobierzPoZalogowaniuJesliTrzeba();
  }

  // --- ZLA: auto-PIN przy „Podpisz i wyślij do ZUS” ---

  let ezlaPodpisDone = false;

  function findEzlaPodpisPin() {
    // Strona potrafi zdublować ten wiersz (dwa nałożone okienka PIN w DOM) —
    // bierzemy pierwszy faktycznie widoczny.
    for (const el of wszystkieZId('inp_ezla_podpis_pin')) {
      if (isOverlayElementVisible(el)) return el;
    }
    return null;
  }

  function findEzlaPodpisButton(pin) {
    let panel = pin.parentElement;
    for (let depth = 0; depth < 12 && panel; depth++) {
      const btn = [...panel.querySelectorAll('a, button, input[type="button"], input[type="submit"]')].find(
        (el) => normLabel(el.textContent || el.value) === 'Podpisz i wyślij do ZUS' && isOverlayElementVisible(el)
      );
      if (btn) return btn;
      panel = panel.parentElement;
    }
    return null;
  }

  function modEzlaPodpis() {
    const pin = findEzlaPodpisPin();
    if (!pin) {
      ezlaPodpisDone = false;
      return;
    }
    if (ezlaPodpisDone) return;
    ezlaPodpisDone = true;

    const kod = puePin();
    if (!kod) {
      dbg('modEzlaPodpis: brak zapisanego PIN-u do PUE — wpisz ręcznie lub ustaw w menu');
      return;
    }
    pin.value = kod;
    pin.dispatchEvent(new Event('input', { bubbles: true }));
    pin.dispatchEvent(new Event('change', { bubbles: true }));
    // Jak przy logowaniu do PUE — realne odjęcie fokusu, żeby ewentualna
    // podpowiedź zapisanych haseł przeglądarki nie została na ekranie.
    pin.blur();

    const btn = findEzlaPodpisButton(pin);
    if (btn) {
      dbg('modEzlaPodpis: PIN wpisany, klik Podpisz i wyślij do ZUS');
      btn.click();
    } else {
      dbg('modEzlaPodpis: PIN wpisany, ale nie znaleziono przycisku Podpisz i wyślij do ZUS');
    }
  }

  // --- EZLA: OSTRZEŻENIE „Przerwa między zwolnieniami” — auto Wyślij ---

  // Scelowo NIE łapiemy każdego okna „OSTRZEŻENIE” — tylko ten konkretny
  // wariant (przerwa między zwolnieniami), zidentyfikowany po treści i po
  // linku z onclick="...f_ezla_nadajserienr(...)" (patrz inspektor: <a
  // id="a_akc" onclick="uf_schowaj_div();f_ezla_nadajserienr(...)">Wyślij</a>).
  // Inne, nieznane jeszcze warianty „OSTRZEŻENIE” mogą wymagać realnej
  // decyzji użytkownika, więc lepiej ich nie dotykać.
  // Kolejność: najpierw link (selektor po onclick), a tekst strony dopiero,
  // gdy widoczny link istnieje — dawniej tekst całego <body> był bramką
  // na KAŻDYM ticku.
  const EZLA_OSTRZEZENIE_TEXT = 'przerwa między zwolnieniami';
  let ezlaOstrzezenieClicked = false;

  function findEzlaOstrzezenieWyslij() {
    for (const el of document.querySelectorAll('[onclick*="f_ezla_nadajserienr"]')) {
      if (el.tagName !== 'A' && el.tagName !== 'BUTTON') continue;
      if (normLabel(el.textContent) !== 'Wyślij') continue;
      if (!isOverlayElementVisible(el)) continue;
      return el;
    }
    return null;
  }

  function modEzlaOstrzezenieWyslij() {
    const btn = findEzlaOstrzezenieWyslij();
    if (!btn) {
      ezlaOstrzezenieClicked = false;
      return;
    }
    if (ezlaOstrzezenieClicked) return;
    ezlaOstrzezenieClicked = true;
    if (!(document.body.textContent || '').toLowerCase().includes(EZLA_OSTRZEZENIE_TEXT)) return;

    dbg('modEzlaOstrzezenieWyslij: klik Wyślij (OSTRZEŻENIE — przerwa między zwolnieniami)');
    btn.click();
  }
  // --- POWÓD EDYCJI (auto „X” + Zapisz) ---

  const POWOD_EDYCJI_LABEL = 'Powód edycji';
  const POWOD_EDYCJI_VALUE = 'X';
  let powodEdycjiDone = false;

  // Potwierdzone inspektorem:
  //   <span id="powodEdycji" class="h3_tytul">POWÓD EDYCJI</span>
  //   <a class="a_akc" href="javascript:f_repo_powod_zapisz();">Zapisz</a>
  // Okna Serum tego typu to div.przegladarka z nagłówkiem span.h3_tytul o
  // stałym id — stąd zamiast szukania tytułu w tekście wszystkich
  // div/span/h1..td wystarczy getElementById i wspięcie się do kontenera okna.
  const POWOD_EDYCJI_TITLE_ID = 'powodEdycji';

  function findPowodEdycjiRoot(titleEl) {
    return titleEl.closest('.przegladarka') || titleEl.closest('div, table, form, fieldset');
  }

  function findPowodEdycjiField(root) {
    const target = POWOD_EDYCJI_LABEL.toLowerCase();
    for (const node of root.querySelectorAll('label, span, td, th, legend')) {
      const label = normLabel(node.textContent).replace(/:$/, '').toLowerCase();
      if (label !== target) continue;

      if (node.htmlFor) {
        const linked = document.getElementById(node.htmlFor);
        if (isOverlayElementVisible(linked)) return linked;
      }

      const nested = node.parentElement?.querySelector('input, textarea');
      if (isOverlayElementVisible(nested)) return nested;

      let sibling = node.nextElementSibling;
      for (let i = 0; i < 4 && sibling; i++) {
        if (sibling.matches?.('input, textarea') && isOverlayElementVisible(sibling)) return sibling;
        const inNested = sibling.querySelector?.('input, textarea');
        if (isOverlayElementVisible(inNested)) return inNested;
        sibling = sibling.nextElementSibling;
      }
    }

    const candidates = [...root.querySelectorAll('input[type="text"], textarea')].filter(isOverlayElementVisible);
    return candidates.length === 1 ? candidates[0] : null;
  }

  function setPowodEdycjiValue(field, value) {
    const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findPowodEdycjiSaveButton(root) {
    // Dopasowanie po funkcji strony w href jest pewniejsze niż po samym
    // tekście „Zapisz” — takich przycisków bywa na stronie kilka.
    const byHref = root.querySelector('a[href*="f_repo_powod_zapisz"]');
    if (isOverlayElementVisible(byHref)) return byHref;

    for (const el of root.querySelectorAll('button, input[type="button"], input[type="submit"], a')) {
      if (normLabel(el.textContent || el.value) !== 'Zapisz') continue;
      if (!isOverlayElementVisible(el)) continue;
      return el;
    }
    return null;
  }

  function modPowodEdycji() {
    const titleEl = document.getElementById(POWOD_EDYCJI_TITLE_ID);
    if (!titleEl) {
      powodEdycjiDone = false;
      return;
    }
    if (powodEdycjiDone) return;

    const root = findPowodEdycjiRoot(titleEl);
    if (!root) return;

    const field = findPowodEdycjiField(root);
    if (!field) return;

    if (normLabel(field.value) !== POWOD_EDYCJI_VALUE) {
      setPowodEdycjiValue(field, POWOD_EDYCJI_VALUE);
    }

    const btn = findPowodEdycjiSaveButton(root);
    if (!btn) return;

    powodEdycjiDone = true;
    dbg('modPowodEdycji: klik Zapisz');
    btn.click();
  }

  // --- TOAST (współdzielony: „Wysłano SMS”, „Wklejono wyniki”...) ---

  let toastTimer = null;

  function showToast(message, options) {
    const opts = options || {};
    clearTimeout(toastTimer);
    document.getElementById('serum-ui-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'serum-ui-toast';
    toast.textContent = message;

    const small = !!opts.anchorRect;
    Object.assign(toast.style, {
      position: 'fixed',
      zIndex: '2147483647',
      padding: small ? '4px 9px' : '12px 20px',
      background: '#2e7d32',
      color: '#fff',
      borderRadius: small ? '5px' : '8px',
      boxShadow: '0 4px 14px rgba(0,0,0,.35)',
      font: small ? '600 11px/1.3 system-ui, -apple-system, sans-serif' : '600 14px/1.4 system-ui, -apple-system, sans-serif',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity .2s ease',
    });

    if (opts.anchorRect) {
      const r = opts.anchorRect;
      toast.style.left = Math.round(r.left) + 'px';
      toast.style.top = Math.round(r.bottom + 4) + 'px';
    } else {
      toast.style.right = '24px';
      toast.style.bottom = '24px';
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    const duration = opts.durationMs ?? 10_000;
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  function showSmsToast() {
    showToast('Wysłano SMS');
  }

  function bootSmsToast() {
    // Zdarzenie „serum-sms-sent” zgłasza moduł dialogów (dialogiStrony,
    // kontekst strony) po przechwyceniu „Wysłano sms o treści…”.
    document.addEventListener('serum-sms-sent', showSmsToast, false);
  }

  // --- PODPIS ELEKTRONICZNY (CDA): PIN zapamiętany przez przeglądarkę → klik „Podpisz” ---

  // Potwierdzone inspektorem w panelu „PODPIS ELEKTRONICZNY”:
  //   <input id="inp_cda_pin" class="cda_podpis naprawione" type="password" …>
  //   <input id="chkb_cda_pin_zap" type="checkbox">  + <label for="chkb_cda_pin_zap">Zapamiętaj</label>
  //   <a class="a_akc cda_podpis" onclick="f_cda_podpis(…)">Podpisz</a>
  //   <a class="a_akc" onclick="f_cda_zamknij(…)">Zamknij</a>
  // Logi 08–28.09.2026: 184 z 184 automatycznych podpisów poszło tą ścieżką
  // (panel w logu bez tytułu = panel z a.cda_podpis). Dawna heurystyka —
  // tytuł w tekście całego <body> i ramek iframe, przyciski „Podpisz” szukane
  // po tekście wśród wszystkich div/span/td, osobne obserwatory mutacji na
  // ramkach — nie zadziałała ani razu, a kosztowała ~2,8 ms na tick
  // (dawne moduły podpisRun + podpisAttachAll, log 28.09).
  let clickedPodpis = false;

  function isPodpisVisible(el) {
    if (!el?.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    return el.offsetParent !== null || style.position === 'fixed';
  }

  function fieldHasValue(input) {
    if (!input) return false;
    if ((input.value || '').length > 0) return true;
    try {
      if (input.matches(':-webkit-autofill')) return true;
    } catch (_) {}
    const attr = input.getAttribute('value');
    return !!(attr && attr.length > 0);
  }

  function modPodpisElektroniczny() {
    const pin = document.getElementById('inp_cda_pin');
    if (!pin) {
      clickedPodpis = false;
      return;
    }
    if (clickedPodpis || !isPodpisVisible(pin) || !fieldHasValue(pin)) return;
    if (!document.getElementById('chkb_cda_pin_zap')?.checked) return;

    // Klasa cda_podpis odróżnia „Podpisz” od sąsiedniego „Zamknij”
    // (oba mają klasę a_akc i identyczny wygląd).
    const signBtn = [...document.querySelectorAll('a.cda_podpis, a[onclick*="f_cda_podpis"]')].find(isPodpisVisible);
    if (!signBtn) return;

    clickedPodpis = true;
    const panel = signBtn.closest('table, form, div') || signBtn.parentElement;
    dbg('modPodpisElektroniczny: klik Podpisz, panel="' + normLabel(panel?.textContent).slice(0, 80) + '"');
    try { signBtn.focus?.(); } catch (_) {}
    signBtn.click();
  }
  // --- LUX MED / MEDICOVER ---

  // Ubezpieczyciele/abonamenty, przy których świadczenia NIE zapisujemy do NFZ.
  // „Compensa” po rdzeniu (\bcompens) — łapie odmiany: Compensy, Compensie,
  // Compensą. Polska „kompensacja” pisze się przez k, więc nie koliduje.
  const TRIGGER_RES = [/lux\s*[- ]?\s*med|luxmed/i, /enel\s*[- ]?\s*med|enelmed/i, /\bpzu\b/i, /\bprywatna\b/i, /medicover/i, /200\s*zł/i, /polmed/i, /\bcompens/i];
  const luxCache = { uwagi: null, checkbox: null };
  let luxDone = false;

  // Potwierdzone inspektorem w panelu „Edycja wizyty”:
  //   <input id="wize_uwagi_term_w" class="t_bord disabled_reczny" name="wize"
  //          type="text" readonly …>            (Uwagi z Terminarza)
  //   <input id="chk_zapisz_poz" type="checkbox" checked="checked">
  //                                              (Czy zapisać świadczenie)
  // Dawne ścieżki awaryjne (przemiatanie wszystkich label/th/td/span/legend
  // po tekście etykiety) i bramka po tekście całego <body> („uwagi z
  // terminarza” + „czy zapisać świadczenie”) — usunięte: obie etykiety stoją
  // przy tych właśnie polach, więc pola istnieją dokładnie wtedy, gdy panel.
  function findUwagiZTerminarza() {
    return document.getElementById('wize_uwagi_term_w');
  }

  function findZapiszSwiadczenieCheckbox() {
    const cb = document.getElementById('chk_zapisz_poz');
    return cb?.type === 'checkbox' ? cb : null;
  }

  function panelWizytyOtwarty() {
    return !!findUwagiZTerminarza() && !!document.getElementById('chk_zapisz_poz');
  }

  function modLuxMed() {
    if (!panelWizytyOtwarty()) {
      // Panel „Edycja wizyty” zamknięty (albo jeszcze niewidoczny) — reset, żeby
      // przy następnej wizycie (ten sam pacjent lub inny — strona nie przeładowuje
      // się między wizytami) automatyzacja zadziałała od nowa. Bez tego luxDone
      // zostawało „true” raz na całą sesję przeglądarki (ten sam bug co dawniej
      // icd9AutoDone) i „pzu” w kolejnych uwagach było już ignorowane.
      luxDone = false;
      luxCache.uwagi = null;
      luxCache.checkbox = null;
      return;
    }
    if (luxDone) return;

    if (!luxCache.uwagi?.isConnected) luxCache.uwagi = findUwagiZTerminarza();
    const uwagi = luxCache.uwagi;
    if (!uwagi) return;

    const text = uwagi.value ?? uwagi.textContent ?? '';
    if (!TRIGGER_RES.some((re) => re.test(text))) return;

    if (!luxCache.checkbox?.isConnected) luxCache.checkbox = findZapiszSwiadczenieCheckbox();
    const cb = luxCache.checkbox;
    if (!cb?.checked) return;

    cb.checked = false;
    dbg('modLuxMed: odznaczono „Czy zapisać świadczenie”');
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    cb.dispatchEvent(new Event('input', { bubbles: true }));
    luxDone = true;
  }

  // --- ICD-9: auto-wpisanie kodu na podstawie „Uwagi z terminarza” ---

  const ICD9_CODE_OSOBA = '89.00';
  const ICD9_CODE_TELE = '89.0099';
  const ICD9_TRIGGER_TELE = [/tele/i, /teleporada/i, /rec/i];
  const ICD9_TRIGGER_OSOBA = [/osob/i, /wizyta/i, /polmed/i];
  // Logi 08–17.09.2026: 49 wyzwoleń wyszukiwania, 41 × „rezygnuję po 5000ms”,
  // 0 × udany wybór. Wyszukiwanie to zapytanie AJAX do Serum — przy wolnym
  // serwerze 5 s nie wystarcza, a dawny kod po jednym niepowodzeniu oznaczał
  // wizytę jako załatwioną i nigdy nie próbował ponownie. Teraz: dłuższy
  // limit na próbę, kilka prób (ponowne wywołanie wyszukiwania), a rezygnacja
  // dopiero po wszystkich — z opisem stanu listy podpowiedzi, żeby następny
  // log mówił DLACZEGO (lista pusta? ukryta? inny format wierszy?).
  const ICD9_PENDING_TIMEOUT_MS = 8000;
  const ICD9_MAX_PROB = 3;
  // Gdy moduł był wyciszony (okno recept), zegar próby liczy się od wznowienia
  // (patrz uiTick) — inaczej po powrocie z recept od razu wpadalibyśmy
  // w „minęło 8 s — rezygnuję”.

  let icd9AutoDone = false;
  let icd9AutoPending = null;
  let icd9AutoPendingSince = 0;
  let icd9AutoProba = 0;

  function opiszListePodpowiedziIcd9(input) {
    const { tabele, kontenery } = icd9ElementyListy();
    const table = tabele.find((t) => (t.innerHTML || '').trim() !== '') || tabele[0];
    if (!table) return 'tabela podpowiedzi: BRAK w DOM (kontenerów: ' + kontenery.length + ')';
    const tds = [...table.querySelectorAll('td')];
    const probki = tds.slice(0, 3).map((td) => '„' + normLabel(td.textContent).slice(0, 40) + '”').join(', ');
    return 'tabela podpowiedzi: display=' + (table.style.display || '(puste)') +
      ' widoczna=' + isOverlayElementVisible(table) +
      ' html=' + (table.innerHTML || '').length + 'zn.' +
      ' td=' + tds.length + (tds.length ? ' [' + probki + (tds.length > 3 ? ', …' : '') + ']' : '') +
      ' | pole=„' + (input?.value || '') + '”' +
      ' | aktywny=' + (document.activeElement?.tagName || '?') +
      (document.activeElement?.id ? '#' + document.activeElement.id : '');
  }
  const icd9Cache = { uwagi: null };

  function determineIcd9Target(text) {
    // „tele”/„rec” sprawdzamy pierwsze — „wizyta” jest na tyle ogólne, że może
    // wystąpić też w uwagach o teleporadzie/recepcie.
    if (ICD9_TRIGGER_TELE.some((re) => re.test(text))) return ICD9_CODE_TELE;
    if (ICD9_TRIGGER_OSOBA.some((re) => re.test(text))) return ICD9_CODE_OSOBA;
    return null;
  }

  // Wizyta receptowa bywa rozpoznawalna nie po uwagach z terminarza, tylko po
  // szablonowym zdaniu w pierwszej linijce pola WYWIAD. Wymagamy pełnej frazy
  // z „pisemny wniosek…”, żeby ręczne „Pacjent prosi o leki przeciwbólowe”
  // nie wyzwoliło kodu przypadkiem.
  const ICD9_WYWIAD_WNIOSEK_RE = /^pacjent prosi o leki.*pisemny wniosek o wypisanie recept/i;

  function wywiadMaWniosekOLeki() {
    // Pole WYWIAD po id (jak w modWywiadFokusStart) — dawniej przelot po
    // wszystkich textarea strony na każdym ticku, dopóki uwagi nie dawały kodu.
    const ta = document.getElementById('wizb_wywiad_w');
    if (!ta?.value || !isOverlayElementVisible(ta)) return false;
    return ICD9_WYWIAD_WNIOSEK_RE.test(ta.value.split('\n', 1)[0].trim());
  }

  function icd9AlreadyAdded(code) {
    return [...document.querySelectorAll('td[name="icd9_kod"]')].some((td) => normLabel(td.textContent) === code);
  }

  function findIcd9SearchInput() {
    const el = document.getElementById('inp_uni_icd9_szybkie_t');
    return isOverlayElementVisible(el) ? el : null;
  }

  function findIcd9SuggestionRow(code) {
    for (const table of icd9ElementyListy().tabele) {
      for (const td of table.querySelectorAll('td')) {
        const label = normLabel((td.textContent || '').split(' - ')[0]);
        if (label === code) return td;
      }
    }
    return null;
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // Wyrażenie wyszukiwania podpowiedzi wyciągane z atrybutu onkeydown pola
  // (inspektor 18.09.2026):
  //   onkeydown="f_klawisz(event,'inp_uni_icd9_szybkie',
  //              'f_uni_icd9_wyszukaj_…(jQ(\'#inp_uni_icd9_szybkie_t\').val(),g_data_od,g_data_do)')"
  // Trzeci argument f_klawisz to kod JS, który strona sama wykonuje po
  // naciśnięciu klawisza — i to ON tworzy listę podpowiedzi. Bierzemy go
  // dosłownie z atrybutu, więc nie zależymy od nazwy funkcji ani parametrów.
  function wyrazeniePodpowiedziIcd9(input) {
    const attr = input?.getAttribute?.('onkeydown') || '';
    // Trzeci argument bywa w apostrofach ALBO w cudzysłowie — log z 18.09.2026:
    //   f_klawisz(event,'inp_uni_icd9_szybkie',"f_uni_icd9_wyszukaj_kody(jQ('#…_t').val(),g_data_od,g_data_do)")
    const m = attr.match(/f_klawisz\(\s*event\s*,\s*'[^']*'\s*,\s*(['"])(.*)\1\s*\)\s*;?\s*$/);
    if (!m) return null;
    return m[2].replace(/\\(['"])/g, '$1');
  }

  let icd9WyrazenieLogged = false;

  function triggerIcd9Search(code, input) {
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // Ścieżka 1 (od 3.103.0): dokładnie to, co robi klawisz użytkownika.
    // Do 18.09.2026 wołaliśmy funkcję z onblur (f_uni_icd9_wyszukaj_kody z
    // parametrami '0','pole_icd9') — ta ma inne zadanie i NIGDY nie tworzy
    // tabeli podpowiedzi; stąd 0 udanych wyborów i „tabela: BRAK w DOM” w
    // każdej próbie (logi 08–18.09).
    const wyrazenie = wyrazeniePodpowiedziIcd9(input);
    if (wyrazenie) {
      try {
        // Jak mysz + fokus użytkownika: inicjalizacja widżetu i pokazanie
        // kontenera listy (onmouseover/onfocus pola).
        try { if (typeof uw.f_podpowiadanie_init === 'function') uw.f_podpowiadanie_init(); } catch (_) {}
        jakoAutomatIcd9(() => {
          input.focus({ preventScroll: true });
          input.value = code;
          uw.eval(wyrazenie);
        });
        if (!icd9WyrazenieLogged) {
          icd9WyrazenieLogged = true;
          dbg('modIcd9Auto: wyszukiwanie podpowiedzi wyrażeniem z onkeydown: ' + wyrazenie.slice(0, 120));
        } else {
          dbg('modIcd9Auto: wyzwolono wyszukiwanie podpowiedzi (ścieżka klawisza) dla ' + code);
        }
        return true;
      } catch (e) {
        dbg('modIcd9Auto: błąd wyrażenia z onkeydown: ' + (e?.message || e) + ' — próbuję ścieżki onblur');
      }
    } else {
      dbg('modIcd9Auto: nie znalazłem wyrażenia f_klawisz w onkeydown pola (atrybut: „' +
        (input?.getAttribute?.('onkeydown') || '').slice(0, 100) + '”) — ścieżka onblur');
    }

    // Ścieżka 2 (dawna): funkcja z onblur, wprost, z pominięciem jej warunku
    // (jQ(...).length==0 bywa fałszywe po śmieciach z poprzedniego szukania).
    if (typeof uw.f_uni_icd9_wyszukaj_kody !== 'function') return false;
    try {
      uw.f_uni_icd9_wyszukaj_kody(code, '' + uw.g_data_od + '', '' + uw.g_data_do + '', '0', 'pole_icd9');
      dbg('modIcd9Auto: wywołano f_uni_icd9_wyszukaj_kody(' + code + ')');
      return true;
    } catch (e) {
      dbg('modIcd9Auto: błąd wywołania f_uni_icd9_wyszukaj_kody: ' + e);
      return false;
    }
  }


  // Po wyborze kodu lista podpowiedzi zostaje rozwinięta. Strona sama chowa
  // ją przez opróżnienie listy (onblur sprawdza, czy w DOM nie zostały
  // elementy podpowiedzi), więc robimy to samo: usuwamy zawartość i chowamy
  // tabelę. Przed kolejnym wyszukiwaniem modIcd9Auto odsłania ją z powrotem.
  // Zwraca true, jeśli faktycznie było co chować.
  // Kiedy lekarz ostatnio SAM używał pola ICD-9 (klawisz/wpis/fokus) i kiedy
  // MY ostatnio zakończyliśmy automat (wybór albo rezygnacja). Chowanie listy
  // jest uzasadnione tylko krótko po NASZEJ akcji; po ręcznym użyciu pola
  // lista należy do lekarza. Zrzut z 18.09.2026: po rezygnacji automatu
  // gałąź „załatwione” chowała listę na każdym ticku i kasowała ręczne
  // podpowiedzi 400 ms po ich pojawieniu się — lekarz widział pusty,
  // niebieski prostokąt.
  let icd9ReczneUzycieAt = 0;
  let icd9AutomatZakonczonyAt = 0;
  const ICD9_CHOWAJ_PO_AUTOMACIE_MS = 10_000;
  const ICD9_RECZNE_CHRONI_MS = 120_000;
  let icd9PoleNasluchiwane = null;

  let icd9FokusZAutomatu = false;

  // KAŻDE nasze syntetyczne zdarzenie na polu ICD-9 (focus, input, Enter,
  // blur) musi iść przez tę otoczkę — inaczej pilnujRecznegoUzyciaIcd9 bierze
  // je za ręczną pracę lekarza i blokuje chowanie listy na 2 minuty. Tak
  // właśnie było 18.09.2026 (log 12:28): „schowano listę” w logu, lista na
  // ekranie, a linii „chowam listę — kontenerów…” brak, bo
  // wolnoChowacListeIcd9() odrzucało każde wywołanie.
  function jakoAutomatIcd9(fn) {
    const poprzedni = icd9FokusZAutomatu;
    icd9FokusZAutomatu = true;
    try { return fn(); } finally { icd9FokusZAutomatu = poprzedni; }
  }

  function pilnujRecznegoUzyciaIcd9(input) {
    if (!input || icd9PoleNasluchiwane === input) return;
    icd9PoleNasluchiwane = input;
    // Zdarzenia wywołane NASZYM input.focus()/value= (triggerIcd9Search) nie
    // są ręcznym użyciem — inaczej automat sam blokowałby sobie sprzątanie
    // listy po wyborze kodu.
    const odnotuj = () => { if (!icd9FokusZAutomatu) icd9ReczneUzycieAt = Date.now(); };
    for (const typ of ['keydown', 'input', 'focus', 'click']) input.addEventListener(typ, odnotuj, true);
  }

  function wolnoChowacListeIcd9() {
    const teraz = Date.now();
    if (teraz - icd9ReczneUzycieAt < ICD9_RECZNE_CHRONI_MS) return false;
    if (teraz - icd9AutomatZakonczonyAt > ICD9_CHOWAJ_PO_AUTOMACIE_MS) return false;
    return true;
  }

  // Serum zostawia w DOM stare kopie elementów z tym samym id (potwierdzone
  // przy PODGLĄDZIE WYNIKÓW i polu PIN); getElementById zwraca PIERWSZĄ —
  // niekoniecznie tę widoczną. Log 18.09.2026 10:28: trzy wizyty z rzędu
  // „schowano listę”, a lista wciąż na ekranie. Dlatego wszystkie kopie.
  function icd9ElementyListy() {
    return {
      tabele: wszystkieZId('inp_uni_icd9_szybkie_tabela'),
      kontenery: wszystkieZId('inp_uni_icd9_szybkie_div'),
    };
  }

  let icd9OpisChowaniaLogged = 0;

  function hideIcd9SuggestionList() {
    // Dwa elementy (inspektor 18.09.2026):
    //   div#inp_uni_icd9_szybkie_div    — KONTENER (pozycjonowany, z listą
    //                                     domyślnych kodów; pokazuje go
    //                                     f_pokaz_jak_niepokazane z onfocus pola)
    //     table#inp_uni_icd9_szybkie_tabela — wyniki wyszukiwania (powstaje
    //                                     dopiero po odpowiedzi słownika)
    // Kolejność: istnienie (O(1)) i okno czasowe (sama arytmetyka) PRZED
    // zebraniem kopii — ta funkcja leci na każdym ticku przy otwartym panelu
    // wizyty, a w 99% przypadków odpada już na czasie.
    if (!document.getElementById('inp_uni_icd9_szybkie_tabela') &&
        !document.getElementById('inp_uni_icd9_szybkie_div')) return false;
    if (!wolnoChowacListeIcd9()) {
      if (icd9OpisChowaniaLogged !== icd9AutomatZakonczonyAt && Date.now() - icd9AutomatZakonczonyAt <= ICD9_CHOWAJ_PO_AUTOMACIE_MS) {
        icd9OpisChowaniaLogged = icd9AutomatZakonczonyAt;
        dbg('modIcd9Auto: NIE chowam listy — pole ICD-9 użyte ręcznie ' + ((Date.now() - icd9ReczneUzycieAt) / 1000).toFixed(1) + 's temu');
      }
      return false;
    }
    // Nie zamykamy listy „pod palcami”, jeśli użytkownik właśnie sam korzysta
    // z pola wyszukiwania ICD-9.
    // Uwaga na null === null: gdy pola wyszukiwania nie ma (findIcd9SearchInput
    // zwraca null), a activeElement też jest null, dawny warunek wychodził
    // „bo użytkownik pisze” — mimo że nie było czym pisać.
    const poleIcd9 = findIcd9SearchInput();
    if (poleIcd9 && document.activeElement === poleIcd9) return false;

    const { tabele, kontenery } = icd9ElementyListy();

    let wasOpen = false;
    const widoczneKontenery = kontenery.filter((k) => k.style.display !== 'none' && isOverlayElementVisible(k));
    const widoczneTabele = tabele.filter((t) => t.style.display !== 'none' && (t.innerHTML || '').trim() !== '');
    if (widoczneKontenery.length || widoczneTabele.length) wasOpen = true;

    // Raz na zakończenie automatu: ile kopii, ile widocznych — dowód do logu.
    if (icd9OpisChowaniaLogged !== icd9AutomatZakonczonyAt) {
      icd9OpisChowaniaLogged = icd9AutomatZakonczonyAt;
      dbg('modIcd9Auto: chowam listę — kontenerów ' + kontenery.length + ' (widocznych ' + widoczneKontenery.length +
        '), tabel ' + tabele.length + ' (z treścią ' + widoczneTabele.length + ')' +
        (kontenery.length ? ' | kontener[0] display=' + (kontenery[0].style.display || '(puste)') +
          ' pozycja=' + kontenery[0].style.left + ',' + kontenery[0].style.top +
          ' rodzic=' + (kontenery[0].parentElement?.tagName || '?') + (kontenery[0].parentElement?.id ? '#' + kontenery[0].parentElement.id : '') : ''));
    }

    // Serum steruje kontenerem przez inline display:block/none (patrz style
    // w inspektorze), więc display:none to dokładnie jego własny sposób chowania.
    // KLUCZOWE dla wydajności: ta funkcja jest wołana na KAŻDYM ticku w oknie
    // po automacie. Piszemy TYLKO, gdy jest co zmienić — każdy zapis to
    // mutacja, którą łapie nasz własny obserwator (dawniej pętla co 400 ms).
    for (const k of kontenery) setStyleIfChanged(k, 'display', 'none');
    for (const t of tabele) {
      if ((t.innerHTML || '').trim() !== '') t.innerHTML = '';
      setStyleIfChanged(t, 'display', 'none');
    }
    return wasOpen;
  }


  // Lista podpowiedzi bywa dorysowana przez stronę Z OPÓŹNIENIEM — czasem już
  // po tym, jak modIcd9Auto zdążył zrezygnować z czekania. Jednorazowe
  // schowanie by tego nie złapało, stąd kilka krótkich, wygasających dogrywek.
  const icd9HideRetryTimers = [];

  function clearIcd9HideRetries() {
    while (icd9HideRetryTimers.length) clearTimeout(icd9HideRetryTimers.pop());
  }

  function hideIcd9SuggestionListWithRetries() {
    hideIcd9SuggestionList();
    clearIcd9HideRetries();
    for (const delay of [300, 800, 1500, 3000]) {
      icd9HideRetryTimers.push(
        setTimeout(() => {
          if (hideIcd9SuggestionList()) {
            dbg('modIcd9Auto: schowano spóźnioną listę podpowiedzi (dogrywka +' + delay + 'ms)');
          }
        }, delay)
      );
    }
  }

  function finishIcd9Selection() {
    hideIcd9SuggestionList();
    const wywiad = document.getElementById('wizb_wywiad_w');
    if (wywiad?.tagName === 'TEXTAREA') {
      wywiad.focus({ preventScroll: true });
      const len = wywiad.value.length;
      try { wywiad.setSelectionRange(len, len); } catch (_) {}
      dbg('modIcd9Auto: schowano listę podpowiedzi, fokus na polu WYWIAD');
    } else {
      dbg('modIcd9Auto: schowano listę podpowiedzi, ale nie znalazłem pola WYWIAD');
    }
  }

  function modIcd9Auto() {
    const input = findIcd9SearchInput();
    pilnujRecznegoUzyciaIcd9(input);
    if (!input) {
      // Panel „Edycja wizyty” zamknięty (albo jeszcze niewidoczny) — resetujemy,
      // żeby przy następnym wejściu (ten sam pacjent lub inny — strona nie
      // przeładowuje się między wizytami) automatyzacja zadziałała od nowa.
      icd9AutoDone = false;
      icd9AutoPending = null;
      icd9AutoProba = 0;
      icd9Cache.uwagi = null;
      clearIcd9HideRetries();
      return;
    }
    if (icd9AutoDone) {
      // Dowód z konsoli (28.08.2026): po udanym wyborze kodu (fokus poszedł
      // już na WYWIAD, więc finishIcd9Selection się wykonał) tabela podpowiedzi
      // mimo to wciąż miała pełną treść i była widoczna — strona odtworzyła ją
      // PO naszym jednorazowym schowaniu (dogrywki w finishIcd9Selection kończą
      // się po 3s, a odtworzenie bywa późniejsze). Zamiast zgadywać dokładny
      // moment, egzekwujemy „schowane” na każdym ticku — ale TYLKO przez
      // ICD9_CHOWAJ_PO_AUTOMACIE_MS od zakończenia automatu i nigdy po ręcznym
      // użyciu pola (patrz wolnoChowacListeIcd9). Dawne „dopóki panel jest
      // otwarty” kasowało ręczne podpowiedzi lekarza (zrzut 18.09.2026).
      if (hideIcd9SuggestionList()) {
        dbg('modIcd9Auto: strona odtworzyła listę podpowiedzi po zakończeniu automatyki — chowam ponownie');
      }
      return;
    }

    if (!icd9AutoPending) {
      if (input.value.trim() !== '') return; // pole zajęte ręcznym wpisem — nie ruszamy

      if (!icd9Cache.uwagi?.isConnected) icd9Cache.uwagi = findUwagiZTerminarza();
      const uwagi = icd9Cache.uwagi;

      const text = uwagi ? (uwagi.value ?? uwagi.textContent ?? '') : '';
      let target = determineIcd9Target(text);
      if (!target && wywiadMaWniosekOLeki()) target = ICD9_CODE_TELE;
      // Bez wyzwalacza nie oznaczamy „done” — treść WYWIADU (szablon wizyty
      // receptowej) może pojawić się chwilę po uwagach z terminarza, więc
      // sprawdzamy dalej przy kolejnych tickach, dopóki panel jest otwarty.
      if (!target) return;
      if (icd9AlreadyAdded(target)) { icd9AutoDone = true; return; }

      icd9AutoPending = target;
      icd9AutoPendingSince = Date.now();
      icd9AutoProba = 1;
      zaplanujTickZa(ICD9_PENDING_TIMEOUT_MS + 50);
      dbg('modIcd9Auto: wpisuję kod ICD-9 ' + target + ' na podstawie uwag z terminarza i wyzwalam wyszukiwanie (próba 1/' + ICD9_MAX_PROB + ')');
      for (const t of icd9ElementyListy().tabele) t.style.display = ''; // cofnij ukrycie z finishIcd9Selection
      jakoAutomatIcd9(() => {
        input.value = target;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      if (!triggerIcd9Search(target, input)) {
        dbg('modIcd9Auto: f_uni_icd9_wyszukaj_kody niedostępna, próbuję przez onblur pola');
        jakoAutomatIcd9(() => {
          if (typeof input.onblur === 'function') {
            input.onblur();
          } else {
            input.focus({ preventScroll: true });
            input.blur();
          }
        });
      }
      return;
    }

    const teraz = Date.now();
    const row = findIcd9SuggestionRow(icd9AutoPending);
    if (!row) {
      // Limit próby sprawdza tick — gdy po wyszukiwaniu nic się w DOM nie
      // zmienia, nie byłoby kiedy (dawniej robił to interwał co 3 s).
      zaplanujTickZa(icd9AutoPendingSince + ICD9_PENDING_TIMEOUT_MS - teraz + 50);
      if (teraz - icd9AutoPendingSince > ICD9_PENDING_TIMEOUT_MS) {
        const stan = opiszListePodpowiedziIcd9(input);
        if (icd9AutoProba < ICD9_MAX_PROB) {
          icd9AutoProba++;
          icd9AutoPendingSince = teraz;
          dbg('modIcd9Auto: brak podpowiedzi dla kodu ' + icd9AutoPending + ' po ' + ICD9_PENDING_TIMEOUT_MS +
            'ms — ponawiam wyszukiwanie (próba ' + icd9AutoProba + '/' + ICD9_MAX_PROB + ') | ' + stan);
          for (const t of icd9ElementyListy().tabele) t.style.display = '';
          if (input.value.trim() !== icd9AutoPending) {
            jakoAutomatIcd9(() => {
              input.value = icd9AutoPending;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            });
          }
          triggerIcd9Search(icd9AutoPending, input);
          zaplanujTickZa(ICD9_PENDING_TIMEOUT_MS + 50);
          return;
        }
        dbg('modIcd9Auto: brak podpowiedzi dla kodu ' + icd9AutoPending + ' po ' + ICD9_MAX_PROB + ' próbach — rezygnuję | ' + stan);
        if (input.value.trim() === icd9AutoPending) input.value = ''; // nie zostawiaj martwego tekstu w polu
        // Rezygnujemy z wyboru kodu, ale rozwinięta lista podpowiedzi zostawała
        // otwarta i zasłaniała pół ekranu (fokus szedł na WYWIAD, a niebieskie
        // menu wisiało dalej) — chowamy ją tak samo jak po udanym wyborze.
        icd9AutomatZakonczonyAt = Date.now();
        hideIcd9SuggestionListWithRetries();
        icd9AutoDone = true;
        icd9AutoPending = null;
      }
      return;
    }
    icd9AutomatZakonczonyAt = Date.now();
    dbg('modIcd9Auto: klik podpowiedzi ICD-9 ' + icd9AutoPending + ' + Enter');
    jakoAutomatIcd9(() => {
      row.click();
      pressEnter(input);
      input.blur();
    });
    icd9AutoDone = true;
    icd9AutoPending = null;
    // Chwilę później (żeby obsługa kliknięcia strony zdążyła dodać kod):
    // schowaj listę podpowiedzi i przenieś fokus na WYWIAD.
    setTimeout(finishIcd9Selection, 400);
  }

  // --- FOKUS NA WYWIAD PO OTWARCIU KARTY WIZYTY ---
  // Serum po otwarciu „Edycja wizyty” samo przywraca fokus na ostatnio
  // aktywne pole z POPRZEDNIEJ wizyty (onfocus="...f_wiz_ostatnio_aktywne_pole_ustaw(this)")
  // — jeśli ostatnio było to ICD10, nowa karta otwiera się z fokusem tam,
  // zamiast w polu WYWIAD. To przywracanie bywa asynchroniczne i czasem
  // wygrywa wyścig z naszym jednorazowym ustawieniem fokusu (stąd bywało, że
  // fokus mimo to zostawał na ICD10) — dlatego dogrywamy kilka prób w
  // pierwszych ~2s po otwarciu, zamiast ustawiać fokus tylko raz.

  let wywiadFokusStartDone = false;
  let wywiadFokusRetryTimers = [];

  function clearWywiadFokusRetries() {
    wywiadFokusRetryTimers.forEach(clearTimeout);
    wywiadFokusRetryTimers = [];
  }

  // --- TELEPORADA: pusty wiersz pod szablonem zgody ---
  // Przy wizycie teleporadowej pole WYWIAD ma już wstawiony gotowy szablon:
  //     Teleporada Potwierdzono tożsamość pacjenta
  //     Pacjent wyraża zgodę na teleporadę
  // Kursor lądował na końcu drugiej linijki, więc przed pisaniem właściwego
  // wywiadu trzeba było dwa razy nacisnąć Enter. Robimy to za użytkownika.
  let wywiadTeleporadaDone = false;

  function wywiadMaSzablonTeleporady(value) {
    const t = normalize(value); // małe litery + sklejone białe znaki + trim
    // endsWith, nie includes — dzięki temu nie ruszamy pola, jeśli lekarz
    // zdążył już coś dopisać pod szablonem.
    return t.includes('potwierdzono tożsamość pacjenta') && t.endsWith('teleporadę');
  }

  function dodajPustyWierszPoTeleporadzie(wywiad) {
    if (wywiadTeleporadaDone) return false;
    const value = wywiad.value || '';
    if (!wywiadMaSzablonTeleporady(value)) return false;

    // Jednorazowo na jedno otwarcie panelu — inaczej dogrywki (150/400/800/
    // 1500 ms) dokładałyby kolejne puste wiersze.
    wywiadTeleporadaDone = true;

    // Pusty wiersz już jest (np. lekarz sam go zrobił) — nie dokładamy drugiego.
    if (/\n[ \t]*\n[ \t]*$/.test(value)) return false;

    const nowa = value.replace(/\s+$/, '') + '\n\n';
    // Natywny setter + zdarzenia — tak samo jak przy polu „Powód edycji”;
    // bez tego Serum może nie zauważyć zmiany i nie zapisać jej z wizytą.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(wywiad, nowa);
    else wywiad.value = nowa;
    wywiad.dispatchEvent(new Event('input', { bubbles: true }));
    wywiad.dispatchEvent(new Event('change', { bubbles: true }));

    wywiad.focus({ preventScroll: true });
    try { wywiad.setSelectionRange(nowa.length, nowa.length); } catch (_) {}
    dbg('modWywiadFokusStart: teleporada — dodano pusty wiersz, kursor pod szablonem');
    return true;
  }

  // Szablon teleporady bywa wstawiany przez Serum chwilę PO otwarciu panelu,
  // dlatego jedno i drugie idzie tą samą ścieżką z dogrywkami.
  function wywiadKrokStartowy(reason) {
    const wywiad = document.getElementById('wizb_wywiad_w');
    if (!isOverlayElementVisible(wywiad)) return;
    if (dodajPustyWierszPoTeleporadzie(wywiad)) return;
    focusWywiadNow(reason);
  }

  function focusWywiadNow(reason) {
    const wywiad = document.getElementById('wizb_wywiad_w');
    if (!isOverlayElementVisible(wywiad)) return;
    if (document.activeElement === wywiad) return; // już tam, nic do roboty
    if (wywiad.value.trim() !== '') return; // użytkownik już zaczął pisać — nie przeszkadzamy
    wywiad.focus({ preventScroll: true });
    const len = wywiad.value.length;
    try { wywiad.setSelectionRange(len, len); } catch (_) {}
    dbg('modWywiadFokusStart: przeniesiono fokus na pole WYWIAD (' + reason + ')');
  }

  function modWywiadFokusStart() {
    if (!panelWizytyOtwarty()) {
      wywiadFokusStartDone = false; // panel zamknięty — reset na następne otwarcie
      wywiadTeleporadaDone = false;
      clearWywiadFokusRetries();
      return;
    }
    if (wywiadFokusStartDone) return;
    // Automat ICD-9 trzyma fokus w polu wyszukiwania, dopóki czeka na listę
    // podpowiedzi — zabranie go teraz (ten moduł biegnie w TYM SAMYM ticku,
    // zaraz po modIcd9Auto) odpaliłoby onblur pola i widżet schowałby listę.
    // Po wyborze kodu finishIcd9Selection sam przenosi fokus na WYWIAD.
    // Tylko przez 2 s od wyzwolenia — zrzut #100 (18.09) pokazał, że fokus w
    // WYWIAD nie zamyka listy, a przy wolnym słowniku (3 × 8 s) lekarz
    // zostawałby bez kursora w polu na 24 s.
    if (icd9AutoPending && Date.now() - icd9AutoPendingSince < 2000) {
      zaplanujTickZa(icd9AutoPendingSince + 2000 - Date.now() + 20);
      return;
    }

    const wywiad = document.getElementById('wizb_wywiad_w');
    if (!isOverlayElementVisible(wywiad)) return;
    wywiadFokusStartDone = true;

    wywiadKrokStartowy('od razu po otwarciu');
    [150, 400, 800, 1500].forEach((delay) => {
      wywiadFokusRetryTimers.push(setTimeout(() => wywiadKrokStartowy('dogrywka +' + delay + 'ms'), delay));
    });
  }

  // --- AUTO-PROCEDURY ZE SŁOWNIKA PRODUKTÓW DODATKOWYCH (kody ICD-9) ---
  //
  // Gdy w polu BADANIE PRZEDMIOTOWE (textarea#wizb_opis_w) pojawią się wyniki
  // zawierające nazwę jednego z poniższych badań, do wizyty trzeba dopisać
  // odpowiedni produkt jednostkowy — Serum dokłada wtedy samo kod ICD-9
  // (WITAMINA B12 → O83, KWAS FOLIOWY → M41, FERRYTYNA → L05 itd.).
  //
  // Potwierdzone inspektorem:
  //   otwarcie słownika:
  //     <a class="a_akc" title="Dodaj produkty jednostkowe ze słownika
  //        produktów dodatkowych" onclick="javascript:f_poz_dodaj_produkty_dodatkowe();">+</a>
  //   wiersz słownika (okno div.przegladarka, np. div#_uf_przegladarka2):
  //     <tr class="tr_parzysty">
  //       <td>01.0010.119.11</td><td>5.01.00.0000164</td>
  //       <td class="l" style="font-weight:bold;">FERRYTYNA</td>
  //       <td>4</td><td>L05*1</td>
  //       <td><input id="poz_dod_prod_6" type="checkbox" value="6469316"
  //            onclick="f_poz_dodaj_dod_prod(this.value);"></td>
  //     </tr>
  //   dodane produkty lądują w div#div_swiadczenie_poz
  //
  // Ani id checkboxa (poz_dod_prod_N — numer porządkowy w słowniku), ani jego
  // value (6469316 — identyfikator sesyjny) nie są stałe, więc jedynym pewnym
  // punktem zaczepienia jest NAZWA procedury w komórce td.l. Z tego samego
  // powodu samo okno rozpoznajemy nie po tytule, tylko po tym, że zawiera
  // checkboxy wołające f_poz_dodaj_dod_prod — to definicja tego okna.

  // szukaj[] — warianty zapisu spotykane w wynikach wklejanych do pola.
  // Porównanie idzie po normalize(): małe litery, ciągi białych znaków
  // sklejone do jednej spacji.
  const PROC_DOD_REGULY = [
    { szukaj: ['witamina b12'], procedura: 'WITAMINA B12' },
    { szukaj: ['kwas foliowy'], procedura: 'KWAS FOLIOWY' },
    { szukaj: ['ferrytyna'], procedura: 'FERRYTYNA' },
    { szukaj: ['anty-ccp', 'anty ccp'], procedura: 'ANTY-CCP' },
    { szukaj: ['anty-hcv', 'anty hcv'], procedura: 'PRZECIWCIAŁA ANTY-HCV' },
    {
      szukaj: [
        'helicobacter pylori - antygen w kale',
        'helicobacter pylori antygen w kale',
        'antygen helicobacter pylori w kale',
      ],
      procedura: 'ANTYGEN H.PYLORI W KALE - TEST LABORATORYJNY',
    },
  ];

  const PROC_DOD_SELEKTOR_CHK = 'input[type="checkbox"][onclick*="f_poz_dodaj_dod_prod"]';
  // Pisanie z ręki wymaga cierpliwości — treść dopiero powstaje. Ale
  // wklejenie (paste) i opuszczenie pola (change) to sygnały ZAKOŃCZONE:
  // nic więcej nie dojdzie, więc nie ma na co czekać.
  const PROC_DOD_DEBOUNCE_MS = 1500;
  const PROC_DOD_DEBOUNCE_GOTOWE_MS = 200;
  // Po 'paste' przeglądarka wysyła jeszcze 'input' (wtedy dopiero pole ma
  // nową treść). To okno sprawia, że tamten 'input' nie zdegraduje krótkiego
  // odliczania z powrotem do długiego.
  const PROC_DOD_OKNO_WKLEJENIA_MS = 400;
  const PROC_DOD_OKNO_TIMEOUT_MS = 8000;
  const PROC_DOD_KLIK_MS = 80;
  const PROC_DOD_DODANIE_TIMEOUT_MS = 6000;

  const procDodPodpiete = new WeakSet();
  const procDodBazowyTekst = new WeakMap();
  let procDodTimer = null;
  let procDodBiegnie = false;
  let procDodWklejenieAt = 0;
  // Procedury, które SAMI wstawiliśmy i które potwierdziła tabela ŚWIADCZEŃ.
  const procDodDodanePrzezNas = new Set();
  // Procedury skasowane ręcznie po naszym wstawieniu — do końca tej wizyty
  // nie dokładamy ich ponownie (patrz zapomnijHistorieProcedur).
  const procDodUsunieteRecznie = new Set();

  // „KWAS FOLIOWY.” w słowniku ma kropkę na końcu, w tabeli świadczeń też —
  // porównujemy nazwy bez niej i bez różnic w odstępach/wielkości liter.
  function normProcNazwe(text) {
    return normLabel(text).toUpperCase().replace(/\.+$/, '');
  }

  // Okno słownika = to div.przegladarka, w którym są checkboxy dodające
  // produkt. Nie ma potrzeby dopasowywania tytułu ani id okna.
  function znajdzOknoSlownika() {
    const chk = document.querySelector(PROC_DOD_SELEKTOR_CHK);
    if (!chk) return null;
    return chk.closest('div.przegladarka') || chk.closest('div') || null;
  }

  function znajdzCheckboxProcedury(okno, nazwa) {
    for (const chk of okno.querySelectorAll(PROC_DOD_SELEKTOR_CHK)) {
      const komorka = chk.closest('tr')?.querySelector('td.l');
      if (!komorka) continue;
      if (normProcNazwe(komorka.textContent) !== nazwa) continue;
      return chk;
    }
    return null;
  }

  // Sprawdzamy WYŁĄCZNIE dokładną treść komórek tabeli świadczeń. Zwykłe
  // przeszukanie textContent całego div#div_swiadczenie_poz dawałoby fałszywe
  // trafienia, bo jest tam też <select> „Produkt jednostkowy” z listą
  // wszystkich produktów w opcjach.
  function proceduraJuzDodana(nazwa) {
    const kontener = document.getElementById('div_swiadczenie_poz');
    if (!kontener) return false;
    for (const td of kontener.querySelectorAll('td')) {
      if (normProcNazwe(td.textContent) === nazwa) return true;
    }
    return false;
  }

  // Skasowanie pozycji z ŚWIADCZEŃ jest jednoznaczną decyzją lekarza: kod ma
  // tam NIE być. Wcześniej automat tego nie odróżniał — widział „wyzwalacz w
  // BADANIU PRZEDMIOTOWYM jest, kodu nie ma” i przy najbliższej zmianie treści
  // pola (dalsze pisanie opisu wystarczy) dokładał kod z powrotem. Dlatego
  // pilnujemy tego, co sami wstawiliśmy: jeśli potwierdzona przez nas pozycja
  // znika z tabeli, znaczy że usunięto ją ręcznie — i do końca tej wizyty
  // przestajemy ją proponować.
  function wykryjReczneUsunieciaProcedur() {
    if (!procDodDodanePrzezNas.size) return;
    // Brak kontenera = tabela świadczeń akurat się przerysowuje. Wtedy „nie ma
    // wiersza” nie znaczy „skasowano”, więc nie wyciągamy żadnych wniosków.
    if (!document.getElementById('div_swiadczenie_poz')) return;

    for (const nazwa of [...procDodDodanePrzezNas]) {
      if (proceduraJuzDodana(nazwa)) continue;
      procDodDodanePrzezNas.delete(nazwa);
      procDodUsunieteRecznie.add(nazwa);
      dbg('modProceduryDodatkowe: „' + nazwa + '” usunięta ręcznie ze ŚWIADCZEŃ — nie dodaję jej ponownie w tej wizycie');
    }
  }

  // Nowa wizyta (świeży panel edycji) zaczyna z czystym kontem — blokada
  // dotyczy wyłącznie wizyty, w której lekarz skasował kod.
  function zapomnijHistorieProcedur() {
    procDodDodanePrzezNas.clear();
    procDodUsunieteRecznie.clear();
  }

  function brakujaceProcedury(tekst) {
    const tresc = normalize(tekst);
    if (!tresc) return [];
    return PROC_DOD_REGULY.filter(
      (r) => r.szukaj.some((s) => tresc.includes(s)) &&
        !procDodUsunieteRecznie.has(r.procedura) &&
        !proceduraJuzDodana(r.procedura)
    );
  }

  function otworzSlownikProduktow() {
    const link = document.querySelector('a[onclick*="f_poz_dodaj_produkty_dodatkowe"]');
    if (isOverlayElementVisible(link)) {
      link.click();
      return true;
    }
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof uw.f_poz_dodaj_produkty_dodatkowe === 'function') {
      uw.f_poz_dodaj_produkty_dodatkowe();
      return true;
    }
    return false;
  }

  async function czekajNaSlownik() {
    const doKiedy = Date.now() + PROC_DOD_OKNO_TIMEOUT_MS;
    for (;;) {
      const okno = znajdzOknoSlownika();
      if (okno) return okno;
      if (Date.now() >= doKiedy) return null;
      await sleepMs(50);
    }
  }

  // Po „Wstaw” czekamy RAZ na wszystkie pozycje naraz. Zwraca listę tych,
  // których mimo to nie widać w tabeli świadczeń.
  async function czekajNaDodanie(nazwy) {
    const doKiedy = Date.now() + PROC_DOD_DODANIE_TIMEOUT_MS;
    for (;;) {
      const brak = nazwy.filter((n) => !proceduraJuzDodana(n));
      if (!brak.length) return [];
      if (Date.now() >= doKiedy) return brak;
      await sleepMs(50);
    }
  }

  // Potwierdzone inspektorem:
  //   <a class="a_akc" href="javascript:void(0)"
  //      onclick="javascript:f_poz_rysuj_wybrane_dodatkowe_produkty('T');">Wstaw</a>
  function znajdzPrzyciskWstaw(okno) {
    const byOnclick = okno.querySelector('a[onclick*="f_poz_rysuj_wybrane_dodatkowe_produkty"]');
    if (byOnclick) return byOnclick;
    for (const el of okno.querySelectorAll('a.a_akc, a, button')) {
      if (normLabel(el.textContent) === 'Wstaw') return el;
    }
    return null;
  }

  async function zaznaczProcedure(nazwa) {
    const okno = znajdzOknoSlownika();
    if (!okno) return 'brak-okna';

    const chk = znajdzCheckboxProcedury(okno, nazwa);
    if (!chk) {
      dbg('modProceduryDodatkowe: w słowniku nie ma pozycji „' + nazwa + '” — pomijam');
      return 'brak-pozycji';
    }
    if (chk.checked) {
      dbg('modProceduryDodatkowe: „' + nazwa + '” jest już zaznaczona w słowniku — pomijam');
      return 'juz-zaznaczona';
    }

    chk.click();
    // f_poz_dodaj_dod_prod() SAMO NICZEGO NIE DODAJE — tylko zapamiętuje wybór;
    // do tabeli świadczeń pozycje trafiają dopiero po kliknięciu „Wstaw”.
    // Dlatego tu nie ma co czekać na wiersz w div#div_swiadczenie_poz (wcześniej
    // czekaliśmy tak do 6s na KAŻDEJ pozycji — stąd brała się cała powolność).
    // Wystarczy krótko ustąpić pola stronie i sprawdzić, czy „ptaszek” został.
    await sleepMs(PROC_DOD_KLIK_MS);
    const poKliku = znajdzCheckboxProcedury(znajdzOknoSlownika() || okno, nazwa);
    if (!poKliku?.checked) {
      dbg('modProceduryDodatkowe: „' + nazwa + '” nie zaznaczyła się w słowniku');
      return 'nie-zaznaczono';
    }
    return 'zaznaczono';
  }

  async function dodajProceduryDodatkowe(reguly, opis) {
    dbg(
      'modProceduryDodatkowe: w BADANIU PRZEDMIOTOWYM wykryto ' +
        reguly.map((r) => r.procedura).join(', ') +
        ' — otwieram słownik produktów dodatkowych'
    );

    // Okno modalne zabiera fokus — zapamiętujemy, gdzie stał kursor, żeby po
    // zamknięciu oddać pole dokładnie w tym samym miejscu.
    const wracamDoOpisu = document.activeElement === opis;
    const kursor = wracamDoOpisu ? opis.selectionStart : null;
    const przywrocFokus = () => {
      if (!wracamDoOpisu || !opis.isConnected) return;
      opis.focus({ preventScroll: true });
      try { opis.setSelectionRange(kursor, kursor); } catch (_) {}
    };

    if (!otworzSlownikProduktow()) {
      dbg('modProceduryDodatkowe: nie znalazłem przycisku otwierającego słownik — przerywam');
      return;
    }

    if (!(await czekajNaSlownik())) {
      dbg('modProceduryDodatkowe: słownik nie otworzył się w ' + PROC_DOD_OKNO_TIMEOUT_MS + 'ms — przerywam');
      return;
    }

    const zaznaczone = [];
    for (const reg of reguly) {
      if ((await zaznaczProcedure(reg.procedura)) === 'zaznaczono') zaznaczone.push(reg.procedura);
    }

    if (zaznaczone.length) {
      const oknoDoWstawienia = znajdzOknoSlownika();
      const wstaw = oknoDoWstawienia ? znajdzPrzyciskWstaw(oknoDoWstawienia) : null;
      if (!wstaw) {
        dbg('modProceduryDodatkowe: nie znalazłem przycisku „Wstaw” — zostawiam okno otwarte do ręcznego zatwierdzenia');
        przywrocFokus();
        return;
      }
      dbg('modProceduryDodatkowe: zaznaczono ' + zaznaczone.join(', ') + ' — klikam „Wstaw”');
      wstaw.click();

      const brak = await czekajNaDodanie(zaznaczone);
      // Zapamiętujemy tylko pozycje POTWIERDZONE w tabeli — inaczej pozycja,
      // która nigdy się nie wstawiła, zostałaby zaraz uznana za „skasowaną
      // ręcznie” i zablokowana na resztę wizyty.
      for (const nazwa of zaznaczone) {
        if (!brak.includes(nazwa)) procDodDodanePrzezNas.add(nazwa);
      }
      if (brak.length) {
        dbg('modProceduryDodatkowe: po „Wstaw” nadal brak w ŚWIADCZENIACH: ' + brak.join(', '));
      } else {
        dbg('modProceduryDodatkowe: ŚWIADCZENIA potwierdziły ' + zaznaczone.join(', '));
      }
    } else {
      dbg('modProceduryDodatkowe: nie było nic nowego do zaznaczenia');
    }

    const oknoKoncowe = znajdzOknoSlownika();
    if (!oknoKoncowe) {
      dbg('modProceduryDodatkowe: słownik zamknął się sam');
    } else {
      const krzyzyk = findPueCloseButton(oknoKoncowe);
      if (krzyzyk) {
        krzyzyk.click();
        dbg('modProceduryDodatkowe: zamknięto słownik');
      } else {
        dbg('modProceduryDodatkowe: nie znalazłem krzyżyka słownika — zostawiam okno otwarte');
      }
    }

    przywrocFokus();
  }

  function opoznienieProcedur() {
    return Date.now() - procDodWklejenieAt < PROC_DOD_OKNO_WKLEJENIA_MS
      ? PROC_DOD_DEBOUNCE_GOTOWE_MS
      : PROC_DOD_DEBOUNCE_MS;
  }

  // Zdarzenia pola odświeżają odliczanie (piszesz dalej — czekamy dalej).
  function zaplanujSprawdzenieProcedur(opis, gotowe) {
    if (gotowe) procDodWklejenieAt = Date.now();
    if (procDodTimer) clearTimeout(procDodTimer);
    procDodTimer = setTimeout(() => {
      procDodTimer = null;
      sprawdzProceduryDodatkowe(opis);
    }, opoznienieProcedur());
  }

  // Ścieżka zapasowa z uiTick() — NIE odświeża odliczania. Inaczej przy
  // tickach lecących co sekundę (zegar sesji) termin przesuwałby się w
  // nieskończoność i sprawdzenie nigdy by nie wystartowało.
  function upewnijSieZeSprawdzeniZaplanowane(opis) {
    if (procDodTimer) return;
    procDodTimer = setTimeout(() => {
      procDodTimer = null;
      sprawdzProceduryDodatkowe(opis);
    }, opoznienieProcedur());
  }

  async function sprawdzProceduryDodatkowe(opis) {
    if (!opis?.isConnected) return;
    // Zmiana w trakcie poprzedniego przebiegu — nie gubimy jej, tylko
    // odkładamy na po zamknięciu słownika.
    if (procDodBiegnie) { zaplanujSprawdzenieProcedur(opis); return; }

    const tekst = opis.value || '';
    if (tekst === procDodBazowyTekst.get(opis)) return;
    // Punkt odniesienia przesuwamy ZAWSZE, niezależnie od wyniku — dzięki
    // temu ta sama treść nie jest analizowana w kółko.
    procDodBazowyTekst.set(opis, tekst);

    // Zanim cokolwiek dołożymy — odnotuj to, co lekarz w międzyczasie skasował.
    wykryjReczneUsunieciaProcedur();

    const brakuje = brakujaceProcedury(tekst);
    if (!brakuje.length) {
      const trafienia = PROC_DOD_REGULY.filter((r) => r.szukaj.some((s) => normalize(tekst).includes(s)));
      const zablokowane = trafienia.filter((r) => procDodUsunieteRecznie.has(r.procedura)).map((r) => r.procedura);
      const juzSa = trafienia.filter((r) => !procDodUsunieteRecznie.has(r.procedura)).map((r) => r.procedura);
      if (juzSa.length) {
        dbg('modProceduryDodatkowe: wykryto ' + juzSa.join(', ') + ', ale są już w ŚWIADCZENIACH — nic nie robię');
      }
      if (zablokowane.length) {
        dbg('modProceduryDodatkowe: wykryto ' + zablokowane.join(', ') + ', ale skasowano je ręcznie — nie przywracam');
      }
      return;
    }

    // „Czy zapisać świadczenie” odznaczone = ta wizyta świadczenia w ogóle
    // nie zapisuje (np. sama porada bez rozliczenia) — dodawanie kodów ICD-9
    // byłoby bez sensu. Checkbox nieznaleziony to co innego niż odznaczony:
    // wtedy nie blokujemy, bo nie mamy pewności co do stanu.
    const chkZapisz = findZapiszSwiadczenieCheckbox();
    if (chkZapisz && !chkZapisz.checked) {
      dbg('modProceduryDodatkowe: „Czy zapisać świadczenie” odznaczone — pomijam ' + brakuje.map((r) => r.procedura).join(', '));
      return;
    }

    procDodBiegnie = true;
    try {
      await dodajProceduryDodatkowe(brakuje, opis);
    } catch (e) {
      dbg('modProceduryDodatkowe: wyjątek — ' + (e?.message || e));
    } finally {
      procDodBiegnie = false;
    }
  }

  function modProceduryDodatkowe() {
    const opis = document.getElementById('wizb_opis_w');
    if (!opis) return;

    if (!procDodPodpiete.has(opis)) {
      procDodPodpiete.add(opis);
      zapomnijHistorieProcedur();
      // Treść zastana przy pierwszym zobaczeniu pola jest punktem odniesienia:
      // samo otwarcie wizyty z gotowymi wynikami niczego nie uruchamia,
      // reagujemy wyłącznie na zmianę/wklejenie. Punkt odniesienia trzymamy
      // PRZY ELEMENCIE (WeakMap), nie w zmiennej modułu — wcześniej dowolny
      // tick potrafił go nadpisać świeżo wklejoną treścią i zmiana przepadała.
      procDodBazowyTekst.set(opis, opis.value || '');
      opis.addEventListener('paste', () => zaplanujSprawdzenieProcedur(opis, true));
      opis.addEventListener('change', () => zaplanujSprawdzenieProcedur(opis, true));
      opis.addEventListener('input', () => zaplanujSprawdzenieProcedur(opis, false));
      dbg('modProceduryDodatkowe: obserwuję pole BADANIE PRZEDMIOTOWE (na start ' + (opis.value || '').length + ' znaków)');
      return;
    }

    // Ręczne skasowanie sprawdzamy na każdym ticku, a nie dopiero przy zmianie
    // treści pola — decyzja lekarza ma być zapamiętana od razu, także wtedy gdy
    // panel wizyty zdąży się w międzyczasie przerysować. Koszt zerowy, dopóki
    // sami niczego nie wstawiliśmy (funkcja wychodzi na pustym zbiorze).
    wykryjReczneUsunieciaProcedur();

    // Zapasowe wykrywanie zmiany: gdyby zdarzenie nie doszło (Serum podmienia
    // treść pola własnymi funkcjami, a wtedy „input” nie leci). Koszt: jeden
    // odczyt właściwości na tick — bez układu strony i bez serializacji DOM.
    if ((opis.value || '') !== procDodBazowyTekst.get(opis)) upewnijSieZeSprawdzeniZaplanowane(opis);
  }

  // --- AUTO LOGIN (osobny watcher) ---

  function bootLogin() {
    const LOGIN_DONE_KEY = 'serum_auto_login_done_v1';
    const CONFIG = {
      autofillGraceMs: 300,
      maxWaitMs: 45_000,
      pollMs: 300,
      // Stałe identyfikatory pól na ekranie logowania Serum (potwierdzone
      // inspektorem: <input id="inp_log" type="text" name="login"> oraz
      // <input id="inp_pass" type="password" name="password">, oba wskazywane
      // przez <label for="...">). Dzięki nim pola znajdujemy jednym
      // getElementById zamiast przemiatania wszystkich label/th/td/span/div
      // na stronie (findByLabel) — to zostaje wyłącznie jako awaryjna ścieżka,
      // gdyby Serum kiedyś zmieniło identyfikatory.
      loginId: 'inp_log',
      passwordId: 'inp_pass',
      loginSelectors: [
        'input[autocomplete="username"]',
        'input[name*="login" i]',
        'input[id*="login" i]',
        'input[name*="user" i]',
      ],
      passwordSelectors: ['input[type="password"]'],
    };

    let submitTimer = null;
    let loginObserver = null;
    let loginField = null;
    let passwordField = null;
    let loginArmed = false;
    let loginSubmitted = false;
    let loginCleared = false;

    // --- Bezpiecznik: seria nieudanych logowań (wygasłe hasło) ------------
    // Serum wymusza zmianę hasła raz na miesiąc. Menedżer haseł podstawia
    // wtedy STARE hasło, logowanie się nie udaje, strona wraca na ekran
    // logowania (czasem przez moduł przekierowania z 404) — i auto-submit
    // natychmiast wysyła to samo jeszcze raz. Pętla kręci się w kółko,
    // a użytkownik nie ma nawet kiedy wpisać nowego hasła.
    //
    // Liczymy PRÓBY WYSŁANIA, nie komunikaty błędu — dzięki temu bezpiecznik
    // nie zależy od żadnego tekstu ani układu strony po stronie Serum.
    // Licznik zeruje się, gdy jesteśmy już w aplikacji (istnieje zegar sesji
    // span#czas_sesji_pozostaly_info), więc zostają w nim wyłącznie próby
    // NIEUDANE POD RZĄD.
    const PROBY_KEY = 'serum_auto_login_proby_v1';
    const MAX_PROB = 3;
    // localStorage, nie sessionStorage: pętla przechodzi przez przeładowania
    // strony, a blokada ma obowiązywać też w nowo otwartej karcie — inaczej
    // pierwsza rzecz, jaką zrobi użytkownik po zablokowaniu (otworzy Serum na
    // nowo), wrzuciłaby go z powrotem w tę samą pętlę.
    const ZEGAR_SESJI_ID = 'czas_sesji_pozostaly_info';
    // Pętla kręci się w sekundach. Dwie próby oddalone o kilka minut to
    // normalna praca (logowanie rano, potem po przerwie), a nie seria —
    // stary licznik przepada, żeby blokada nie „narastała” przez tygodnie
    // z pojedynczych, niezwiązanych ze sobą logowań.
    const SERIA_OKNO_MS = 5 * 60_000;
    const BANER_ID = 'serum-ui-login-blokada';

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

    // Czytane RAZ na wczytanie strony i dalej trzymane w pamięci: licznik
    // zmienia się najwyżej raz na stronę (jedna próba logowania), więc nie ma
    // powodu odpytywać localStorage w pętli poll co 300ms.
    let probySerii = wczytajProby();

    function autoLogowanieZablokowane() { return probySerii >= MAX_PROB; }

    function odblokujAutoLogowanie(zrodlo) {
      probySerii = 0;
      zerujProby();
      document.getElementById(BANER_ID)?.remove();
      dbg('bootLogin: licznik nieudanych prób wyzerowany (' + zrodlo + ')');
    }

    function pokazBanerBlokady() {
      if (!document.body || document.getElementById(BANER_ID)) return;

      const baner = document.createElement('div');
      baner.id = BANER_ID; // patrz OWN_UI_IDS — nie ma wyzwalać ticka
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
        'Najczęstsza przyczyna: Serum wymusiło comiesięczną zmianę hasła, a menedżer podstawia stare. ' +
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
      btn.addEventListener('click', () => odblokujAutoLogowanie('przycisk w banerze'));

      baner.append(tresc, btn);
      document.body.appendChild(baner);
    }

    function isVisible(el) {
      return el?.isConnected && el.offsetParent !== null;
    }

    function matchesLabel(node, target) {
      const want = normalize(target);
      const own = [...node.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && n.childElementCount === 0))
        .map((n) => n.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (own === want) return true;
      const full = normalize(node.textContent || '');
      return full === want && full.length <= 40;
    }

    function findByLabel(label) {
      for (const node of document.querySelectorAll('label, th, td, span, div, legend')) {
        if (!matchesLabel(node, label)) continue;
        if (node.htmlFor) {
          const linked = document.getElementById(node.htmlFor);
          if (isVisible(linked)) return linked;
        }
        const row = node.closest('tr');
        if (row) {
          for (const cell of [...row.querySelectorAll('td, th')].slice(1)) {
            const input = cell.querySelector('input:not([type="checkbox"]), textarea');
            if (isVisible(input)) return input;
          }
        }
        const nested = node.parentElement?.querySelector('input:not([type="checkbox"]), textarea');
        if (isVisible(nested)) return nested;
      }
      return null;
    }

    // Kolejność: najpierw stałe ID, potem selektory, a przemiatanie etykiet
    // (findByLabel — jedyna naprawdę kosztowna ścieżka) DOPIERO na końcu, jako
    // awaryjna. Wcześniej findByLabel szło pierwsze, więc pełny skan strony
    // wykonywał się przy każdym odpytaniu, także na ekranie logowania, gdzie
    // getElementById załatwia sprawę natychmiast.
    function findLoginField() {
      if (isVisible(loginField)) return loginField;
      const byId = document.getElementById(CONFIG.loginId);
      if (isVisible(byId)) { loginField = byId; return byId; }
      for (const sel of CONFIG.loginSelectors) {
        const el = document.querySelector(sel);
        if (isVisible(el)) { loginField = el; return el; }
      }
      loginField = findByLabel('login');
      return loginField;
    }

    function findPasswordField() {
      if (isVisible(passwordField)) return passwordField;
      const byId = document.getElementById(CONFIG.passwordId);
      if (isVisible(byId)) { passwordField = byId; return byId; }
      for (const sel of CONFIG.passwordSelectors) {
        const el = document.querySelector(sel);
        if (isVisible(el)) { passwordField = el; return el; }
      }
      passwordField = findByLabel('hasło');
      return passwordField;
    }

    function isLoginPage() {
      // Bramka nr 1 (najtańsza): bez JAKIEGOKOLWIEK pola hasła w dokumencie
      // to na pewno nie jest ekran logowania. Odsiewa całą aplikację po
      // zalogowaniu jednym selektorem, zanim ruszymy cokolwiek droższego.
      if (!document.querySelector('input[type="password"]')) return false;
      // Bramka nr 2: pola logowania (teraz po ID — patrz wyżej).
      if (!findLoginField() || !findPasswordField()) return false;
      // Dopiero na końcu pełna serializacja tekstu strony — panel „PODPIS
      // ELEKTRONICZNY” też ma pole typu password i nie wolno go pomylić z
      // ekranem logowania. Warunki są w koniunkcji, więc przeniesienie tego
      // testu na koniec nie zmienia wyniku, a w praktyce prawie nigdy tu nie
      // dochodzimy.
      return !document.body?.textContent?.includes('PODPIS ELEKTRONICZNY');
    }

    function credentialsReady() {
      const login = findLoginField();
      const password = findPasswordField();
      return Boolean((login?.value || '').trim() && (password?.value || '').trim());
    }

    function dispatchEnter(field) {
      field?.focus({ preventScroll: true });
      for (const type of ['keydown', 'keypress', 'keyup']) {
        field?.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      }
    }

    function submitLogin() {
      if (!isLoginPage() || loginSubmitted || !credentialsReady()) return false;
      if (autoLogowanieZablokowane()) {
        pokazBanerBlokady();
        dbg('submitLogin: WSTRZYMANE — ' + probySerii + ' nieudane próby z rzędu (hasło do zmiany?)');
        return false;
      }

      const password = findPasswordField();
      const login = findLoginField();
      const form = login?.closest('form') || password?.closest('form');

      loginSubmitted = true;
      // Zapisujemy PRZED wysłaniem — zaraz po nim strona się przeładowuje.
      probySerii += 1;
      zapiszProby(probySerii);
      try { sessionStorage.setItem(LOGIN_DONE_KEY, '1'); } catch (_) {}
      loginObserver?.disconnect();

      dbg('submitLogin: auto-submit logowania (próba ' + probySerii + '/' + MAX_PROB + ')');
      dispatchEnter(password);
      if (form?.requestSubmit) form.requestSubmit();
      else form?.querySelector('button[type="submit"], input[type="submit"]')?.click();

      return true;
    }

    function scheduleSubmit() {
      if (loginSubmitted || !isLoginPage() || submitTimer) return;
      if (autoLogowanieZablokowane()) { pokazBanerBlokady(); return; }
      submitTimer = setTimeout(() => {
        submitTimer = null;
        if (credentialsReady()) submitLogin();
      }, CONFIG.autofillGraceMs);
    }

    function armLogin() {
      if (loginArmed || !isLoginPage()) return;
      // Blokada = zero obserwatorów i zero listenerów na ekranie logowania.
      // Sam formularz działa normalnie, tylko nikt go nie wysyła za użytkownika.
      if (autoLogowanieZablokowane()) { pokazBanerBlokady(); return; }

      if (!loginCleared) {
        loginCleared = true;
        try { sessionStorage.removeItem(LOGIN_DONE_KEY); } catch (_) {}
      }

      loginArmed = true;

      loginObserver = new MutationObserver(scheduleSubmit);
      loginObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['value'],
      });

      document.addEventListener('input', scheduleSubmit, true);
      document.addEventListener('change', scheduleSubmit, true);
      scheduleSubmit();
      setTimeout(scheduleSubmit, 800);
      setTimeout(scheduleSubmit, 2000);
      setTimeout(scheduleSubmit, 4000);
    }

    const pollStart = Date.now();
    const poll = setInterval(() => {
      // Zegar sesji istnieje tylko w zalogowanej aplikacji: to dowód, że
      // logowanie się powiodło, więc seria nieudanych prób jest przerwana.
      // Przy okazji gasimy poll — na stronie aplikacji nie ma już czego pilnować.
      if (document.getElementById(ZEGAR_SESJI_ID)) {
        if (probySerii) odblokujAutoLogowanie('udane logowanie');
        clearInterval(poll);
        return;
      }
      armLogin();
      if (loginArmed && credentialsReady() && !loginSubmitted) scheduleSubmit();
      if (loginSubmitted || Date.now() - pollStart > CONFIG.maxWaitMs) clearInterval(poll);
    }, CONFIG.pollMs);

    GM_registerMenuCommand?.('Auto Enter (logowanie)', () => {
      loginSubmitted = false;
      // Ręczne wywołanie z menu to świadoma decyzja — zdejmuje blokadę.
      odblokujAutoLogowanie('menu: Auto Enter');
      try { sessionStorage.removeItem(LOGIN_DONE_KEY); } catch (_) {}
      submitLogin();
    });

    GM_registerMenuCommand?.('Wznów auto-logowanie (zeruj licznik prób)', () => {
      odblokujAutoLogowanie('menu: zeruj licznik');
      loginArmed = false;
      armLogin();
    });
  }

  // --- PO ZALOGOWANIU: auto klik „Wizyty (EDM)” na stronie startowej ---

  // Flaga tylko w pamięci (nie w sessionStorage) — resetuje się naturalnie przy
  // każdym świeżym wczytaniu strony, więc nie utyka na „1” między sesjami.
  let dashboardNavDone = false;

  function isDashboardPage() {
    // Strona startowa to osobne wczytanie strony: klik „Wizyty (EDM)”
    // (f_wizyty_nowe → document.ex.submit) przeładowuje kartę — log 28.09:
    // klik 07:43:51.019, skrypt wstrzyknięty na nowo 07:43:51. Na stronie
    // roboczej ten moduł nie ma więc nic do roboty, a płacił za tekst całego
    // <body> na każdym ticku (5,4 s dziennie, skoki do 270 ms). Bramka O(1):
    // widżet poczty wewnętrznej („Odebrane”), z którego i tak korzysta
    // maNieprzeczytanaWiadomosc() — źródło strony startowej z cache Firefoksa.
    if (!document.getElementById('tab_poczta_wew_zakladki')) return false;
    // \s+ zamiast normalizacji całego tekstu (kopia z jedną spacją) — ten sam
    // wynik bez drugiej dużej alokacji.
    const t = document.body?.textContent || '';
    return /ważne\s+informacje/i.test(t) && /terminarz\s+na\s+dziś/i.test(t);
  }

  function findWizytyEdmLink() {
    const anchors = [...document.querySelectorAll('a')].filter(
      (el) => normLabel(el.textContent) === 'Wizyty (EDM)' && isOverlayElementVisible(el)
    );
    if (anchors.length) return anchors[0];

    for (const el of document.querySelectorAll('div, span, td, li')) {
      if (normLabel(el.textContent) !== 'Wizyty (EDM)') continue;
      if (!isOverlayElementVisible(el)) continue;
      return el;
    }
    return null;
  }

  // Nieprzeczytana wiadomość w „ODEBRANE” (wiersz wytłuszczony): Serum i tak
  // zawraca na stronę startową, dopóki się jej nie przeczyta, więc auto klik
  // kręciłby się w kółko. Wiersze odebranych mają lang="odebrane", nagłówek
  // (tr_naglowek, też pogrubiony) go nie ma.
  function maNieprzeczytanaWiadomosc() {
    for (const tr of document.querySelectorAll('tr[lang="odebrane"]')) {
      for (const el of tr.querySelectorAll('td, td *')) {
        if (parseInt(getComputedStyle(el).fontWeight, 10) >= 600) return true;
      }
    }
    return false;
  }

  // Bezpiecznik na pętlę z innego powodu: jeśli wracamy na stronę startową
  // niecałą minutę po naszym kliku, drugi raz już nie klikamy.
  const KLUCZ_DASHBOARD_KLIK = 'serum_dashboard_nav_klik';

  function modDashboardNav() {
    if (dashboardNavDone) return;
    if (!isDashboardPage()) return;

    if (maNieprzeczytanaWiadomosc()) {
      dashboardNavDone = true;
      dbg('modDashboardNav: nieprzeczytana wiadomość w ODEBRANE — bez auto kliku „Wizyty (EDM)”');
      return;
    }
    let ostatni = 0;
    try { ostatni = Number(sessionStorage.getItem(KLUCZ_DASHBOARD_KLIK)) || 0; } catch (e) {}
    if (Date.now() - ostatni < 60_000) {
      dashboardNavDone = true;
      dbg('modDashboardNav: powrót na stronę startową tuż po auto kliku — nie klikam ponownie (pętla?)');
      return;
    }

    const link = findWizytyEdmLink();
    if (!link) {
      dbg('modDashboardNav: strona startowa wykryta, ale link „Wizyty (EDM)” nie znaleziony');
      return;
    }

    dashboardNavDone = true;
    try { sessionStorage.setItem(KLUCZ_DASHBOARD_KLIK, String(Date.now())); } catch (e) {}
    dbg('modDashboardNav: klik „Wizyty (EDM)” po zalogowaniu');
    link.click();
  }

  // --- HISTORIA WIZYT: auto klik „Filtruj” po wejściu w zakładkę, potem „Rozwiń” ---

  let historiaFiltrDone = false;
  let historiaRozwinDone = false;

  function findHistoriaFiltrButton() {
    // Dopasowanie po fragmencie href (konkretna funkcja JS strony) jest dużo
    // pewniejsze niż po samym tekście „Filtruj” — na stronie może być kilka
    // przycisków o tej samej etykiecie w różnych zakładkach/panelach.
    return document.querySelector('a[href*="wizhist_f_zastosuj_filtr"]');
  }

  function findHistoriaRozwinButton() {
    // Dopasowanie po href (wize_hist_zwin('1')) zamiast po tekście — pewniejsze
    // i odróżnia „Rozwiń wszystkie” od sąsiedniego „Zwiń wszystkie”.
    return document.querySelector('a[href*="wize_hist_zwin(\'1\'"]');
  }

  function isHistoriaWizytListEmpty() {
    // Każdy wiersz wyniku zaczyna się od „Wizyta z dnia: ...” — jeśli tego
    // tekstu nigdzie nie ma, dolna sekcja jest jeszcze pusta (nie filtrowano).
    // Liczone tylko w zakładce HISTORIA WIZYT, do chwili kliknięcia Filtruj
    // i Rozwiń (patrz modHistoriaWizytFiltr).
    return !/wizyta\s+z\s+dnia/i.test(document.body?.textContent || '');
  }

  function modHistoriaWizytFiltr() {
    const btn = findHistoriaFiltrButton();
    if (!isOverlayElementVisible(btn)) {
      historiaFiltrDone = false;
      historiaRozwinDone = false;
      return;
    }

    if (!historiaFiltrDone) {
      if (!isHistoriaWizytListEmpty()) {
        // Lista wyników już jest wypełniona (np. po przełączeniu się między
        // zakładkami) — nie klikamy ponownie, żeby nie zresetować wyniku, i
        // nie ruszamy też „Rozwiń” (mogło być już ręcznie zwinięte/rozwinięte).
        historiaFiltrDone = true;
        historiaRozwinDone = true;
        return;
      }
      historiaFiltrDone = true;
      dbg('modHistoriaWizytFiltr: klik „Filtruj” po wejściu w zakładkę HISTORIA WIZYT');
      btn.click();
      return;
    }

    if (historiaRozwinDone) return;
    if (isHistoriaWizytListEmpty()) return; // czekamy aż lista się wypełni po filtrowaniu

    const rozwinBtn = findHistoriaRozwinButton();
    if (!isOverlayElementVisible(rozwinBtn)) return; // spróbuj ponownie przy kolejnym ticku
    historiaRozwinDone = true;
    dbg('modHistoriaWizytFiltr: klik „Rozwiń wszystkie” po przefiltrowaniu listy HISTORIA WIZYT');
    rozwinBtn.click();
  }

  // Pole „Pacjent” z panelu Edycji wizyty. Dawniej obsługiwało też kopiowanie
  // PESEL-u dwuklikiem — funkcja usunięta w 3.93.0 (wbudowany dwuklik
  // przeglądarki wystarcza). Zostaje jako wykrywacz otwartego panelu wizyty,
  // patrz isEdycjaWizytyOpen().
  function findPacjentPeselField() {
    // ID bywa numerowane per instancja okna (np. wiz_e_pacjent_t_2), więc
    // dopasowujemy prefiks zamiast dokładnego identyfikatora.
    return document.querySelector('input[id^="wiz_e_pacjent_t"]');
  }

  function copyTextToClipboard(text) {
    // WAŻNE: żadnego `await` przed execCommand('copy')! Prawoklik → „Kopiuj”
    // (w pełni synchroniczna operacja przeglądarki) trafia do CopyQ, ale
    // dwuklik z await'em przed execCommand — nie. Firefox po jakimkolwiek
    // `await` w handlerze zdarzenia traci „prawdziwy gest użytkownika”, więc
    // execCommand('copy') wykonany PO await może już nie zapisywać naprawdę
    // do systemowego schowka (CLIPBOARD) — dlatego robimy to jako pierwszą,
    // w pełni synchroniczną operację.
    const el = document.createElement('textarea');
    el.id = 'serum-ui-clipboard-helper'; // patrz OWN_UI_IDS — nie ma wyzwalać ticka
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;';
    document.body.appendChild(el);
    el.focus({ preventScroll: true });
    el.select();

    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      // spróbuj pozostałych metod
    }
    el.remove();

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(text);
        ok = true;
      } catch (_) {
        // brak dalszych opcji
      }
    }

    // Clipboard API jest asynchroniczne z natury — odpalamy je jako dodatkowe
    // wzmocnienie, ale nie czekamy na nie (żeby nie zrywać kontekstu gestu
    // użytkownika dla powyższych, ważniejszych metod).
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }

    return ok;
  }


  // --- LISTA WIZYT: klik w dane pacjenta → Edytuj ---

  const NON_CLICKABLE_COL_NAMES = ['akcja'];
  const colCache = new WeakMap();

  const rowStyle = document.createElement('style');
  rowStyle.textContent = 'td.serum-pacjent-hit { cursor: pointer; }';
  document.documentElement.appendChild(rowStyle);

  // table.rows/tHead/tBodies to natywne, „gotowe” kolekcje przeglądarki —
  // dużo tańsze niż querySelector(All)('tr'/'tbody tr'), które za każdym
  // wywołaniem uruchamiają silnik selektorów CSS po całej tabeli. Te funkcje
  // wołane są na WSZYSTKICH tabelach na stronie, na każdym ticku, więc ta
  // różnica się sumuje.
  function tableBodyRows(table) {
    let rows = [];
    for (const tb of table.tBodies) rows = rows.length ? rows.concat([...tb.rows]) : [...tb.rows];
    return rows;
  }

  // Sama liczba wierszy — bez kopiowania ich do tablicy. isWizytyListTable
  // pyta o nią dla KAŻDEJ tabeli strony na każdym ticku.
  function tableBodyRowCount(table) {
    let n = 0;
    for (const tb of table.tBodies) n += tb.rows.length;
    return n;
  }

  // document.elementFromPoint wymusza pełne przeliczenie układu ORAZ test
  // trafienia dla całego dokumentu. Log z 08.09.2026 pokazał, że to właśnie
  // ono robi z syncTopPager najdroższy moduł ticka (~22 ms przy otwartym
  // panelu wizyty, ticki po 51–56 ms). Przykrycie mini-paginacji zmienia się
  // rzadko — przy otwarciu/zamknięciu okna — a otwarte okno modalne i tak
  // wyłapujemy osobno i natychmiast (jestOtwarteOknoModalne na wejściu do
  // syncTopPager). Odświeżanie tego testu raz na sekundę w zupełności
  // wystarcza, a zdejmuje go z ~95% ticków.
  const ON_TOP_CACHE_MS = 1000;
  const onTopCache = new WeakMap();

  function isOnTopThrottled(el) {
    const teraz = Date.now();
    const zapamietane = onTopCache.get(el);
    if (zapamietane && teraz - zapamietane.at < ON_TOP_CACHE_MS) {
      // Wynik z pamięci może być już nieaktualny (np. przesłona AJAX właśnie
      // zniknęła) — jeden tick tuż po jego wygaśnięciu go odświeży. Dawniej
      // robił to przy okazji interwał co 3 s.
      zaplanujTickZa(zapamietane.at + ON_TOP_CACHE_MS - teraz + 20);
      return zapamietane.wynik;
    }
    const wynik = isOnTop(el);
    onTopCache.set(el, { at: teraz, wynik });
    return wynik;
  }

  // markPatientCells i jestListaWizytNaStronie przelatują TĘ SAMĄ listę tabel
  // na każdym ticku i pytają o to samo. Pamięć jest TRWAŁA (nie tylko na
  // tick), unieważniana podmianą wiersza nagłówka lub zmianą liczby wierszy —
  // ten sam problem co przy tabeli zleceń: .textContent nagłówka
  // tabeli-layoutu serializuje ogromne poddrzewo, a tabela-layout nigdy nie
  // stanie się listą wizyt. Liczba wierszy wchodzi do klucza, bo warunek
  // isWizytyListTableRaw odrzuca tabele puste — bez tego tabela, która dopiero
  // dostała wiersze, zostałaby na zawsze zapamiętana jako „nie lista wizyt”.
  const wizytyListTableCache = new WeakMap();

  function isWizytyListTable(table) {
    const headerRow = table.tHead?.rows[0] || table.rows[0];
    const wierszy = tableBodyRowCount(table);
    const zapamietane = wizytyListTableCache.get(table);
    if (zapamietane && zapamietane.headerRow === headerRow && zapamietane.wierszy === wierszy) {
      return zapamietane.wynik;
    }
    const wynik = isWizytyListTableRaw(table);
    wizytyListTableCache.set(table, { headerRow, wierszy, wynik });
    return wynik;
  }

  function isWizytyListTableRaw(table) {
    const headerRow = table.tHead?.rows[0] || table.rows[0];
    const h = (headerRow?.textContent || '').toLowerCase();
    if (h.includes('historia')) return false;
    if (tableBodyRowCount(table) < 1) return false;
    return h.includes('pacjent') && (h.includes('akcja') || h.includes('pesel') || h.includes('lp'));
  }

  function getPatientColumnIndices(table) {
    if (colCache.has(table)) return colCache.get(table);

    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return new Set();

    const excluded = new Set();
    for (const cell of headerRow.cells) {
      const h = normLabel(cell.textContent).toLowerCase().replace(/:$/, '');
      if (NON_CLICKABLE_COL_NAMES.some((n) => h === n || h.startsWith(n))) {
        excluded.add(cell.cellIndex);
      }
    }

    const indices = new Set();
    for (let i = 0; i < headerRow.cells.length; i++) {
      if (!excluded.has(i)) indices.add(i);
    }

    if (indices.size) colCache.set(table, indices);
    return indices;
  }

  function findEditButton(row) {
    for (const el of row.querySelectorAll('button, a, input[type="button"], input[type="submit"]')) {
      if (normLabel(el.textContent || el.value) === 'Edytuj') return el;
    }
    for (const el of row.querySelectorAll('span, div')) {
      if (el.children.length > 0) continue;
      if (normLabel(el.textContent) === 'Edytuj') return el;
    }
    return null;
  }

  // table -> { firstRow, count } z OSTATNIEGO przebiegu, który faktycznie
  // oznaczał komórki. Jeśli od poprzedniego ticka liczba wierszy w tbody się
  // nie zmieniła I pierwszy wiersz to wciąż TEN SAM węzeł DOM (Serum przy
  // zmianie strony/filtra zwykle podmienia całą zawartość tbody nowymi
  // węzłami, więc identyczność referencji wystarczająco pewnie wykrywa realną
  // zmianę) — wiersze na pewno nie zmieniły się od poprzedniego oznaczania i
  // można pominąć drogie skanowanie „Edytuj” w każdym z nich. Bez tego
  // markPatientCells przeliczał WSZYSTKO od zera na KAŻDYM ticku, także wtedy,
  // gdy tick wywołało coś zupełnie niezwiązanego (np. pisanie w innym polu).
  const patientCellsCache = new WeakMap();

  function markPatientCells() {
    for (const table of tabeleStrony().wizyty) {
      const rows = tableBodyRows(table);
      const cached = patientCellsCache.get(table);
      if (cached && cached.firstRow === rows[0] && cached.count === rows.length) continue;
      patientCellsCache.set(table, { firstRow: rows[0], count: rows.length });

      const cols = getPatientColumnIndices(table);
      for (const row of rows) {
        if (!findEditButton(row)) continue;
        for (const cell of row.cells) {
          if (cols.has(cell.cellIndex)) cell.classList.add('serum-pacjent-hit');
          else cell.classList.remove('serum-pacjent-hit');
        }
      }
    }
  }

  function isEdycjaWizytyOpen() {
    return !!findPacjentPeselField();
  }

  document.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, a, input, select, textarea, label, [role="button"]')) return;

    const cell = event.target.closest('td.serum-pacjent-hit');
    if (!cell) return;

    if (isEdycjaWizytyOpen()) return;

    const row = cell.closest('tbody tr');
    const table = row?.closest('table');
    if (!table || !isWizytyListTable(table)) return;

    const cols = getPatientColumnIndices(table);
    if (!cols.has(cell.cellIndex)) return;

    const editBtn = findEditButton(row);
    if (!editBtn) return;

    event.preventDefault();
    event.stopPropagation();
    dbg('klik wiersz->Edytuj: kolumna=' + cell.cellIndex);
    editBtn.click();
  }, true);

  // --- MINI PAGINACJA OBOK „FILTRUJ” (kopia paginacji z dołu listy wizyt) ---

  const PAGER_TABLE_ID = 'table_div_stronicowanie_wizyty';
  let topPagerEl = null;

  // Okno modalne Serum (np. „DODAWANIE SKIEROWANIA”) to div.przegladarka —
  // ta sama klasa, po której skrypt rozpoznaje inne okna (patrz np. słownik
  // produktów dodatkowych). Dopóki takie okno wisi na ekranie, mini-paginacja
  // (należąca do listy wizyt POD spodem) ma się w ogóle nie pokazywać —
  // niezależnie od tego, gdzie akurat jest przewinięta lista. To prostszy i
  // pewniejszy warunek niż testowanie piksela pod oknem.
  function jestOtwarteOknoModalne() {
    // getElementsByClassName: żywa lista, którą przeglądarka trzyma w pamięci
    // i przelicza tylko po zmianach DOM — zamiast pełnego przelotu selektorem
    // na każdym ticku (pager:oknoModalne 0,59 ms śr., log 28.09).
    for (const w of document.getElementsByClassName('przegladarka')) {
      if (w.tagName === 'DIV' && isOverlayElementVisible(w)) return true;
    }
    return false;
  }

  function isOnTop(el) {
    if (!isOverlayElementVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Element POZA aktualnie przewiniętym widokiem (np. tabela paginacji na
    // dole bardzo długiej listy wizyt, zanim ktokolwiek przewinie w dół) NIE
    // znaczy, że jest przykryty — mini-paginacja istnieje właśnie po to, żeby
    // NIE trzeba było przewijać. elementFromPoint i tak działa wyłącznie w
    // obrębie aktualnie widocznego okna, więc dla punktu poza nim test
    // niczego nie mówi o pokryciu — ufamy, że skoro element realnie ma
    // wymiary (isOverlayElementVisible), jest na wierzchu w swoim miejscu w
    // dokumencie. Dawne klamrowanie testu do brzegu okna (Math.min/Math.max)
    // sprawdzało, co akurat wisi NA KRAWĘDZI — przypadkowy wynik, stąd
    // migotanie przy przewijaniu.
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return true;
    const topEl = document.elementFromPoint(cx, cy);
    if (!topEl) return true;
    return topEl === el || el.contains(topEl) || topEl.contains(el);
  }

  // Serum potrafi mieć w DOM jednocześnie kilka widocznych przycisków
  // „Filtruj” (np. na liście pacjentów I w zakładce HISTORIA WIZYT otwartej
  // wizyty — patrz modHistoriaWizytFiltr). Bez ograniczenia szukania do
  // panelu zawierającego TĘ konkretną tabelę paginacji, mini-paginacja
  // migotała/przeskakiwała między nimi i doczepiała się do przycisku z
  // innej karty niż lista pacjentów. Wspinamy się od tabeli w górę i bierzemy
  // NAJMNIEJSZEGO przodka, w którym w ogóle jest widoczny „Filtruj”.
  function findFiltrujButtonNear(table) {
    // Szybka ścieżka — potwierdzone inspektorem na liście wizyt:
    //   <a class="a_akc" href="javascript:wiz_f_zastosuj_filtr(1);">Filtruj</a>
    // (wariant z HISTORII WIZYT ma inną funkcję: wizhist_f_zastosuj_filtr,
    // więc href jednoznacznie odróżnia właściwy przycisk — a to właśnie o ten
    // z listy wizyt chodzi, bo obok niego umieszczamy górną paginację).
    const byHref = document.querySelector('a[href*="wiz_f_zastosuj_filtr"]');
    if (byHref) {
      // NAJDROŻSZA LINIJKA CAŁEGO SKRYPTU (log 09.09.2026): 13,84 ms średnio,
      // 10642 wywołania, 147 SEKUND — 30% całego czasu uiTick. Dawniej, gdy
      // przycisk był znaleziony, ale PRZYKRYTY (panel wizyty otwarty przez
      // większość dnia), spadaliśmy w awaryjny skan całego dokumentu po
      // div/span z serializacją textContent każdego z nich. A ten skan i tak
      // mógł znaleźć wyłącznie ten sam, przykryty przycisk. Przycisk istnieje
      // i jest zasłonięty = mini-paginacja ma się nie pokazywać, kropka.
      return isOnTopThrottled(byHref) ? byHref : null;
    }

    // Skan awaryjny — TYLKO gdy przycisku o znanym href w ogóle nie ma w DOM
    // (nieznany wariant ekranu). Bez div i span: „Filtruj” w Serum to
    // <a class="a_akc">, a to właśnie div/span kosztowały tu najwięcej, bo
    // normLabel(textContent) serializuje całe poddrzewo każdego z nich.
    // Jeden skan dokumentu zamiast dwudziestu skanów coraz większych
    // poddrzew. Wcześniej dla KAŻDEGO z 20 poziomów przodków uruchamiany był
    // pełny querySelectorAll obejmujący m.in. div i span — a na najwyższych
    // poziomach to praktycznie skan całej strony, powtarzany na każdym ticku
    // (syncTopPager działa na głównej liście wizyt, czyli tam, gdzie
    // spędzasz najwięcej czasu). querySelectorAll zwraca węzły w kolejności
    // dokumentu, więc „pierwszy kandydat zawarty w danym zakresie” daje
    // dokładnie ten sam wynik co dawne findFiltrujButton(scope).
    const candidates = [];
    for (const el of document.querySelectorAll('button, input[type="button"], input[type="submit"], a')) {
      if (normLabel(el.textContent || el.value) !== 'Filtruj') continue;
      candidates.push(el);
    }
    if (!candidates.length) return null;

    // isOnTop() woła elementFromPoint (test trafienia + wymuszony układ),
    // więc liczymy je leniwie, dopiero dla kandydata z właściwego zakresu.
    const onTop = new Map();
    const checkOnTop = (el) => {
      let v = onTop.get(el);
      if (v === undefined) {
        v = isOnTop(el);
        onTop.set(el, v);
      }
      return v;
    };

    let scope = table;
    for (let depth = 0; depth < 20 && scope; depth++) {
      for (const el of candidates) {
        // el !== scope — jak wyżej: dawne findFiltrujButton(scope) opierało się
        // na querySelectorAll, czyli wyłącznie na potomkach zakresu.
        if (el !== scope && scope.contains(el) && checkOnTop(el)) return el;
      }
      scope = scope.parentElement;
    }
    return null;
  }

  function findPagerTable() {
    const table = document.getElementById(PAGER_TABLE_ID);
    return table && isOnTopThrottled(table) ? table : null;
  }

  function findPagerCells(table) {
    return [...table.querySelectorAll('td')].filter((td) => /^\d+$/.test(normLabel(td.textContent)));
  }

  function positionTopPager(panel, filtrujBtn) {
    const rect = filtrujBtn.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const top = rect.top + window.scrollY + (rect.height - panelRect.height) / 2;
    const left = rect.left + window.scrollX - panelRect.width - 8;
    setStyleIfChanged(panel, 'top', Math.max(0, Math.round(top)) + 'px');
    setStyleIfChanged(panel, 'left', Math.max(0, Math.round(left)) + 'px');
  }

  // Serum potrafi otwierać niektóre ekrany (np. RECEPTY/E-RECEPTY) jako
  // ZUPEŁNIE OSOBNE okno przeglądarki pod tym samym adresem — skrypt
  // wstrzykuje się tam od nowa, niezależnie od głównej karty z listą wizyt.
  // jestOtwarteOknoModalne() nic tam nie znajdzie (to nie jest div.przegladarka
  // w TEJ karcie, tylko inne okno), a mimo to bywa w nim element o tym samym
  // id="table_div_stronicowanie_wizyty" (Serum najwyraźniej używa tego
  // samego, generycznego szablonu paginacji na różnych ekranach) — stąd
  // mini-paginacja potrafiła wyskoczyć i tam. Dlatego dodatkowo wymagamy
  // TREŚCIOWEGO dowodu, że to naprawdę lista wizyt: gotowa funkcja
  // isWizytyListTable() (już używana przez klik-wiersz->Edytuj) rozpoznaje ją
  // po nagłówkach kolumn („pacjent” + „akcja”/„pesel”/„lp”), a nie po samym id.
  function jestListaWizytNaStronie() {
    return tabeleStrony().wizyty.length > 0;
  }

  function syncTopPager() {
    // Najtańszy możliwy warunek NA POCZĄTKU: bez tabeli paginacji w DOM cała
    // reszta (skan div.przegladarka z getComputedStyle na każdym + przelot po
    // wszystkich tabelach strony) jest bezcelowa. Na ekranie edycji wizyty i
    // w oknie recept tej tabeli nie ma, a mimo to płaciliśmy pełną cenę na
    // każdym ticku.
    if (mierz('pager:bramka', () => oknoReceptOtwarte() || !document.getElementById(PAGER_TABLE_ID))) {
      topPagerEl?.remove();
      topPagerEl = null;
      return;
    }

    if (mierz('pager:oknoModalne', jestOtwarteOknoModalne)) {
      topPagerEl?.remove();
      topPagerEl = null;
      return;
    }
    if (!mierz('pager:listaWizyt', jestListaWizytNaStronie)) {
      topPagerEl?.remove();
      topPagerEl = null;
      return;
    }

    const table = mierz('pager:findPagerTable', findPagerTable);
    const cells = table ? mierz('pager:findPagerCells', () => findPagerCells(table)) : [];
    const filtrujBtn = table ? mierz('pager:findFiltruj', () => findFiltrujButtonNear(table)) : null;

    if (!filtrujBtn || cells.length < 2) {
      topPagerEl?.remove();
      topPagerEl = null;
      return;
    }

    const signature = mierz('pager:sygnatura', () => cells
      .map((td) => normLabel(td.textContent) + (td.querySelector('.klocek') ? 'L' : 'A'))
      .join(','));

    if (topPagerEl?.isConnected && topPagerEl.dataset.sig === signature) {
      mierz('pager:pozycjonowanie', () => positionTopPager(topPagerEl, filtrujBtn));
      return;
    }

    topPagerEl?.remove();
    topPagerEl = document.createElement('div');
    topPagerEl.id = 'serum-ui-top-pager';
    topPagerEl.dataset.sig = signature;
    topPagerEl.style.cssText = 'position:absolute; z-index:2147483000; display:flex; gap:4px;';

    for (const td of cells) {
      const klocek = td.querySelector('.klocek');
      let item;
      if (klocek) {
        item = klocek.cloneNode(true);
      } else {
        item = document.createElement('div');
        item.className = 'klocek';
        item.textContent = normLabel(td.textContent);
        item.style.cursor = 'default';
        item.style.opacity = '0.6';
      }
      topPagerEl.appendChild(item);
    }

    document.body.appendChild(topPagerEl);
    mierz('pager:przebudowa+pozycja', () => positionTopPager(topPagerEl, filtrujBtn));
  }

  // --- LABORATORIUM: przycisk „Skopiuj ostatnie wyniki” (fallback gdy 10.1.1.140 nie działa) ---
  // Te same reguły formatowania/oznaczania poza normą co lab-to-serum.user.js
  // (kopiowanie z 10.1.1.140), tylko źródło danych to podgląd „PODGLĄD WYNIKÓW”
  // otwierany przyciskiem „Wyniki” w tabeli zleceń zakładki LABORATORIUM.

  const CONFIG_LAB = {
    outOfRangeMarker: ' <<-------',
    excludeResultNames: ['Ilość glukozy'],
    resultGroups: [
      { id: 'thyroid', names: ['TSH', 'FT3', 'FT4', 'fT3', 'fT4'] },
      { id: 'b12', names: ['B12', 'witamina B12', 'kwas foliowy', 'folian', 'homocysteina'] },
      {
        id: 'iron',
        names: [
          'żelazo', 'TIBC', 'ferrytyna', 'ferritin', 'ferritina', '=FER',
          'transferyna', 'wysycenie transferyny', 'sat. transferyny',
        ],
      },
      { id: 'calcium', names: ['wapń', 'wapń zjonizowany', 'Witamina D3 Tot (25-OH)'] },
      {
        id: 'glucoseInsulin',
        names: [
          'Glukoza na czczo', 'Glukoza po 120 min', 'Glukoza 120 min', 'Glukoza',
          'Insulina na czczo', 'Insulina po 120 min', 'Insulina',
        ],
      },
      { id: 'crpFibrynogen', names: ['CRP', 'białko C-reaktywne', 'fibrynogen'] },
    ],
    morphologyKeyParams: [
      'WBC', 'RBC', 'HGB', 'MPV', 'MCV', 'MCH', 'PLT', 'HCT', 'RDW',
      'hematokryt', 'leukocyty', 'erytrocyty', 'hemoglobina', 'płytki krwi', 'trombocyty',
    ],
    morphologyDiffCountParams: ['NEU', 'LYM', 'MON', 'MONO', 'EOS', 'EO', 'BAS', 'BAZO', 'IG', 'GRA'],
    morphologyOtherHints: [
      'neu%', 'neu %', 'lym%', 'lym %', 'mono%', 'eo%', 'eos%', 'eoz%', 'bas%', 'bazo%', 'mon%',
      'neutro', 'limf', 'mono', 'eozyn', 'bazof', 'mchc', 'pdw', 'retikul', 'nrbc', 'blast',
      'aniz', 'poik', 'niedojrz', 'jac3', 'ig#', 'ig %',
    ],
    morphologyDeviationRatio: 0.4,
    obParamNames: ['OB', 'O.B.', 'odczyn biernackiego'],
    absoluteThresholds: [
      { names: ['CRP'], aboveOrEqual: 0.6 },
      { names: ['fibrynogen'], aboveOrEqual: 2.7 },
      { names: ['B12', 'witamina B12'], below: 550 },
      { names: ['kwas foliowy', 'folian'], below: 15 },
      { names: ['homocysteina'], above: 7.5 },
      { names: ['Witamina D3 Tot (25-OH)'], below: 50 },
      { names: ['TSH'], above: 3 },
      {
        names: ['FT4', 'fT4', 'FT-4', 'Free T4', 'tyroksyna wolna', 'T4 wolna'],
        excludeNames: ['FT3', 'fT3'],
        below: 16,
      },
      { names: ['żelazo', 'zelazo'], below: 13.0 },
      {
        names: ['ferrytyna', 'ferritin', 'ferritina', 'Ferrytyna w surowicy', '=FER'],
        excludeNames: ['transferyna', 'wysycenie transferyny', 'żelazo', 'zelazo'],
        below: 40,
      },
      {
        names: ['potas', 'kaliemia', 'Potas w surowicy', 'Potas (K)', '=K', '=K+'],
        excludeNames: ['kwas foliowy', 'folian'],
        belowOrEqual: 4.4,
      },
      { names: ['OB', 'O.B.', 'odczyn biernackiego'], above: 15 },
      { names: ['Insulina po 120 min'], above: 29, exclusive: true },
      { names: ['Insulina na czczo', 'Insulina'], aboveOrEqual: 9 },
    ],
  };

  function normalizeLabText(text) {
    return (text || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeParamName(name) {
    return normalizeLabText(name)
      .toLowerCase()
      .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
      .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
      .replace(/[-–—:]/g, '')
      .replace(/\s+/g, '');
  }

  function getParamCoreName(nazwa) {
    const base = normalizeParamName(nazwa).split(/[\(\[]/)[0];
    const match = base.match(/^[a-z0-9+]+/);
    return match ? match[0] : base;
  }

  function paramNameMatches(nazwa, patterns) {
    const normalized = normalizeParamName(nazwa);
    const core = getParamCoreName(nazwa);
    return patterns.some((pattern) => {
      if (pattern.startsWith('=')) {
        const exactTarget = normalizeParamName(pattern.slice(1));
        return core === exactTarget || normalized === exactTarget;
      }
      const target = normalizeParamName(pattern);
      return normalized === target || normalized.includes(target) || core.includes(target);
    });
  }

  function isPotassiumParam(nazwa) {
    if (/kwas\s*foli|folian/i.test(nazwa)) return false;
    const normalized = normalizeParamName(nazwa);
    const core = getParamCoreName(nazwa);
    if (core === 'k' || core.startsWith('k+')) return true;
    return /potas|kaliemia|kalium/.test(normalized);
  }

  function isFt4Param(nazwa) {
    if (getParamCoreName(nazwa) === 'ft3') return false;
    const normalized = normalizeParamName(nazwa);
    return (
      normalized.includes('ft4') || normalized.includes('freet4') ||
      normalized.includes('tyroksynawolna') || normalized.includes('t4wolna')
    );
  }

  function isTotalCholesterolParam(nazwa) {
    const normalized = normalizeParamName(nazwa);
    if (!normalized.includes('cholesterol')) return false;
    if (normalized.includes('hdl') || normalized.includes('ldl') || normalized.includes('niehdl') || normalized.includes('nonhdl')) {
      return false;
    }
    return normalized === 'cholesterol';
  }

  function isLdlCholesterolParam(nazwa) {
    const normalized = normalizeParamName(nazwa);
    return normalized.includes('cholesterolldl') || normalized === 'ldlcholesterol';
  }

  function isMorphologyKeyParam(nazwa) {
    return paramNameMatches(nazwa, CONFIG_LAB.morphologyKeyParams);
  }

  function isPercentUnit(jednostka) {
    const unit = normalizeLabText(jednostka).toLowerCase();
    return unit === '%' || unit.includes('%');
  }

  function isMorphologyPercentParam(nazwa, jednostka = '') {
    const normalized = normalizeParamName(nazwa);
    if (!/%/.test(normalized) && !isPercentUnit(jednostka)) return false;
    return /^(neu|lym|mono|mon|eos|eo|eoz|bas|baz|bazo|ret|ig|gra|nrbc)/.test(normalized);
  }

  function isMorphologyDiffCountParam(nazwa, jednostka = '') {
    if (/%/.test(normalizeParamName(nazwa)) || isPercentUnit(jednostka)) return false;
    const core = getParamCoreName(nazwa);
    if (/^(neu|lym|mono|mon|eos|eo|eoz|bas|baz|bazo|ig|gra)$/.test(core)) return true;
    return CONFIG_LAB.morphologyDiffCountParams.some((pattern) => core === normalizeParamName(pattern));
  }

  function isMorphologyFortyPercentParam(nazwa, jednostka = '') {
    if (isMorphologyKeyParam(nazwa)) return false;
    if (isMorphologyPercentParam(nazwa, jednostka)) return true;
    if (isMorphologyDiffCountParam(nazwa, jednostka)) return true;
    return paramNameMatches(nazwa, CONFIG_LAB.morphologyOtherHints);
  }

  function isObParam(nazwa) {
    return paramNameMatches(nazwa, CONFIG_LAB.obParamNames);
  }

  function isMorphologyParam(nazwa, jednostka = '') {
    if (isObParam(nazwa)) return false;
    return isMorphologyKeyParam(nazwa) || isMorphologyFortyPercentParam(nazwa, jednostka);
  }

  function parseResultNumber(text) {
    let value = normalizeLabText(text);
    if (!value) return NaN;
    value = value.replace(/[​-‍﻿]/g, '').replace(/^[<>=≤≥]+/g, '').trim();
    const token = value.match(/-?\d+(?:[.,]\d+)?/);
    if (!token) return NaN;
    let raw = token[0];
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (lastComma >= 0) {
      raw = raw.replace(',', '.');
    }
    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : NaN;
  }

  function parseNormRange(normy) {
    const value = normalizeLabText(normy);
    if (!value) return null;
    const range = value.match(/([\d.,]+)\s*-\s*([\d.,]+)/);
    if (range) return { type: 'range', low: parseResultNumber(range[1]), high: parseResultNumber(range[2]) };
    const maxOnly = value.match(/^(?:do\s+|<\s*|≤\s*|max\.?\s*)([\d.,]+)/i);
    if (maxOnly) return { type: 'max', high: parseResultNumber(maxOnly[1]) };
    const minOnly = value.match(/^(?:>\s*|≥\s*|min\.?\s*)([\d.,]+)/i);
    if (minOnly) return { type: 'min', low: parseResultNumber(minOnly[1]) };
    return null;
  }

  function formatNormy(normy) {
    const value = normalizeLabText(normy);
    if (!value) return '';
    if (/^do\s+/i.test(value)) return value;
    return value.replace(/([\d.,]+)\s*-\s*([\d.,]+)/g, '$1 - $2');
  }

  function matchesAbsoluteThreshold(nazwa, value) {
    if (Number.isNaN(value)) return false;
    if (isPotassiumParam(nazwa) && value <= 4.4) return true;
    if (isFt4Param(nazwa) && value < 16) return true;
    if (isTotalCholesterolParam(nazwa)) return value > 8.0 || value < 4.4;
    if (isLdlCholesterolParam(nazwa)) return value > 3.3;

    const rules = CONFIG_LAB.absoluteThresholds;
    const exclusiveRule = rules.find((rule) => rule.exclusive && paramNameMatches(nazwa, rule.names));
    const applicableRules = exclusiveRule ? [exclusiveRule] : rules;

    for (const rule of applicableRules) {
      if (!paramNameMatches(nazwa, rule.names)) continue;
      if (rule.excludeNames && paramNameMatches(nazwa, rule.excludeNames)) continue;
      if (rule.aboveOrEqual !== undefined && value >= rule.aboveOrEqual) return true;
      if (rule.above !== undefined && value > rule.above) return true;
      if (rule.below !== undefined && value < rule.below) return true;
      if (rule.belowOrEqual !== undefined && value <= rule.belowOrEqual) return true;
    }
    return false;
  }

  function isStandardOutOfRange(value, range) {
    if (Number.isNaN(value) || !range) return false;
    if (range.type === 'range') {
      if (!Number.isNaN(range.low) && value < range.low) return true;
      if (!Number.isNaN(range.high) && value > range.high) return true;
      return false;
    }
    if (range.type === 'max' && !Number.isNaN(range.high)) return value > range.high;
    if (range.type === 'min' && !Number.isNaN(range.low)) return value < range.low;
    return false;
  }

  function isFortyPercentOutOfRange(value, range) {
    if (Number.isNaN(value) || !range) return false;
    const ratio = CONFIG_LAB.morphologyDeviationRatio;
    if (range.type === 'range') {
      if (!Number.isNaN(range.low) && range.low > 0 && (range.low - value) / range.low >= ratio) return true;
      if (!Number.isNaN(range.high) && range.high > 0 && (value - range.high) / range.high >= ratio) return true;
      return false;
    }
    if (range.type === 'max' && !Number.isNaN(range.high) && range.high > 0) {
      return (value - range.high) / range.high >= ratio;
    }
    if (range.type === 'min' && !Number.isNaN(range.low) && range.low > 0) {
      return (range.low - value) / range.low >= ratio;
    }
    return false;
  }

  function shouldMarkOutOfRange({ nazwa, jednostka, wartosc, normy }) {
    const value = parseResultNumber(wartosc);
    if (Number.isNaN(value)) return false;
    if (matchesAbsoluteThreshold(nazwa, value)) return true;
    if (isTotalCholesterolParam(nazwa) || isLdlCholesterolParam(nazwa)) return false;

    const range = parseNormRange(normy);
    if (isUricAcidOverNinetyPercent(nazwa, value, range)) return true;
    if (isMorphologyKeyParam(nazwa)) return isStandardOutOfRange(value, range);
    if (isMorphologyFortyPercentParam(nazwa, jednostka)) return isFortyPercentOutOfRange(value, range);
    return isStandardOutOfRange(value, range);
  }

  // Kwas moczowy: oznaczamy już powyżej 90% zakresu normy (dół zakresu = 0%,
  // góra = 100%), np. norma 140-340 → próg 320, więc 336 dostaje znacznik
  // mimo że formalnie mieści się w normie. Wyjście poza zakres łapie dalej
  // standardowa reguła.
  function isUricAcidOverNinetyPercent(nazwa, value, range) {
    if (!paramNameMatches(nazwa, ['kwas moczowy'])) return false;
    if (!range || range.type !== 'range' || Number.isNaN(range.low) || Number.isNaN(range.high)) return false;
    if (range.high <= range.low) return false;
    return value > range.low + 0.9 * (range.high - range.low);
  }

  function formatResultLine({ nazwa, jednostka, wartosc, normy }) {
    let line = nazwa + '  ' + wartosc;
    if (jednostka) line += ' ' + jednostka;
    const formattedNormy = formatNormy(normy);
    if (formattedNormy) line += ' (' + formattedNormy + ')';
    if (shouldMarkOutOfRange({ nazwa, jednostka, wartosc, normy })) line += CONFIG_LAB.outOfRangeMarker;
    return line;
  }

  function shouldExcludeLabResult({ nazwa }) {
    const normalizedName = normalizeLabText(nazwa).toLowerCase();
    return CONFIG_LAB.excludeResultNames.some((excluded) => {
      const normalizedExcluded = normalizeLabText(excluded).toLowerCase();
      return normalizedName === normalizedExcluded || normalizedName.includes(normalizedExcluded);
    });
  }

  function findResultGroup(nazwa) {
    const normalized = normalizeParamName(nazwa);
    for (const group of CONFIG_LAB.resultGroups) {
      for (const pattern of group.names) {
        const target = normalizeParamName(pattern);
        if (normalized === target || normalized.includes(target) || target.includes(normalized)) return group.id;
      }
    }
    return null;
  }

  function getOrderInGroup(groupId, nazwa) {
    const group = CONFIG_LAB.resultGroups.find((item) => item.id === groupId);
    if (!group) return 999;
    const normalized = normalizeParamName(nazwa);
    let best = 999;
    group.names.forEach((pattern, index) => {
      const target = normalizeParamName(pattern);
      if (normalized === target || normalized.includes(target) || target.includes(normalized)) {
        best = Math.min(best, index);
      }
    });
    return best;
  }

  function extractParamNameFromLine(line) {
    const match = line.match(/^(.+?)\s{1,2}[\d,<≥>]/);
    return match ? normalizeLabText(match[1]) : normalizeLabText(line.split(/\s+/)[0] || '');
  }

  function addObMorphologySeparator(prevLine, nextLine) {
    if (!prevLine || !nextLine) return false;
    const prevName = extractParamNameFromLine(prevLine);
    const nextName = extractParamNameFromLine(nextLine);
    const prevOb = isObParam(prevName);
    const nextOb = isObParam(nextName);
    const prevMorph = isMorphologyParam(prevName);
    const nextMorph = isMorphologyParam(nextName);
    return (prevOb && nextMorph) || (prevMorph && nextOb);
  }

  function joinBatchLines(items) {
    const sorted = [...items].sort((a, b) => a.collectOrder - b.collectOrder);
    const lines = [];
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      if (i > 0) {
        const prev = sorted[i - 1];
        const prevMorph = isMorphologyParam(prev.nazwa, prev.jednostka);
        const currMorph = isMorphologyParam(item.nazwa, item.jednostka);
        // Blok morfologii oddzielamy pustym wierszem od WSZYSTKICH pozostałych
        // wyników (dawniej tylko od OB) — pusty wiersz przy każdym wejściu
        // w morfologię (np. nad WBC) i wyjściu z niej. Pod OB też pusty wiersz.
        const prevOb = isObParam(prev.nazwa);
        const currOb = isObParam(item.nazwa);
        if (prevMorph !== currMorph || (prevOb && !currOb)) lines.push('');
      }
      lines.push(item.line);
    }
    return lines.join('\n');
  }

  function buildLabResultsBody(rows) {
    if (!rows.length) return '';

    const groupedLines = new Map();
    const ungroupedBatches = new Map();

    for (const row of rows) {
      const line = formatResultLine(row);
      const groupId = row.bezGrupy ? null : findResultGroup(row.nazwa);
      if (groupId) {
        if (!groupedLines.has(groupId)) groupedLines.set(groupId, []);
        groupedLines.get(groupId).push({ order: getOrderInGroup(groupId, row.nazwa), collectOrder: row.collectOrder, line });
      } else {
        if (!ungroupedBatches.has(row.batchId)) ungroupedBatches.set(row.batchId, []);
        ungroupedBatches.get(row.batchId).push({ nazwa: row.nazwa, jednostka: row.jednostka, collectOrder: row.collectOrder, line });
      }
    }

    const sectionBodies = [];
    for (const group of CONFIG_LAB.resultGroups) {
      const items = groupedLines.get(group.id);
      if (!items?.length) continue;
      items.sort((a, b) => a.order - b.order || a.collectOrder - b.collectOrder);
      sectionBodies.push({ sortKey: Math.min(...items.map((item) => item.collectOrder)), text: items.map((item) => item.line).join('\n') });
    }
    for (const items of ungroupedBatches.values()) {
      sectionBodies.push({ sortKey: Math.min(...items.map((item) => item.collectOrder)), text: joinBatchLines(items) });
    }
    sectionBodies.sort((a, b) => a.sortKey - b.sortKey);

    const parts = [];
    for (let i = 0; i < sectionBodies.length; i++) {
      const text = sectionBodies[i].text;
      if (!text) continue;
      if (i > 0 && parts.length) {
        const prevText = parts[parts.length - 1];
        const prevLines = prevText.split('\n').filter((l) => l.trim());
        const currLines = text.split('\n').filter((l) => l.trim());
        if (addObMorphologySeparator(prevLines[prevLines.length - 1], currLines[0])) {
          parts[parts.length - 1] = `${prevText}\n`;
        }
      }
      parts.push(text);
    }
    return parts.join('\n\n');
  }

  // --- DOM: tabela zleceń LABORATORIUM + podgląd „PODGLĄD WYNIKÓW” ---

  let labCopyBtnEl = null;
  let labCopyRunning = false;
  let labHeadingCache = null;
  let labPopupTableCache = null;

  // Wynik per TABELA, ważny dopóki nie podmieni się jej wiersz nagłówka.
  // Serum buduje układ strony z zagnieżdżonych tabel, więc .textContent
  // pierwszego wiersza tabeli-layoutu serializuje pół dokumentu. W logu z
  // 09.09.2026 ta funkcja kosztowała 12,11 ms średnio i 129 SEKUND łącznie —
  // druga najdroższa linijka skryptu. Tabela-layout nigdy nie stanie się
  // tabelą zleceń, więc odpowiedź wystarczy policzyć raz.
  const labOrdersTableCache = new WeakMap();

  function isLabOrdersTable(t) {
    const headerRow = t.tHead?.rows[0] || t.rows[0];
    const zapamietane = labOrdersTableCache.get(t);
    if (zapamietane && zapamietane.headerRow === headerRow) return zapamietane.wynik;
    // textContent zamiast innerText — innerText wymusza synchroniczny
    // reflow (musi znać faktyczny, wyrenderowany układ), a tu liczy się
    // tylko obecność słów kluczowych w nagłówku.
    const h = normalizeLabText(headerRow?.textContent || '').toLowerCase();
    const wynik = h.includes('numer zlecenia') && h.includes('zlecone badania');
    labOrdersTableCache.set(t, { headerRow, wynik });
    return wynik;
  }

  function findLabOrdersTable() {
    // Bez bramki po tekście całego <body> — ta wymagała serializacji ~10 mln
    // znaków. Tabele klasyfikuje jeden wspólny przelot na tick (tabeleStrony),
    // a ocena każdej tabeli jest zapamiętana (labOrdersTableCache).
    return tabeleStrony().lab;
  }

  function findLabRowWynikButton(row) {
    const candidates = [...row.querySelectorAll('a, button, input[type="button"], [role="button"]')];
    return candidates.find((el) => normalizeLabText(el.textContent || el.value).toLowerCase() === 'wyniki') || null;
  }

  function findLabOrderApprovalColumnIndex(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    const cells = [...(headerRow?.querySelectorAll('th, td') || [])];
    return cells.findIndex((c) => normalizeLabText(c.textContent).toLowerCase().includes('czas zatwierdzenia'));
  }

  // Sama data (bez godziny/minuty) z „Czas zatwierdzenia” — to pole to
  // faktycznie data WYKONANIA badania, nie moment zatwierdzenia całego
  // zlecenia w systemie. Osobne zlecenia z tego samego dnia bywają
  // zatwierdzane o różnych godzinach, więc grupowanie po dniu (nie po
  // dokładnym znaczniku czasu) jest tym, co faktycznie odpowiada „ostatnim
  // wynikom” z wizyty.
  function parseLabOrderDateOnly(raw) {
    const m = normalizeLabText(raw).match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!m) return 0;
    const [, d, mo, y] = m;
    return new Date(+y, +mo - 1, +d).getTime();
  }

  // Pacjent może mieć ostatnie wyniki rozbite na KILKA osobnych zleceń
  // zatwierdzonych tego samego dnia, ale o różnych godzinach (np. jedno na
  // 8/9, drugie na 25/25 parametrów) — branie tylko pierwszego wiersza z
  // przyciskiem „Wyniki”, albo grupowanie po dokładnym znaczniku czasu
  // (co do minuty), kopiowało wtedy tylko część wyników. Zwracamy przyciski
  // wszystkich zleceń, których „Czas zatwierdzenia” wypada na najnowszy DZIEŃ
  // (ex aequo dozwolone, niezależnie od godziny).
  function findLatestWynikiButtons(table) {
    const approvalColIdx = findLabOrderApprovalColumnIndex(table);
    const rows = [...table.querySelectorAll('tbody tr, tr')].filter((r) => !r.querySelector('th'));
    const entries = [];
    for (const row of rows) {
      const btn = findLabRowWynikButton(row);
      if (!btn) continue;
      const cells = [...row.querySelectorAll('td')];
      const dateRaw = approvalColIdx >= 0 ? cells[approvalColIdx]?.textContent : '';
      entries.push({ btn, day: parseLabOrderDateOnly(dateRaw) });
    }
    if (!entries.length) return [];
    const maxDay = Math.max(...entries.map((e) => e.day));
    // Brak/nieparsowalna data zatwierdzenia — bezpieczniej wziąć wszystkie
    // dostępne zlecenia niż zgadywać, które jest „ostatnie”.
    if (maxDay <= 0) return entries.map((e) => e.btn);
    return entries.filter((e) => e.day === maxDay).map((e) => e.btn);
  }

  // \s w JS łapie też twardą spację ( ), a [ĄA]/[ÓO] pokrywa zapis bez
  // polskich znaków — dzięki temu test działa na SUROWYM textContent i nie
  // trzeba alokować znormalizowanego stringa dla każdego elementu strony.
  const RE_PODGLAD_WYNIKOW = /PODGL[ĄA]D\s+WYNIK[ÓO]W/i;

  function isPodgladWynikowHeadingEl(el) {
    return el.children.length === 0 && RE_PODGLAD_WYNIKOW.test(el.textContent || '');
  }

  function findPodgladWynikowHeading() {
    // Po kilku otwarciach w tej samej sesji na stronie mogą zostać STARE,
    // niewidoczne kopie tego nagłówka (Serum nie usuwa ich z DOM) — branie
    // pierwszej napotkanej (bez sprawdzenia widoczności) mogło trafiać na
    // martwą kopię i błędnie uznawać, że podgląd jest już zamknięty, mimo że
    // inna (nowsza) kopia była akurat widoczna na ekranie.
    //
    // WYDAJNOŚĆ: ta funkcja siedzi w pętli odpytywania (co kilkadziesiąt ms,
    // przy każdym zleceniu), a dawniej robiła querySelectorAll('*') po CAŁEJ
    // stronie i normalizowała textContent każdego liścia — to były tysiące
    // alokacji stringów na jedno sprawdzenie. Teraz: (1) trafienie z ostatniego
    // razu, jeśli wciąż pasuje, (2) tytuły okien span.h3_tytul (okno zamyka
    // div.div_close → uf_schowaj_div, czyli okno uf_pokaz_div, a to buduje
    // tytuł właśnie tak — źródło strony), (3) wąskie selektory. Dawny pełny
    // skan querySelectorAll('*') co 40 ms w czasie czekania na okno — usunięty.
    if (labHeadingCache?.isConnected && isPodgladWynikowHeadingEl(labHeadingCache) &&
        isOverlayElementVisible(labHeadingCache)) {
      return labHeadingCache;
    }

    let candidates = [...document.getElementsByClassName('h3_tytul')].filter(isPodgladWynikowHeadingEl);
    if (!candidates.length) candidates = [...document.querySelectorAll('span, td, div, b, font')].filter(isPodgladWynikowHeadingEl);

    const heading = candidates.find((el) => isOverlayElementVisible(el)) || candidates[candidates.length - 1] || null;
    labHeadingCache = heading;
    return heading;
  }

  function isResultsPopupTableEl(t) {
    // textContent zamiast innerText — innerText wymusza synchroniczny reflow
    // (przeglądarka musi przeliczyć układ strony), a tu liczy się wyłącznie
    // obecność słów w nagłówku tabeli.
    const headerRow = t.querySelector('tr');
    return normalizeLabText(headerRow?.textContent || '').toLowerCase().includes('nazwa parametru');
  }

  function findResultsPopupTable() {
    if (labPopupTableCache?.isConnected && isOverlayElementVisible(labPopupTableCache) &&
        isResultsPopupTableEl(labPopupTableCache)) {
      return labPopupTableCache;
    }

    const heading = findPodgladWynikowHeading();
    if (!heading) return null;
    let container = heading;
    for (let depth = 0; depth < 15 && container; depth++) {
      const candidates = [...container.querySelectorAll('table')].filter(isResultsPopupTableEl);
      const table = candidates.find((t) => isOverlayElementVisible(t)) || candidates[candidates.length - 1];
      if (table) {
        labPopupTableCache = table;
        return table;
      }
      container = container.parentElement;
    }
    return null;
  }

  function getResultsPopupSignature(table = findResultsPopupTable()) {
    if (!table) return '';
    const rows = table.rows?.length ? [...table.rows] : [...table.querySelectorAll('tr')];
    return rows.length + '|' + normalizeLabText(rows[rows.length - 1]?.textContent || '').slice(0, 60);
  }

  function formatLabDate(raw) {
    const m = normalizeLabText(raw).match(/^(\d{2})-(\d{2})-(\d{4})/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  }

  function parseLabResultRow(row) {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length < 8) return null; // wiersze nagłówka/sekcji mają <th> lub 1-2 <td>
    const nazwa = normalizeLabText(cells[0]?.innerText);
    const jednostka = normalizeLabText(cells[1]?.innerText);
    const normy = normalizeLabText(cells[2]?.innerText);
    const wartosc = normalizeLabText(cells[3]?.innerText);
    const czasWykonania = normalizeLabText(cells[6]?.innerText);
    if (!nazwa || !wartosc) return null;
    return { nazwa, jednostka, normy, wartosc, czasWykonania };
  }

  // Przechodzi po wierszach tabeli podglądu, pamiętając nazwę bieżącej sekcji
  // (wiersze nagłówków paneli, np. „Badanie ogólne moczu (10045)”, mają mniej
  // niż 8 komórek i parseLabResultRow je pomija). Nazwa sekcji jest potrzebna,
  // żeby odróżnić parametry moczu od krwi — np. „Glukoza” z moczu nie może
  // wpaść do grupy glukoza/insulina z krwi.
  function extractLabResultRows(popupTable) {
    const out = [];
    let sekcja = '';
    for (const tr of popupTable.querySelectorAll('tr')) {
      const parsed = parseLabResultRow(tr);
      if (parsed) {
        out.push({ ...parsed, sekcja });
        continue;
      }
      const cells = tr.querySelectorAll('td');
      if (cells.length && cells.length < 4) {
        const text = normalizeLabText(tr.innerText);
        if (text) sekcja = text;
      }
    }
    return out;
  }

  function isUrineLabRow(row) {
    // Tylko rzeczownikowe formy „mocz/moczu/moczem” (próbka moczu), a nie
    // przymiotnik „moczowy” — sekcja „Kwas moczowy (…)” to biochemia krwi
    // i ma zostać z resztą wyników, nie w bloku badania moczu.
    return /\bmocz(u|em)?\b/i.test(row.sekcja || '');
  }

  // Próba zamknięcia „PODGLĄD WYNIKÓW” (i towarzyszącego mu wyszarzonego tła)
  // po skopiowaniu danych. Tło okazało się elementem WCZEŚNIEJ obecnym na
  // stronie (Serum tylko je przełącza), a nie nowo wstawianym węzłem — próba
  // ukrycia go „na siłę” zostawiała je zablokowane na stałe. Klawisz Escape
  // też odpadł — zamykał całe okno „Edycja wizyty” (ryzyko utraty
  // niezapisanych zmian), a nie tylko podgląd wyników.
  function isPodgladWynikowStillOpen() {
    const heading = findPodgladWynikowHeading();
    return Boolean(heading && isOverlayElementVisible(heading));
  }

  async function tryClosePodgladWynikow() {
    if (!isPodgladWynikowStillOpen()) {
      dbg('modLabKopiujWyniki: „PODGLĄD WYNIKÓW” już niewidoczny — nic do zamykania');
      return true;
    }

    // Escape USUNIĘTE — zamykało całe okno „Edycja wizyty” (ryzyko utraty
    // niezapisanych zmian w wizycie). Kliknięcie w nagłówek też nie działało —
    // to zwykły <span> z tytułem, a prawdziwe zamknięcie to osobny
    // <div class="div_close" onclick=";if(uf_czy_schowac){uf_schowaj_div();}">
    // (znaleziony przez inspektor DOM). Wołamy uf_schowaj_div() wprost przez
    // unsafeWindow, pomijając warunek uf_czy_schowac — ta funkcja jest
    // generyczna dla całego systemu pokaż/schowaj „uf_” i nie rusza okna
    // „Edycja wizyty”.
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof uw.uf_schowaj_div === 'function') {
      try {
        uw.uf_schowaj_div();
      } catch (e) {
        dbg('modLabKopiujWyniki: błąd wywołania uf_schowaj_div(): ' + e);
      }
      // Dawniej sztywne `await sleepMs(200)` — czyli zawsze pełne 0,2 s na
      // KAŻDE zlecenie, nawet gdy okno znikało od razu. Teraz sprawdzamy w
      // kółko i ruszamy dalej, gdy tylko faktycznie się zamknie.
      if (await waitUntilPodgladZamkniety(400)) {
        dbg('modLabKopiujWyniki: zamknięto „PODGLĄD WYNIKÓW” przez uf_schowaj_div()');
        return true;
      }
    } else {
      dbg('modLabKopiujWyniki: uf_schowaj_div niedostępna, próbuję kliknąć div.div_close');
    }

    const closeBtn = document.querySelector('div.div_close[onclick*="uf_schowaj_div"]');
    closeBtn?.click();
    if (await waitUntilPodgladZamkniety(400)) {
      dbg('modLabKopiujWyniki: zamknięto „PODGLĄD WYNIKÓW” kliknięciem w div.div_close');
      return true;
    }

    dbg('modLabKopiujWyniki: nie udało się automatycznie zamknąć „PODGLĄD WYNIKÓW” — trzeba ręcznie');
    return false;
  }

  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntilPodgladZamkniety(timeoutMs) {
    const start = Date.now();
    for (;;) {
      if (!isPodgladWynikowStillOpen()) return true;
      if (Date.now() - start > timeoutMs) return false;
      await sleepMs(LAB_POLL_MS);
    }
  }

  // Odstęp odpytywania zszedł ze 150 ms na 40 ms: samo sprawdzenie jest teraz
  // tanie (pamięć podręczna nagłówka/tabeli zamiast skanu całej strony), a to
  // właśnie ziarnistość odpytywania była stałym „podatkiem” doliczanym do
  // KAŻDEGO zlecenia — średnio pół odstępu zmarnowanego czekania.
  const LAB_POLL_MS = 40;

  function waitForResultsPopup(beforeSig, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        // Jedno wyszukanie na iterację — dawniej getResultsPopupSignature()
        // szukało tabeli DRUGI raz, dublując najdroższą część sprawdzenia.
        const table = findResultsPopupTable();
        if (table && isOverlayElementVisible(table)) {
          const sig = getResultsPopupSignature(table);
          if (sig && sig !== beforeSig) {
            resolve(table);
            return;
          }
        }
        if (Date.now() - start > timeoutMs) {
          // Zwróć to, co jest widoczne — mogą to być te same wyniki co poprzednio (nic nowego od ostatniego razu).
          resolve(table && isOverlayElementVisible(table) ? table : null);
          return;
        }
        setTimeout(check, LAB_POLL_MS);
      };
      check();
    });
  }

  // Po skopiowaniu wyników od razu przenosimy lekarza na zakładkę DANE WIZYTY
  // i wklejamy treść do BADANIA PRZEDMIOTOWEGO — to jedyne, co i tak robił
  // ręcznie po każdym kliknięciu „Skopiuj ostatnie wyniki”.
  async function przelaczNaDaneWizyty(timeoutMs) {
    const zakladka = document.getElementById('wize_zakladka_biezaca');
    if (zakladka && !/topTabsActive/.test(zakladka.className || '')) {
      // Klikamy WYŁĄCZNIE gdy zakładka nie jest już aktywna — powtórny klik
      // każe Serum przeładować sekcję wizyty.
      zakladka.click();
    } else if (!zakladka) {
      // Zakładki nie ma w DOM (inny układ ekranu) — ostatnia deska ratunku.
      const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      try { uw.wize_f_zmien_typ_wizyty('biezaca', ''); } catch (_) {}
    }

    const start = Date.now();
    for (;;) {
      const opis = document.getElementById('wizb_opis_w');
      if (opis && isOverlayElementVisible(opis)) return opis;
      if (Date.now() - start > timeoutMs) return null;
      await sleepMs(LAB_POLL_MS);
    }
  }

  function wklejDoBadaniaPrzedmiotowego(opis, text) {
    const stara = opis.value || '';
    // Drugi klik w przycisk nie ma dokładać tych samych wyników jeszcze raz.
    if (stara.includes(text.trim())) return 'duplikat';

    const nowa = stara.trim() ? stara.replace(/\s+$/, '') + '\n\n' + text : text;

    // Natywny setter + zdarzenia — tak samo jak w polu WYWIAD. Bez „change”
    // Serum nie ustawia alt='T' na polu i potrafi nie zapisać wklejonej treści.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(opis, nowa);
    else opis.value = nowa;
    opis.dispatchEvent(new Event('input', { bubbles: true }));
    opis.dispatchEvent(new Event('change', { bubbles: true }));

    opis.focus({ preventScroll: true });
    try { opis.setSelectionRange(nowa.length, nowa.length); } catch (_) {}
    opis.scrollTop = opis.scrollHeight;
    return 'wklejono';
  }

  async function runKopiujOstatnieWyniki() {
    if (labCopyRunning) return;
    labCopyRunning = true;
    const tStart = Date.now();
    const anchorRect = labCopyBtnEl?.getBoundingClientRect();

    try {
      const table = findLabOrdersTable();
      if (!table) {
        showToast('Nie znaleziono listy zleceń laboratoryjnych', { anchorRect });
        return;
      }

      const wynikiBtns = findLatestWynikiButtons(table);
      if (!wynikiBtns.length) {
        showToast('Brak dostępnych wyników do skopiowania', { anchorRect });
        return;
      }

      const allRows = [];
      let headerDate = '';
      let closedAll = true;
      let openedAny = false;

      for (let i = 0; i < wynikiBtns.length; i++) {
        if (!wynikiBtns[i]?.isConnected) continue;

        const beforeSig = getResultsPopupSignature();
        dbg('modLabKopiujWyniki: klik przycisku „Wyniki” ' + (i + 1) + '/' + wynikiBtns.length);
        const tKlik = Date.now();
        wynikiBtns[i].click();

        const popupTable = await waitForResultsPopup(beforeSig, 8000);
        const msOtwarcie = Date.now() - tKlik;
        if (!popupTable) {
          dbg('modLabKopiujWyniki: nie doczekano się „PODGLĄD WYNIKÓW” po 8000ms (zlecenie ' + (i + 1) + ')');
          continue;
        }
        openedAny = true;

        const rows = extractLabResultRows(popupTable).filter((row) => !shouldExcludeLabResult(row));

        // Badanie moczu dostaje własny „batch” (osobny blok w tekście — sekcje
        // rozdziela pusty wiersz) i flagę bezGrupy, żeby grupowanie wyników
        // (np. glukoza/insulina) nie wyciągało parametrów moczu z ich bloku.
        let subBatch = 0;
        let prevUrine = null;
        for (const row of rows) {
          const urine = isUrineLabRow(row);
          if (prevUrine !== null && urine !== prevUrine) subBatch++;
          prevUrine = urine;
          allRows.push({ ...row, collectOrder: allRows.length, batchId: i + ':' + subBatch, bezGrupy: urine });
        }
        if (!headerDate) headerDate = rows.map((r) => formatLabDate(r.czasWykonania)).find(Boolean) || '';

        const tZamkniecie = Date.now();
        const closed = await tryClosePodgladWynikow();
        closedAll = closedAll && closed;
        // Pomiar per zlecenie — żeby przy kolejnym „trwa za długo” log od razu
        // pokazał, czy czas zjada Serum (otwieranie/zamykanie okna), czy nasz
        // kod (odczyt tabeli).
        dbg(
          'modLabKopiujWyniki: zlecenie ' + (i + 1) + '/' + wynikiBtns.length +
          ' — otwarcie ' + msOtwarcie + 'ms, odczyt ' + (tZamkniecie - tKlik - msOtwarcie) +
          'ms, zamknięcie ' + (Date.now() - tZamkniecie) + 'ms'
        );
      }

      if (!openedAny) {
        showToast('Nie udało się otworzyć podglądu wyników', { anchorRect });
        return;
      }
      if (!allRows.length) {
        showToast('Podgląd wyników nie zawiera żadnych parametrów', { anchorRect });
        return;
      }

      const body = buildLabResultsBody(allRows);
      const text = headerDate ? `${headerDate}\n\n${body}` : body;

      copyTextToClipboard(text);
      dbg(
        'modLabKopiujWyniki: skopiowano ' + allRows.length + ' parametrów z ' + wynikiBtns.length +
        ' zlecenia/zleceń (' + (headerDate || 'brak daty') + ') w ' + (Date.now() - tStart) + 'ms'
      );

      const opis = await przelaczNaDaneWizyty(4000);
      const stan = opis ? wklejDoBadaniaPrzedmiotowego(opis, text) : 'brak-pola';
      dbg('modLabKopiujWyniki: BADANIE PRZEDMIOTOWE — ' + stan);

      const komunikat =
        stan === 'wklejono' ? 'Wklejono wyniki' + (headerDate ? ' z ' + headerDate : '') :
        stan === 'duplikat' ? 'Te wyniki już są w BADANIU PRZEDMIOTOWYM (schowek uzupełniony)' :
        'Skopiowano do schowka — nie znalazłem pola BADANIE PRZEDMIOTOWE';
      showToast(
        komunikat + (closedAll ? '' : ' (zamknij podgląd ręcznie)'),
        { anchorRect: opis?.getBoundingClientRect() || anchorRect }
      );
    } finally {
      labCopyRunning = false;
    }
  }

  function findLabToolbarAnchor() {
    return document.getElementById('span_lab_sel');
  }

  function positionLabCopyBtn(btn) {
    const anchor = findLabToolbarAnchor();
    if (anchor && isOverlayElementVisible(anchor)) {
      const rect = anchor.getBoundingClientRect();
      setStyleIfChanged(btn, 'position', 'absolute');
      setStyleIfChanged(btn, 'right', '');
      setStyleIfChanged(btn, 'bottom', '');
      setStyleIfChanged(btn, 'top', Math.round(rect.top + window.scrollY + (rect.height - btn.offsetHeight) / 2) + 'px');
      setStyleIfChanged(btn, 'left', Math.round(rect.right + window.scrollX + 10) + 'px');
      return;
    }
    // Fallback (anchor akurat niedostępny): stały róg ekranu, żeby nic nie zasłonić.
    setStyleIfChanged(btn, 'position', 'fixed');
    setStyleIfChanged(btn, 'top', '');
    setStyleIfChanged(btn, 'left', '');
    setStyleIfChanged(btn, 'right', '20px');
    setStyleIfChanged(btn, 'bottom', '90px');
  }

  function modLabKopiujWyniki() {
    // Okno recept przykrywa całą stronę, ale tabela zleceń pod spodem wciąż ma
    // wymiary i „widoczny” styl — bez tego warunku pomarańczowy przycisk
    // zostawał na wierzchu nad receptami.
    if (mierz('lab:oknoRecept', oknoReceptOtwarte)) {
      labCopyBtnEl?.remove();
      labCopyBtnEl = null;
      return;
    }
    const table = mierz('lab:findLabOrdersTable', findLabOrdersTable);
    if (!table || !mierz('lab:widocznoscTabeli', () => isOverlayElementVisible(table))) {
      labCopyBtnEl?.remove();
      labCopyBtnEl = null;
      return;
    }

    if (!labCopyBtnEl?.isConnected) {
      labCopyBtnEl = document.createElement('button');
      labCopyBtnEl.id = 'serum-ui-lab-copy-btn';
      labCopyBtnEl.type = 'button';
      labCopyBtnEl.textContent = 'Skopiuj ostatnie wyniki';
      labCopyBtnEl.style.cssText = [
        'z-index:2147483000', 'padding:6px 12px',
        'background:#e07b00', 'color:#fff', 'border:none', 'border-radius:5px',
        'font:600 12px/1.3 system-ui, sans-serif', 'cursor:pointer',
        'box-shadow:0 2px 8px rgba(0,0,0,.35)',
      ].join(';');
      labCopyBtnEl.addEventListener('click', () => runKopiujOstatnieWyniki());
      document.body.appendChild(labCopyBtnEl);
    }

    mierz('lab:pozycjonowanie', () => positionLabCopyBtn(labCopyBtnEl));
  }

  // --- scheduler ---

  let uiTimer = null;

  // Log debugowania potrafił urywać się na wiele godzin bez ŻADNEGO nowego
  // wpisu, mimo dalszej normalnej pracy (wielokrotnie podpisywane e-recepty,
  // otwierane kolejne skierowania) — dowód, że CAŁY uiTick() przestawał się
  // uruchamiać, a nie tylko pojedynczy moduł. Bez try/catch wyjątek w
  // KTÓRYMKOLWIEK module (np. po jakiejś nietypowej zmianie DOM) przerywał
  // resztę tej iteracji po cichu (błąd tylko w konsoli), a kolejne wywołania
  // uiTick() z obserwatora/listenerów mogły trafiać na ten sam wyjątek za
  // każdym razem — więc żaden PÓŹNIEJSZY moduł (w tym modWynikiOperacji) nigdy
  // nie zdążał się wykonać. Owijamy każdy moduł osobno, żeby jeden zepsuty
  // nie blokował reszty, i logujemy wyjątek — żeby przy kolejnym takim
  // przypadku log pokazał REALNĄ przyczynę zamiast całkowitej ciszy.
  const UI_TICK_STEPS = [
    ['modPodpisElektroniczny', modPodpisElektroniczny],
    ['modWynikiOperacji', modWynikiOperacji],
    ['modWyslijSms', modWyslijSms],
    ['modPodpiszERecepte', modPodpiszERecepte],
    ['modPodpiszIpom', modPodpiszIpom],
    ['modEzlaPue', modEzlaPue],
    ['modEzlaPodpis', modEzlaPodpis],
    ['modEzlaOstrzezenieWyslij', modEzlaOstrzezenieWyslij],
    ['modPowodEdycji', modPowodEdycji],
    ['modLuxMed', modLuxMed],
    ['modIcd9Auto', modIcd9Auto],
    ['modWywiadFokusStart', modWywiadFokusStart],
    ['modProceduryDodatkowe', modProceduryDodatkowe],
    ['modDashboardNav', modDashboardNav],
    ['modHistoriaWizytFiltr', modHistoriaWizytFiltr],
    ['modLabKopiujWyniki', modLabKopiujWyniki],
    ['modPodgladWydrukuFokus', modPodgladWydrukuFokus],
    ['markPatientCells', markPatientCells],
    ['syncTopPager', syncTopPager],
  ];

  const uiTickErrLogged = new Set();

  // Lista wizyt (markPatientCells, mini-paginacja) i tabela zleceń
  // LABORATORIUM — JEDEN przelot po tabelach strony na tick zamiast osobnego
  // dla każdego modułu. getElementsByTagName to żywa lista trzymana przez
  // przeglądarkę (bez kopiowania do tablicy), a ocena każdej tabeli jest
  // zapamiętana per tabela. Pamięć tylko w obrębie jednego uiTick().
  let tabeleTickCache = null;
  function tabeleStrony() {
    if (tabeleTickCache) return tabeleTickCache;
    const wynik = { wizyty: [], lab: null };
    for (const t of document.getElementsByTagName('table')) {
      if (isWizytyListTable(t)) wynik.wizyty.push(t);
      if (!wynik.lab && isLabOrdersTable(t)) wynik.lab = t;
    }
    if (visCache) tabeleTickCache = wynik;
    return wynik;
  }

  // --- profil czasu modułów ---
  // Audyt wydajności bez pomiaru to zgadywanie, więc tick mierzy sam siebie:
  // ile milisekund zjada każdy moduł, ile razy był wołany i jaki był jego
  // najgorszy pojedynczy przebieg. Koszt: dwa performance.now() na moduł
  // (~mikrosekundy), czyli znacznie mniej niż cokolwiek, co mierzymy.
  const modProfile = new Map();
  // Profil KROKÓW wewnątrz najdroższych modułów. Pomiar na poziomie modułu
  // powiedział „syncTopPager 25 ms”, ale nie powiedział KTÓRA linijka — a
  // zgadywanie już raz mnie w tym miejscu wyprowadziło w pole.
  const krokProfile = new Map();

  function mierz(nazwa, fn) {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      const dt = performance.now() - t0;
      const p = krokProfile.get(nazwa);
      if (p) { p.ms += dt; p.n++; if (dt > p.max) p.max = dt; }
      else krokProfile.set(nazwa, { ms: dt, n: 1, max: dt });
    }
  }

  function formatKrokProfile() {
    if (!krokProfile.size) return '(brak pomiarów)';
    return [...krokProfile.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([nazwa, p]) =>
        '  ' + p.ms.toFixed(0).padStart(7) + ' ms łącznie' +
        ' | ' + (p.ms / p.n).toFixed(2).padStart(6) + ' ms śr.' +
        ' | ' + p.max.toFixed(1).padStart(6) + ' ms max' +
        ' | ' + String(p.n).padStart(5) + '×' +
        ' | ' + nazwa)
      .join('\n');
  }
  let uiTickTotalMs = 0;
  let uiTickSlowestMs = 0;
  let uiTickSlowestAt = 0;
  let uiTickSlowestModule = '';
  let ostatniLogDlugiegoTicka = 0;

  function formatModuleProfile() {
    if (!modProfile.size) return '(brak pomiarów)';
    const wiersze = [...modProfile.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([name, p]) =>
        '  ' + p.ms.toFixed(0).padStart(7) + ' ms łącznie' +
        ' | ' + (p.ms / p.n).toFixed(2).padStart(6) + ' ms śr.' +
        ' | ' + p.max.toFixed(1).padStart(6) + ' ms max' +
        ' | ' + name
      );
    const suma = uiTickTotalMs.toFixed(0);
    const sredniTick = uiTickCount ? (uiTickTotalMs / uiTickCount).toFixed(2) : '—';
    return (
      '  RAZEM w uiTick: ' + suma + ' ms (średnio ' + sredniTick + ' ms/tick, ' +
      'najgorszy ' + uiTickSlowestMs.toFixed(1) + ' ms' +
      (uiTickSlowestAt ? ' o ' + new Date(uiTickSlowestAt).toLocaleTimeString('pl-PL') : '') +
      (uiTickSlowestModule ? ', głównie ' + uiTickSlowestModule : '') + ')\n' +
      wiersze.join('\n')
    );
  }

  // --- okno RECEPTY/E-RECEPTY: nasze automaty mają tam milczeć ---
  // To okno leży NA panelu edycji wizyty w tym samym dokumencie, więc wszystkie
  // bramki oparte o tekst całej strony („uwagi z terminarza”, „czy zapisać
  // świadczenie”) nadal przechodzą i moduły panelu wizyty pracują pełną parą,
  // choć nie mają tam nic do roboty. Gorsze niż sam koszt: one PISZĄ do DOM
  // (klasy komórek, czyszczenie listy podpowiedzi, styl mini-paginacji) w
  // oknie, w którym w tym samym czasie pracuje dawkomat i reszta skryptów
  // recept. Dopóki to okno jest otwarte, pomijamy moduły należące do panelu
  // wizyty; zostają tylko te, które NAPRAWDĘ dotyczą recept (WYNIKI OPERACJI
  // po wysyłce, PIN e-recepty) oraz obsługa okien dialogowych.
  const MODULY_POMIJANE_W_RECEPTACH = new Set([
    'modLuxMed',
    'modIcd9Auto',
    'modWywiadFokusStart',
    'modProceduryDodatkowe',
    'modDashboardNav',
    'modHistoriaWizytFiltr',
    'markPatientCells',
  ]);
  // modLabKopiujWyniki i syncTopPager NIE są tu wymienione celowo: wstrzykują
  // własne elementy do strony, więc muszą się wykonać, żeby je SCHOWAĆ —
  // pominięcie zostawiłoby je wiszące nad oknem recept.


  // Pokazane okna „popup-window” (serum2: Recepty, WYNIKI OPERACJI, wydruki)
  // — żywa lista klas zamiast przelotu selektorem, wspólna dla ticka.
  let pokazanePopupyTickCache = null;
  function pokazanePopupy() {
    if (pokazanePopupyTickCache) return pokazanePopupyTickCache;
    const wynik = [];
    for (const p of document.getElementsByClassName('popup-window')) if (p.classList.contains('show')) wynik.push(p);
    if (visCache) pokazanePopupyTickCache = wynik; // pamięć tylko w obrębie uiTick()
    return wynik;
  }

  let oknoReceptTickCache = null;
  function oknoReceptOtwarte() {
    if (oknoReceptTickCache !== null) return oknoReceptTickCache;
    let znalezione = false;
    for (const popup of pokazanePopupy()) {
      const h1 = popup.querySelector('.popup-header h1');
      if (!h1 || !/recept/i.test(h1.textContent || '')) continue;
      if (!isOverlayElementVisible(popup)) continue;
      znalezione = true;
      break;
    }
    oknoReceptTickCache = znalezione;
    return znalezione;
  }

  let receptyCiszaOd = false;

  function uiTick() {
    uiTickCount++;
    uiLastTickAt = Date.now();
    tabeleTickCache = null;
    oknoReceptTickCache = null;
    pokazanePopupyTickCache = null;
    visCache = new WeakMap();
    const tTickStart = performance.now();
    let najgorszyMs = 0;
    let najgorszyModul = '';

    const cisza = oknoReceptOtwarte();
    if (cisza !== receptyCiszaOd) {
      receptyCiszaOd = cisza;
      dbg('uiTick: okno RECEPTY/E-RECEPTY ' + (cisza ? 'otwarte — wyciszam moduły panelu wizyty' : 'zamknięte — moduły panelu wizyty znów aktywne'));
      // Czas wyciszenia nie liczy się do limitu próby ICD-9.
      if (!cisza && icd9AutoPending) icd9AutoPendingSince = Date.now();
    }

    for (const [name, fn] of UI_TICK_STEPS) {
      if (cisza && MODULY_POMIJANE_W_RECEPTACH.has(name)) continue;
      const t0 = performance.now();
      try {
        fn();
      } catch (e) {
        // Rate-limit: to samo źródło błędu nie zaśmieca 300-wpisowego bufora
        // logu przy każdym kolejnym ticku (mogą ich być dziesiątki na sekundę).
        const sig = name + ':' + (e?.message || e);
        if (!uiTickErrLogged.has(sig)) {
          uiTickErrLogged.add(sig);
          dbg('uiTick: wyjątek w ' + name + ' — ' + (e?.message || e));
        }
      }
      const dt = performance.now() - t0;
      const p = modProfile.get(name);
      if (p) { p.ms += dt; p.n++; if (dt > p.max) p.max = dt; }
      else modProfile.set(name, { ms: dt, n: 1, max: dt });
      if (dt > najgorszyMs) { najgorszyMs = dt; najgorszyModul = name; }
    }

    visCache = null;

    const tickMs = performance.now() - tTickStart;
    uiTickTotalMs += tickMs;
    if (tickMs > uiTickSlowestMs) {
      uiTickSlowestMs = tickMs;
      uiTickSlowestAt = uiLastTickAt;
      uiTickSlowestModule = najgorszyModul + ' (' + najgorszyMs.toFixed(1) + ' ms)';
    }
    // Powyżej ~50 ms pojedynczy tick jest już odczuwalny jako zacięcie
    // interfejsu (klatka to 16 ms). Logujemy najwyżej raz na 5 s, żeby przy
    // serii takich ticków nie zapchać bufora samym narzekaniem na siebie.
    if (tickMs > 50 && uiLastTickAt - ostatniLogDlugiegoTicka > 5000) {
      ostatniLogDlugiegoTicka = uiLastTickAt;
      dbg('uiTick: DŁUGI TICK ' + tickMs.toFixed(0) + ' ms — najwięcej ' + najgorszyModul +
        ' (' + najgorszyMs.toFixed(0) + ' ms)');
    }
  }

  function scheduleUi() {
    if (uiTimer) return;
    uiTimer = setTimeout(() => {
      uiTimer = null;
      uiTick();
    }, 400);
  }

  function scheduleUiSoon() {
    // Przełączenie zakładki (np. HISTORIA WIZYT) często tylko zmienia widoczność
    // istniejących paneli, bez dodawania węzłów — obserwator childList wtedy
    // milczy i tick czekał na przypadkową mutację (stąd opóźnienie kliknięcia
    // „Filtruj”). Klik to zawsze początek takiej zmiany, więc po nim odpalamy
    // tick szybciej i bez czekania na obserwator.
    if (uiTimer) clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      uiTimer = null;
      uiTick();
    }, 120);
  }

  // Tick o konkretnej porze — dla modułów, które czekają na UPŁYW CZASU, a nie
  // na zmianę w DOM (limit próby ICD-9, odświeżenie pamięci isOnTop). Zastępuje
  // dawny interwał co 3 s, który był „siatką bezpieczeństwa” na wszelki
  // wypadek, a dawał 28–47% wszystkich ticków (logi 22.09 i 28.09). Trzymamy
  // tylko najbliższy termin — moduł, który dalej czeka, zgłasza się ponownie
  // przy każdym ticku.
  let tickZaTimer = null;
  let tickZaAt = 0;
  function zaplanujTickZa(ms) {
    const at = Date.now() + Math.max(0, ms);
    if (tickZaTimer && tickZaAt <= at) return;
    clearTimeout(tickZaTimer);
    tickZaAt = at;
    tickZaTimer = setTimeout(() => {
      tickZaTimer = null;
      uiTick();
    }, Math.max(0, ms));
  }

  // --- RECEPTY/E-RECEPTY: Esc zamyka popup recept zamiast całej wizyty ---

  function bootReceptyEsc() {
    // Serum na Esc zamyka całe okno „Edycja wizyty”. Gdy otwarty jest popup
    // recept (#serum2popupWindow z nagłówkiem „Recepty/e-Recepty”),
    // przechwytujemy PRAWDZIWE naciśnięcie Esc w fazie capture (przed
    // handlerami strony), zatrzymujemy je i klikamy krzyżyk popupu
    // (button.popup-close) — zamyka się tylko widok recept.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        const popup = document.getElementById('serum2popupWindow');
        if (!popup || !popup.classList.contains('show') || !isOverlayElementVisible(popup)) return;
        const title = popup.querySelector('.popup-header h1')?.textContent || '';
        if (!/recept/i.test(title)) return;
        const closeBtn = popup.querySelector('button.popup-close');
        if (!closeBtn) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        dbg('bootReceptyEsc: Esc → klik krzyżyka popupu Recepty/e-Recepty');
        closeBtn.click();
      },
      true
    );
  }

  // --- ZAŚWIADCZENIA: Esc pyta o potwierdzenie zamiast od razu zamykać ---

  function bootZaswiadczeniaEsc() {
    // Omyłkowy Esc w oknie „DODAWANIE ZAŚWIADCZENIA …” lub „EDYCJA
    // ZAŚWIADCZENIA …” (ZUS OL-9, o stanie zdrowia itd.) zamykał dokument
    // bez ostrzeżenia i tracił wpisaną/edytowaną treść. Przechwytujemy Esc
    // w fazie capture i pytamy natywnym confirm():
    // OK → przepuszczamy zdarzenie dalej (Serum zamyka okno jak dotychczas),
    // Anuluj → zatrzymujemy Esc i nic się nie zamyka. confirm() jest wołane
    // z piaskownicy Tampermonkey, więc nie przechodzi przez auto-OK z modułu
    // dialogów (tamten patch działa na confirm strony, nie nasz).
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        // Okna starego Serum dostają tytuł w span.h3_tytul (uf_pokaz_div —
        // źródło strony; tak samo POWÓD EDYCJI, IPOM, WYSYŁKA SMS z inspektora).
        // Dawniej: tekst całego <body> przy każdym Esc, a gdy fraza była
        // w DOM — textContent KAŻDEGO elementu (html, body… po ~10 mln znaków).
        let heading = null;
        for (const el of document.getElementsByClassName('h3_tytul')) {
          if (/^(dodawanie|edycja) zaświadczenia/.test(normalize(el.textContent)) && isOverlayElementVisible(el)) {
            heading = el;
            break;
          }
        }
        if (!heading) return;
        if (window.confirm('Czy na pewno zamknąć dokument bez zapisu?')) {
          dbg('bootZaswiadczeniaEsc: potwierdzono zamknięcie zaświadczenia przez Esc');
          return;
        }
        dbg('bootZaswiadczeniaEsc: anulowano zamknięcie — Esc zatrzymany');
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  // --- IPOM: Esc pyta o potwierdzenie zamiast od razu zamykać ---

  function bootIpomEsc() {
    // Omyłkowy Esc w widoku IPOM (nagłówek <span id="ipom" class="h3_tytul">IPOM</span>,
    // zamykany przez div.div_close → uf_schowaj_div()) zamykał go bez zapisu.
    // Ten sam mechanizm co przy zaświadczeniach: capture + natywny confirm().
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        const naglowek = document.querySelector('span#ipom.h3_tytul');
        if (!naglowek || !isOverlayElementVisible(naglowek)) return;
        if (window.confirm('Czy na pewno zamknąć IPOM bez zapisu?')) {
          dbg('bootIpomEsc: potwierdzono zamknięcie IPOM przez Esc');
          return;
        }
        dbg('bootIpomEsc: anulowano zamknięcie — Esc zatrzymany');
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  // --- PODGLĄD WYDRUKU (zalecenia, skierowania, ...): auto-zamknięcie po
  // wydruku + Esc. Wszystkie te panele („PODGLĄD WYDRUKU ZALECENIA”,
  // „PODGLĄD WYDRUKU SKIEROWANIE DO LABORATORIUM” itd.) mają ten sam
  // mechanizm zamykania i identyczny prefiks id (id^="podgladWydruku") —
  // stąd jedna, wspólna obsługa zamiast osobnego modułu na każdy typ
  // dokumentu.

  function findPodgladWydrukuHeading() {
    // Nie getElementById — po kilku otwarciach Serum zostawia w DOM stare,
    // niewidoczne kopie popupu z tym samym id (jak przy „PODGLĄD WYNIKÓW”),
    // a getElementById zwróciłby pierwszą (potencjalnie martwą) kopię.
    const candidates = document.querySelectorAll('[id^="podgladWydruku"]');
    const found = [...candidates].find((el) => isOverlayElementVisible(el));
    if (found) return found;

    // Drugi wariant tego samego rodzaju okna: generyczny popup Serum
    // (.popup-window.show, ten sam komponent co np. Recepty/e-Recepty) z
    // nagłówkiem zaczynającym się od „WYDRUK …” — np. „WYDRUK POTWIERDZENIA
    // WYSŁANIA SKIEROWANIA ELEKTRONICZNEGO” (div#ereferralFrame). Zwracamy
    // cały popup (nie sam nagłówek) — closePodgladWydruku rozpozna go po
    // klasie i zamknie właściwym dla niego przyciskiem.
    for (const popup of pokazanePopupy()) {
      if (!isOverlayElementVisible(popup)) continue;
      const h1 = popup.querySelector('.popup-header h1');
      if (h1 && /^wydruk\b/i.test(normLabel(h1.textContent))) return popup;
    }
    return null;
  }

  function closePodgladWydruku() {
    const heading = findPodgladWydrukuHeading();
    if (!heading) return false;

    // Wariant „.popup-window” (np. ereferralFrame) ma własny krzyżyk
    // (button.popup-close), tak jak popup Recepty/e-Recepty.
    if (heading.classList?.contains('popup-window')) {
      const closeBtn = heading.querySelector('button.popup-close');
      closeBtn?.click();
      const closed = !findPodgladWydrukuHeading();
      dbg('closePodgladWydruku: klik popup-close, zamknięto=' + closed);
      return closed;
    }

    // Ten sam mechanizm co przy „PODGLĄD WYNIKÓW”: uf_schowaj_div() wprost
    // (z pominięciem warunku uf_czy_schowac), fallback — klik w div.div_close
    // obok nagłówka.
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (typeof uw.uf_schowaj_div === 'function') {
      try {
        uw.uf_schowaj_div();
      } catch (e) {
        dbg('closePodgladWydruku: błąd uf_schowaj_div(): ' + e);
      }
      if (!findPodgladWydrukuHeading()) {
        dbg('closePodgladWydruku: zamknięto przez uf_schowaj_div()');
        return true;
      }
    }
    const closeBtn = heading.closest('h3')?.querySelector('.div_close') ||
      document.querySelector('div.div_close[onclick*="uf_schowaj_div"]');
    closeBtn?.click();
    const closed = !findPodgladWydrukuHeading();
    dbg('closePodgladWydruku: klik div_close, zamknięto=' + closed);
    return closed;
  }

  // Wbudowana przeglądarka PDF Firefoksa przy ramce węższej niż 750 px chowa
  // „Drukuj”/„Zapisz” do menu » na końcu paska. Od Firefoksa 157 pasek ma dwa
  // nowe przyciski (komentarz, podpis), nie mieści się w 700 px ramce
  // iframe#wydruka.printFrame i menu » ląduje za krawędzią. Samo okno
  // (#ereferralFrame) i tak zajmuje całą szerokość strony — wystarczy poszerzyć
  // ramkę. Czysty CSS: zero pracy w ticku.
  const podgladPdfStyle = document.createElement('style');
  podgladPdfStyle.textContent = '#ereferralFrame iframe.printFrame { width: 920px !important; max-width: 100% !important; }';
  document.documentElement.appendChild(podgladPdfStyle);

  let podgladWydrukuWatchTimer = null;
  let podgladWydrukuWatchLastBeat = 0;
  let podgladWydrukuFocusLost = false;

  function modPodgladWydrukuFokus() {
    // Zdarzenia wewnątrz ramki PDF (klik, klawisze) nie docierają do strony,
    // a po zamknięciu okna drukowania DOM się nie zmienia — obserwator mutacji
    // nie ma się od czego odpalić. Dlatego dopóki podgląd jest otwarty, działa
    // dedykowany interwał (startuje/gaśnie razem z podglądem — zero kosztu poza nim):
    // 1) ściąga fokus z ramki PDF, żeby Esc zawsze docierał do strony,
    // 2) wykrywa zamknięcie modalnego okna drukowania po „dziurze” czasowej
    //    (okno drukowania zamraża JS strony) i wtedy zamyka podgląd samo.
    const open = Boolean(findPodgladWydrukuHeading());
    if (!open) {
      if (podgladWydrukuWatchTimer) {
        clearInterval(podgladWydrukuWatchTimer);
        podgladWydrukuWatchTimer = null;
      }
      return;
    }
    if (podgladWydrukuWatchTimer) return;

    podgladWydrukuWatchLastBeat = Date.now();
    podgladWydrukuFocusLost = false;
    podgladWydrukuWatchTimer = setInterval(() => {
      if (!findPodgladWydrukuHeading()) {
        clearInterval(podgladWydrukuWatchTimer);
        podgladWydrukuWatchTimer = null;
        return;
      }
      const now = Date.now();
      const gap = now - podgladWydrukuWatchLastBeat;
      podgladWydrukuWatchLastBeat = now;
      if (gap > 2000 && !document.hidden) {
        dbg('modPodgladWydrukuFokus: JS był zamrożony ' + gap + 'ms (okno drukowania) — zamykam podgląd');
        closePodgladWydruku();
        return;
      }

      // Okno „Drukuj” to dialog samego Firefoksa (nie DOM strony — dlatego
      // inspektor go nie widzi, afterprint milczy, a JS się nie zamraża).
      // Gdy jest otwarte, strona traci fokus OKNA; odzyskanie fokusu przy
      // wciąż widocznej karcie = dialog właśnie zamknięty → zamykamy podgląd.
      if (document.hidden) {
        podgladWydrukuFocusLost = false; // przełączenie karty to nie okno drukowania
      } else if (!document.hasFocus()) {
        podgladWydrukuFocusLost = true;
      } else if (podgladWydrukuFocusLost) {
        podgladWydrukuFocusLost = false;
        dbg('modPodgladWydrukuFokus: strona odzyskała fokus po dialogu drukowania — zamykam podgląd');
        closePodgladWydruku();
        return;
      }

      const ae = document.activeElement;
      if (ae && ae.tagName === 'IFRAME') ae.blur();
    }, 250);
  }

  function bootPodgladWydruku() {
    // Po wydruku (zaleceń, skierowań, ...) podgląd zostaje otwarty i trzeba
    // było klikać krzyżyk. afterprint odpala się po zamknięciu okna
    // drukowania — wtedy zamykamy podgląd automatycznie (małe opóźnienie,
    // żeby druk zdążył się wysłać).
    window.addEventListener('afterprint', () => {
      if (!findPodgladWydrukuHeading()) return;
      setTimeout(() => closePodgladWydruku(), 300);
    });

    // Powrót na kartę po przełączeniu (przeglądarka dławi interwały w tle)
    // nie może wyglądać jak „dziura po oknie drukowania” — resetujemy zegar.
    document.addEventListener('visibilitychange', () => {
      podgladWydrukuWatchLastBeat = Date.now();
    });

    // Esc w tym widoku nic nie robił — podpinamy zamknięcie podglądu.
    // Fallback na wypadek, gdy druk idzie z wbudowanej przeglądarki PDF
    // (osobna ramka) i afterprint nie dociera do strony.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        if (!findPodgladWydrukuHeading()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        dbg('bootPodgladWydruku: Esc → zamykam PODGLĄD WYDRUKU');
        closePodgladWydruku();
      },
      true
    );
  }

  function start() {
    bootLogin();
    bootSmsToast();
    bootReceptyEsc();
    bootZaswiadczeniaEsc();
    bootIpomEsc();
    bootPodgladWydruku();

    // Okno WYNIKI OPERACJI (div#ereferralFrame.popup-window) bywa gotowym,
    // wcześniej istniejącym w DOM węzłem — Serum je pokazuje samym dodaniem
    // klasy „show”, BEZ żadnej zmiany childList. Bez obserwacji atrybutów
    // ten obserwator w ogóle nie reagował na takie pojawienie się okna, więc
    // uiTick()/modWynikiOperacji() nie uruchamiały się wcale (stąd całkowity
    // brak wpisu w logu dla takich wystąpień) — okno bywało zamykane tylko
    // przypadkiem, gdy jakiś PÓŹNIEJSZY klik gdziekolwiek na stronie
    // (np. w innym panelu) odpalał scheduleUiSoon() przez osobny listener kliknięć.
    // Mutacje pochodzące z WŁASNYCH elementów skryptu (toast, górna
    // paginacja, przycisk kopiowania wyników) są ignorowane — patrz
    // isOwnUiNode(): bez tego filtra pozycjonowanie tych elementów na każdym
    // ticku samo wywoływało kolejny tick i pętla nigdy nie wygasała.
    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (isNoiseMutation(rec)) { szumOdfiltrowany++; continue; }
        if (rec.type === 'childList') {
          let onlyOwn = true;
          for (const n of rec.addedNodes) if (!isOwnUiNode(n)) { onlyOwn = false; break; }
          if (onlyOwn) for (const n of rec.removedNodes) if (!isOwnUiNode(n)) { onlyOwn = false; break; }
          if (onlyOwn && (rec.addedNodes.length || rec.removedNodes.length)) continue;
          if (onlyOwn && isOwnUiNode(rec.target)) continue;
        } else if (isOwnUiNode(rec.target)) {
          continue;
        }
        noteTickTrigger(rec);
        scheduleUi();
        return;
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // value/checked — strona ustawia też atrybut (nie tylko właściwość):
      // w logu 28.09 m.in. input#hid_idkontaktu[value] przy zmianie wizyty.
      // disabled — przycisk („Podpisz” itp.) odblokowany przez stronę bez innej
      // zmiany w DOM; dawniej łapał to dopiero interwał co 3 s.
      attributeFilter: ['class', 'style', 'value', 'checked', 'disabled'],
    });
    document.addEventListener('input', scheduleUi, true);
    document.addEventListener('click', scheduleUiSoon, true);
    window.addEventListener('resize', scheduleUi);
    // Mini-paginacja i przycisk „Skopiuj ostatnie wyniki” są pozycjonowane
    // względem elementów strony — przewinięcie kontenera przesuwa je bez
    // żadnej mutacji. Tylko gdy któryś z nich jest na stronie.
    document.addEventListener('scroll', () => {
      if (topPagerEl || labCopyBtnEl) scheduleUi();
    }, { capture: true, passive: true });
    // Po zamknięciu systemowego okna drukowania strona odzyskuje fokus,
    // a w DOM nic się nie zmienia — bez tego ticka modPodgladWydrukuFokus nie
    // miałby kiedy ściągnąć fokusu z ramki PDF.
    window.addEventListener('focus', scheduleUiSoon);

    uiTick();
    setTimeout(uiTick, 800);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
