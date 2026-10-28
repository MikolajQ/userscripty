// ==UserScript==
// @name         Serum — diagnostyka DOM (tymczasowa)
// @namespace    local.serum-diag
// @version      1.2.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-diag.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-diag.user.js
// @description  Sam robi zrzuty struktury strony Serum (id, klasy, tabele, ramki, liczniki) w kolejnych stanach pracy, co 5 min próbkuje kopie przyklejonego nagłówka, handlery okna i koszt przewijania, odkłada log debug serum-ui — wszystko w localStorage — dane do dalszej optymalizacji serum-ui. Niczego nie zmienia na stronie, wyłącza się sam po 7 dniach.
// @match        https://s2.serum.com.pl/*
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Działa w kontekście strony, gdzie Prototype.js Serum podmienia m.in.
// Array.from, Array#find i Array#entries — stąd wszędzie zwykłe pętle.
(function () {
  'use strict';

  const KLUCZ = 'serum_diag_v1';
  const DNI_DZIALANIA = 7;
  const CO_ILE_MS = 3000;            // sprawdzenie stanu strony
  const PONOW_PO_MS = 45 * 60000;    // ten sam stan — kolejny zrzut najwcześniej po tylu ms
  const LIMIT_ZNAKOW = 1500000;      // cały zapis w localStorage (limit Firefoksa: 5 MB na witrynę)
  const KLUCZ_LOG = 'serum_diag_log_v1';
  const LOG_CO_ILE_MS = 15 * 60000;  // kopia logu debug serum-ui
  const LOG_URUCHOMIEN = 12;         // tyle ostatnich wstrzyknięć serum-ui trzymamy (~80 KB każde)

  function czytaj() {
    try { return JSON.parse(localStorage.getItem(KLUCZ) || 'null'); } catch (e) { return null; }
  }
  const dane = czytaj() || { start: Date.now(), zrzuty: {} };
  if (Date.now() - dane.start > DNI_DZIALANIA * 86400000) return;

  function zapisz() {
    try {
      const s = JSON.stringify(dane);
      if (s.length > LIMIT_ZNAKOW) return false;
      localStorage.setItem(KLUCZ, s);
      return true;
    } catch (e) { return false; }
  }

  // Ciągi cyfr (PESEL, numery kart, id pacjenta w onclick) nie są potrzebne
  // do analizy struktury strony. Tylko w tym, co przychodzi ze strony — w 1.0.0
  // maska szła po całym zrzucie i zjadała też liczniki („tekst body: # zn.”).
  const maskuj = (s) => String(s).replace(/\d{5,}/g, '#');
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function widoczny(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // --- rozpoznanie stanu (tanie: żywe listy klas i getElementById) ---

  function wykryjStan() {
    const st = [];
    for (const p of document.getElementsByClassName('popup-window')) {
      if (!p.classList.contains('show')) continue;
      const h = norm(p.querySelector('.popup-header h1') ? p.querySelector('.popup-header h1').textContent : '');
      if (/recept/.test(h)) st.push('recepty');
      else if (/^wydruk/.test(h)) st.push('wydruk');
      else if (/wyniki? operacji/.test(h)) st.push('wyniki-operacji');
      else st.push('popup#' + maskuj(p.id || '?'));
    }
    for (const el of document.querySelectorAll('[id^="podgladWydruku"]')) {
      if (widoczny(el)) { st.push('wydruk'); break; }
    }
    for (const t of document.getElementsByClassName('h3_tytul')) {
      if (!widoczny(t)) continue;
      const x = norm(t.textContent);
      if (/podgl[ąa]d\s+wynik[óo]w/.test(x)) st.push('lab-podglad');
      else if (/^(dodawanie|edycja) zaświadczenia/.test(x)) st.push('zaswiadczenie');
      else st.push('okno#' + maskuj(t.id || '?'));
    }
    if (widoczny(document.querySelector('a[href*="wizhist_f_zastosuj_filtr"]'))) st.push('historia');
    if (document.getElementById('wize_uwagi_term_w') && document.getElementById('chk_zapisz_poz')) st.push('praca');
    if (document.getElementById('tab_poczta_wew_zakladki')) st.push('start');
    if (!st.length && widoczny(document.getElementById('table_div_stronicowanie_wizyty'))) st.push('lista');
    const unikalne = [];
    for (const s of st) if (unikalne.indexOf(s) === -1) unikalne.push(s);
    return unikalne.sort().join('+') || 'inne';
  }

  // --- zrzut (to samo co serum-diag.js z konsoli, plus kilka liczników) ---

  function zrzut(stan) {
    const t00 = performance.now();
    const opis = (el) => !el ? '-' : el.tagName.toLowerCase() + maskuj((el.id ? '#' + el.id : '') +
      (el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''));
    const sciezka = (el) => {
      const p = [];
      for (let e = el, i = 0; e && i < 7; e = e.parentElement, i++) {
        if (e === document.body) { p.push('body'); break; }
        p.push(opis(e));
      }
      return p.join(' < ');
    };
    const atr = (el) => maskuj([...el.attributes].map((a) => a.name + '="' + a.value.slice(0, 70) + '"').join(' '));
    const out = ['=== ' + stan + ' | ' + new Date().toLocaleTimeString('pl-PL') + ' | ' + location.pathname];
    // Powtarzające się wiersze (np. dziesiątki kopii tej samej tabeli) zliczamy.
    const zlicz = new Map();
    const dodaj = (linia) => zlicz.set(linia, (zlicz.get(linia) || 0) + 1);
    const wypiszZliczone = () => {
      for (const [linia, n] of zlicz) out.push(linia + (n > 1 ? '  ×' + n : ''));
      zlicz.clear();
    };

    let t0 = performance.now();
    const wszystkich = document.querySelectorAll('*').length;
    const tQsa = performance.now() - t0;
    t0 = performance.now();
    const dl = document.body.textContent.length;
    const tSer = performance.now() - t0;
    out.push('elementów: ' + wszystkich + ' (querySelectorAll * ' + tQsa.toFixed(1) + ' ms), tekst body: ' + dl +
      ' zn. (serializacja ' + tSer.toFixed(1) + ' ms), tabel: ' + document.getElementsByTagName('table').length);
    let skrHead = 0, skrBody = 0, skrN = 0;
    for (const s of document.getElementsByTagName('script')) {
      skrN++;
      if (document.body.contains(s)) skrBody += s.textContent.length; else skrHead += s.textContent.length;
    }
    let opc = 0, opcN = 0; for (const o of document.getElementsByTagName('option')) { opc += o.textContent.length; opcN++; }
    let ta = 0; for (const t of document.getElementsByTagName('textarea')) ta += t.value.length;
    out.push('<script>: ' + skrN + ' szt., w body ' + skrBody + ' zn., poza body ' + skrHead + ' zn.; <option> ' + opc +
      ' zn. (' + opcN + ' szt.); <textarea> ' + ta + ' zn.');
    out.push('bezpośrednie dzieci body: ' + document.body.children.length +
      ', table#fixedtableheader0 (kopie przyklejonego nagłówka): ' + document.querySelectorAll('[id="fixedtableheader0"]').length);
    const j = jq();
    out.push('jQuery: ' + (j && j.fn ? j.fn.jquery : 'brak') + ', window scroll: ' + grupyHandlerow(handleryJq(window, 'scroll')) +
      '; resize: ' + grupyHandlerow(handleryJq(window, 'resize')));
    let w = document.body;
    const sc = [];
    for (let d = 0; d < 8 && w; d++) {
      const dz = [...w.children].map((c) => [c, c.textContent.length]).sort((a, b) => b[1] - a[1]);
      if (!dz.length) break;
      sc.push(opis(dz[0][0]) + '=' + dz[0][1] + ' (z ' + dz.length + ')');
      w = dz[0][0];
    }
    out.push('największy tekst: ' + sc.join(' > '));

    const okna = [...document.getElementsByClassName('przegladarka')];
    out.push('div.przegladarka: ' + okna.length + ' (widocznych ' + okna.filter(widoczny).length + ')');
    const tytuly = new Map();
    for (const t of document.getElementsByClassName('h3_tytul')) {
      const k = maskuj(t.id || '(bez id)') + (widoczny(t) ? ' W' : '');
      tytuly.set(k, (tytuly.get(k) || 0) + 1);
    }
    out.push('.h3_tytul: ' + [...tytuly].map((p) => p[0] + (p[1] > 1 ? ' ×' + p[1] : '')).join(', '));
    out.push('.popup-window: ' + [...document.getElementsByClassName('popup-window')]
      .map((p) => opis(p) + (widoczny(p) ? ' W' : '')).join(' | '));
    out.push('compatMode: ' + document.compatMode);
    out.push('serum-ui: ' + stanSerumUi());

    const ID = ['wysylkaSmsKodowDostepowychEdokumentow', 'edokumenty_sms_wyslij', 'powodEdycji', 'inp_cda_pin',
      'chkb_cda_pin_zap', 'eReceptaPin', 'electronicIPOMPopup', 'inp_ezla_logowanie_pin', 'inp_ezla_podpis_pin',
      'wize_uwagi_term_w', 'chk_zapisz_poz', 'wizb_wywiad_w', 'wizb_opis_w', 'inp_uni_icd9_szybkie_t',
      'inp_uni_icd9_szybkie_tabela', 'inp_uni_icd9_szybkie_div', 'div_swiadczenie_poz',
      'table_div_stronicowanie_wizyty', 'span_lab_sel', 'ereferralFrame', 'operationResultsPopup',
      'serum2popupWindow', 'ipom', 'hid_ezla_tryb', 'tab_poczta_wew_zakladki', 'tr_pokaz_wiecej_terminow',
      '_uf_przeslona_komunikat', '_uf_przeslona2', 'pb_lista_szablonow', 'issuedPrescriptionTooltip',
      'div_dokumenty_powiazane', 'hid_idkontaktu', 'contentContainer', 'lista'];
    out.push('id (wszystkie/widoczne): ' + ID.map((id) => {
      const all = [...document.querySelectorAll('[id="' + id + '"]')];
      return all.length ? id + '=' + all.length + '/' + all.filter(widoczny).length : null;
    }).filter(Boolean).join(', '));
    for (const e of document.querySelectorAll('[id^="podgladWydruku"]')) {
      dodaj('id^=podgladWydruku: ' + opis(e) + (widoczny(e) ? ' W' : '') + ' w: ' + sciezka(e.parentElement));
    }
    wypiszZliczone();

    // Tabele, które serum-ui rozpoznaje po nagłówku (lista wizyt, zlecenia LABORATORIUM)
    for (const t of document.getElementsByTagName('table')) {
      const hr = (t.tHead && t.tHead.rows[0]) || t.rows[0];
      if (!hr || hr.cells.length > 30) continue;
      const h = (hr.textContent || '').toLowerCase();
      if (h.length > 600) continue;
      const wizyty = h.includes('pacjent') && (h.includes('akcja') || h.includes('pesel') || h.includes('lp'));
      const lab = h.includes('numer zlecenia') && h.includes('zlecone badania');
      if (!wizyty && !lab) continue;
      let wierszy = 0; for (const tb of t.tBodies) wierszy += tb.rows.length;
      dodaj('tabela ' + (wizyty ? 'WIZYTY ' : '') + (lab ? 'LAB ' : '') + opis(t) + (widoczny(t) ? ' W' : '') +
        ' wierszy=' + wierszy + ' w: ' + sciezka(t.parentElement));
    }
    wypiszZliczone();

    for (const f of document.querySelectorAll('iframe, frame')) {
      let src = f.getAttribute('src') || '';
      try { const u = new URL(src, location.href); src = u.protocol === 'blob:' ? 'blob:' : u.origin + u.pathname; } catch (e) {}
      let dostep;
      try { dostep = f.contentDocument ? 'TAK ' + f.contentDocument.contentType + ' elementów=' + f.contentDocument.getElementsByTagName('*').length : 'nie'; } catch (e) { dostep = 'wyjątek'; }
      dodaj('ramka ' + opis(f) + ' src=' + maskuj(src.slice(0, 90)) + ' dostęp=' + dostep + (widoczny(f) ? ' W' : '') +
        ' w: ' + sciezka(f.parentElement));
    }
    wypiszZliczone();

    const zs = [...document.querySelectorAll('a.zal_sms')];
    out.push('a.zal_sms: ' + zs.length + '× ' + zs.slice(0, 2)
      .map((a) => '<a ' + atr(a) + '> w: ' + sciezka(a.parentElement)).join(' | '));

    const FRAZY = ['ważne informacje', 'terminarz na dziś', 'wizyty (edm)', 'zlecone badania', 'podgląd wyników',
      'podgląd wydruku', 'zaświadczeni', 'przerwa między zwolnieniami', 'wizyta z dnia', 'weryfikacja pozytywna',
      'weryfikacja negatywna', 'podpis elektroniczny', 'wysyłka sms', 'powód edycji', 'uwagi z terminarza',
      'czy zapisać świadczenie'];
    const traf = new Map(FRAZY.map((f) => [f, []]));
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      const p = n.parentElement;
      if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') continue;
      const t = n.data.toLowerCase();
      for (const f of FRAZY) if (t.includes(f)) traf.get(f).push(p);
    }
    for (const [f, els] of traf) {
      if (!els.length) { out.push('„' + f + '”: brak'); continue; }
      const wid = els.filter(widoczny);
      out.push('„' + f + '”: ' + els.length + '× (widocznych ' + wid.length + ')');
      const pokaz = wid.concat(els.filter((e) => wid.indexOf(e) === -1)).slice(0, 3);
      for (const el of pokaz) {
        out.push('    ' + (wid.indexOf(el) !== -1 ? 'W ' : 'u ') + '<' + el.tagName.toLowerCase() + ' ' + atr(el) + '>  w: ' + sciezka(el.parentElement));
      }
    }
    const ms = performance.now() - t00;
    out.push('czas zrzutu: ' + ms.toFixed(0) + ' ms');
    return { at: Date.now(), ms: Math.round(ms), txt: out.join('\n') };
  }

  // --- log debug serum-ui ---

  // serum-ui od 3.121 wystawia window.__serumUiLog() — ten sam tekst co
  // „Zapisz log debug do pliku” (wersja, ticki, wyzwalacze, czasy modułów,
  // 800 wpisów). Starsza wersja trzyma w sessionStorage same wpisy.
  const SS_LOG = 'serum_ui_debug_log_v1';

  function wpisySesji() {
    try { const a = JSON.parse(sessionStorage.getItem(SS_LOG) || 'null'); return Array.isArray(a) ? a : null; } catch (e) { return null; }
  }

  function stanSerumUi() {
    if (typeof window.__serumUiLog === 'function') {
      try {
        const t = window.__serumUiLog();
        const g = (re) => { const m = t.match(re); return m ? m[1] : '?'; };
        return g(/^Wersja skryptu: (.*)$/m) + ', wstrzyknięty ' + g(/^Skrypt wstrzyknięty: (.*)$/m) +
          ', ostatni tick ' + g(/^Ostatni uiTick\(\): (.*)$/m);
      } catch (e) { return 'wyjątek: ' + maskuj(e && e.message || e); }
    }
    const w = wpisySesji();
    if (w) return 'bez __serumUiLog (wersja < 3.121), wpisów w sessionStorage ' + w.length +
      (w.length ? ', ostatni: ' + maskuj(w[w.length - 1].slice(0, 60)) : '');
    // 3.120 zapisuje log dopiero 5 s po pierwszym wpisie — pusty nie znaczy jeszcze, że nie działa.
    return 'brak __serumUiLog i logu w sessionStorage (wersja < 3.121 bez wpisów albo skrypt nie działa)';
  }

  // PESEL 11, NIP 10, telefon 9 cyfr — liczniki w nagłówku logu są krótsze.
  const maskujLog = (s) => String(s).replace(/\d{9,}/g, '#');

  function odlozLog() {
    let txt, boot;
    if (typeof window.__serumUiLog === 'function') {
      try { txt = window.__serumUiLog(); } catch (e) { return; }
      const m = txt.match(/^Skrypt wstrzyknięty: (.*?) \(/m);
      boot = m ? m[1] : '?';
    } else {
      const w = wpisySesji();
      if (!w || !w.length) return;
      txt = '(serum-ui < 3.121: tylko wpisy z sessionStorage)\n' + w.join('\n');
      boot = 'sesja';
    }
    let log;
    try { log = JSON.parse(localStorage.getItem(KLUCZ_LOG) || 'null'); } catch (e) { log = null; }
    if (!log || typeof log !== 'object') log = {};
    // Klucz: dzień + chwila wstrzyknięcia — jedno uruchomienie serum-ui = jeden wpis, nadpisywany.
    const klucz = new Date().toLocaleDateString('pl-PL') + ' ' + boot;
    log[klucz] = { at: Date.now(), txt: maskujLog(txt) };
    const klucze = Object.keys(log).sort((a, b) => log[a].at - log[b].at);
    while (klucze.length > LOG_URUCHOMIEN) delete log[klucze.shift()];
    try { localStorage.setItem(KLUCZ_LOG, JSON.stringify(log)); } catch (e) {}
  }

  // --- przyklejony nagłówek: kopie, handlery okna, koszt przewijania (1.2) ---

  // 27.10: kopie table#fixedtableheader0 rosły 9 → 373 w 2 h 20 min (Serum ich
  // nie usuwa). Hipoteza: każde wywołanie wtyczki dokłada też handler
  // window.scroll/resize. Próbki co 5 min odpowiadają na to wprost: liczba
  // kopii obok liczby handlerów jQuery i czasu obsługi zdarzeń przewijania.
  const KLUCZ_PROBKI = 'serum_diag_probki_v1';
  const KLUCZ_KOD = 'serum_diag_kod_v1';
  const PROBKA_CO_ILE_MS = 5 * 60000;
  const PROBEK = 1500;               // ~tydzień pracy, ~150 B każda

  const jq = () => window.jQ || window.jQuery || null;

  function handleryJq(cel, typ) {
    const j = jq();
    if (!j || typeof j._data !== 'function') return null;
    try { const ev = j._data(cel, 'events'); return (ev && ev[typ]) || []; } catch (e) { return null; }
  }

  // Handlery pogrupowane po początku kodu funkcji — od razu widać, który
  // rodzaj się mnoży.
  function grupyHandlerow(lista) {
    if (!lista) return 'brak jQuery';
    const g = new Map();
    for (const h of lista) {
      const k = maskuj(String(h.handler).replace(/\s+/g, ' ').slice(0, 90)) + (h.selector ? ' [deleg. ' + h.selector + ']' : '');
      g.set(k, (g.get(k) || 0) + 1);
    }
    const out = [];
    for (const [k, n] of g) out.push(n + '× ' + k);
    out.sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    return lista.length + ' (' + out.join(' | ') + ')';
  }

  // Czas obsługi przewijania okna: start w fazie przechwytywania na window
  // (przed wszystkimi), koniec w naszym słuchaczu bąbelkowym na window, który
  // co sprawdzenie przepinamy na koniec kolejki — jQuery dokłada swój jeden
  // natywny słuchacz przy pierwszym .scroll(), więc mógłby być po nas.
  // Przewijanie wewnętrznych kontenerów nie bąbelkuje do window i nie jest
  // liczone (start bez końca jest nadpisywany).
  let scrollStart = null;
  let scrollCzasy = [];
  window.addEventListener('scroll', (e) => { scrollStart = { e: e, t: performance.now() }; }, { capture: true, passive: true });
  function koniecScrolla(e) {
    if (!scrollStart || scrollStart.e !== e) return;
    if (scrollCzasy.length < 3000) scrollCzasy.push(performance.now() - scrollStart.t);
    scrollStart = null;
  }
  function przepnijKoniecScrolla() {
    window.removeEventListener('scroll', koniecScrolla);
    window.addEventListener('scroll', koniecScrolla, { passive: true });
  }
  przepnijKoniecScrolla();

  function probka() {
    const c = scrollCzasy;
    scrollCzasy = [];
    c.sort((a, b) => a - b);
    let suma = 0, wolnych = 0;
    for (const x of c) { suma += x; if (x > 16) wolnych++; }
    const hs = handleryJq(window, 'scroll');
    const hr = handleryJq(window, 'resize');
    const p = {
      at: Date.now(),
      stan: poprzedni || '?',
      kopie: document.querySelectorAll('[id="fixedtableheader0"]').length,
      el: document.getElementsByTagName('*').length,
      body: document.body.children.length,
      hs: hs ? hs.length : -1,
      hr: hr ? hr.length : -1,
      sn: c.length,
      ssr: c.length ? +(suma / c.length).toFixed(2) : 0,
      s95: c.length ? +c[Math.min(c.length - 1, Math.floor(c.length * 0.95))].toFixed(1) : 0,
      smax: c.length ? +c[c.length - 1].toFixed(1) : 0,
      s16: wolnych,
    };
    let lista;
    try { lista = JSON.parse(localStorage.getItem(KLUCZ_PROBKI) || 'null'); } catch (e) { lista = null; }
    if (!Array.isArray(lista)) lista = [];
    lista.push(p);
    while (lista.length > PROBEK) lista.shift();
    try { localStorage.setItem(KLUCZ_PROBKI, JSON.stringify(lista)); } catch (e) {}
  }

  // Kod wtyczki ze strony (nie z pamięci) — raz na wersję jQuery/wtyczki.
  function zapiszKodWtyczki() {
    const j = jq();
    const f = j && j.fn && j.fn.fixedtableheader;
    const kod = {
      at: Date.now(),
      jquery: j && j.fn ? j.fn.jquery : 'brak (jQ/jQuery)',
      fixedtableheader: f ? String(f).slice(0, 12000) : 'brak jQ.fn.fixedtableheader',
    };
    try {
      const stary = JSON.parse(localStorage.getItem(KLUCZ_KOD) || 'null');
      if (stary && stary.jquery === kod.jquery && stary.fixedtableheader === kod.fixedtableheader) return;
      localStorage.setItem(KLUCZ_KOD, JSON.stringify(kod));
    } catch (e) {}
  }

  // --- harmonogram ---

  let poprzedni = null;
  let zaplanowany = false;

  function sprawdz() {
    przepnijKoniecScrolla();
    let stan;
    try { stan = wykryjStan(); } catch (e) { return; }
    const stabilny = stan === poprzedni;
    poprzedni = stan;
    if (!stabilny || zaplanowany) return;
    const wpis = dane.zrzuty[stan];
    if (wpis && Date.now() - wpis.ostatni.at < PONOW_PO_MS) return;
    zaplanowany = true;
    const wykonaj = () => {
      zaplanowany = false;
      if (wykryjStan() !== stan) return;   // stan zmienił się w międzyczasie
      let z;
      try { z = zrzut(stan); } catch (e) { z = { at: Date.now(), ms: 0, txt: 'BŁĄD zrzutu: ' + maskuj(e && e.stack || e) }; }
      const w = dane.zrzuty[stan];
      if (w) { w.ostatni = z; w.ile++; } else dane.zrzuty[stan] = { pierwszy: z, ostatni: z, ile: 1 };
      if (zapisz()) console.info('[serum-diag] zrzut „' + stan + '” (' + z.ms + ' ms)');
    };
    // Zrzut przechodzi cały dokument — w wolnej chwili przeglądarki.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(wykonaj, { timeout: 5000 });
    else setTimeout(wykonaj, 0);
  }

  setInterval(sprawdz, CO_ILE_MS);
  setTimeout(zapiszKodWtyczki, 30000);
  setTimeout(probka, 60000);
  setInterval(probka, PROBKA_CO_ILE_MS);
  setTimeout(odlozLog, 60000);
  setInterval(odlozLog, LOG_CO_ILE_MS);
  window.addEventListener('pagehide', odlozLog);
})();
