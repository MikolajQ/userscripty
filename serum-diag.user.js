// ==UserScript==
// @name         Serum — diagnostyka DOM (tymczasowa)
// @namespace    local.serum-diag
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-diag.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/serum-diag.user.js
// @description  Sam robi zrzuty struktury strony Serum (id, klasy, tabele, ramki, liczniki) w kolejnych stanach pracy i zapisuje je w localStorage — dane do dalszej optymalizacji serum-ui. Niczego nie zmienia na stronie, wyłącza się sam po 7 dniach.
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
  // do analizy struktury strony.
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
      else st.push('popup#' + (p.id || '?'));
    }
    for (const el of document.querySelectorAll('[id^="podgladWydruku"]')) {
      if (widoczny(el)) { st.push('wydruk'); break; }
    }
    for (const t of document.getElementsByClassName('h3_tytul')) {
      if (!widoczny(t)) continue;
      const x = norm(t.textContent);
      if (/podgl[ąa]d\s+wynik[óo]w/.test(x)) st.push('lab-podglad');
      else if (/^(dodawanie|edycja) zaświadczenia/.test(x)) st.push('zaswiadczenie');
      else st.push('okno#' + (t.id || '?'));
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
    const opis = (el) => !el ? '-' : el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '');
    const sciezka = (el) => {
      const p = [];
      for (let e = el, i = 0; e && i < 7; e = e.parentElement, i++) {
        if (e === document.body) { p.push('body'); break; }
        p.push(opis(e));
      }
      return p.join(' < ');
    };
    const atr = (el) => [...el.attributes].map((a) => a.name + '="' + a.value.slice(0, 70) + '"').join(' ');
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
      const k = (t.id || '(bez id)') + (widoczny(t) ? ' W' : '');
      tytuly.set(k, (tytuly.get(k) || 0) + 1);
    }
    out.push('.h3_tytul: ' + [...tytuly].map((p) => p[0] + (p[1] > 1 ? ' ×' + p[1] : '')).join(', '));
    out.push('.popup-window: ' + [...document.getElementsByClassName('popup-window')]
      .map((p) => opis(p) + (widoczny(p) ? ' W' : '')).join(' | '));
    out.push('compatMode: ' + document.compatMode);

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
      dodaj('ramka ' + opis(f) + ' src=' + src.slice(0, 90) + ' dostęp=' + dostep + (widoczny(f) ? ' W' : '') +
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
    return { at: Date.now(), ms: Math.round(ms), txt: maskuj(out.join('\n')) };
  }

  // --- harmonogram ---

  let poprzedni = null;
  let zaplanowany = false;

  function sprawdz() {
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
})();
