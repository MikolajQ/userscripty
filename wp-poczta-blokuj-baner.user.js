// ==UserScript==
// @name         WP Poczta - poprawki interfejsu (baner + scroll)
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/wp-poczta-blokuj-baner.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/wp-poczta-blokuj-baner.user.js
// @description  Ukrywa górny, pomarańczowy baner reklamowy z przyciskiem "ROZWIŃ" na poczta.wp.pl oraz zepsute wiersze reklam wstawione na listę maili (skeleton, który nigdy się nie wczytuje, bo jego skrypt blokuje CSP strony) — dopasowanie po treści i rozmiarze, nie po nazwach klas CSS (te WP losuje przy każdym wdrożeniu) — automatycznie zaznacza i usuwa maile od nadawców z "/WP" w nazwie (reklamy partnerskie) — a także naprawia przewijanie kółkiem myszy, które strona blokuje przez preventDefault() na wheel.
// @match        https://poczta.wp.pl/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Baner reklamowy ma przycisk z tym tekstem. WP renderuje go wielkimi
  // literami przez CSS (text-transform: uppercase), ale sam DOM może
  // zawierać "Rozwiń" pisane inną wielkością liter — dlatego dopasowanie
  // musi być bez rozróżniania wielkości liter.
  const TRIGGER_RE = /^rozwiń\b/i;

  const hiddenContainers = new WeakSet();
  let scheduled = false;

  function isLeafish(el) {
    // Sam przycisk/etykieta, nie duży kontener z wieloma dziećmi.
    return el.children.length <= 2;
  }

  function findAdContainer(trigger) {
    // Baner to poziomy pasek u góry strony: pełna szerokość, niewielka
    // wysokość, tuż przy górnej krawędzi widoku. Wspinamy się po przodkach
    // i bierzemy NAJBARDZIEJ ZEWNĘTRZNEGO z pasujących — reklama bywa
    // zagnieżdżona w kilku "cienkich" wrapperach, z których każdy osobno
    // rezerwuje wysokość (dlatego ukrycie samego wewnętrznego diva potrafiło
    // zostawiać puste miejsce). Wychodzimy z pętli, gdy trafimy na przodka,
    // który już nie pasuje do kształtu baneru (bo to np. cały <body>).
    let el = trigger;
    let candidate = null;
    for (let depth = 0; depth < 12 && el && el !== document.body; depth++) {
      const rect = el.getBoundingClientRect();
      const looksLikeBanner = rect.top < 250 && rect.width > 300 && rect.height >= 10 && rect.height <= 250;
      if (looksLikeBanner) {
        candidate = el;
      } else if (candidate) {
        break;
      }
      el = el.parentElement;
    }
    return candidate;
  }

  function collapse(el) {
    hiddenContainers.add(el);
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('min-height', '0', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    // Baner czasem trzyma layout w trybie "z miejscem na reklamę" przez
    // klasę na <body> — usuwamy najbardziej prawdopodobną, jeśli występuje.
    document.body?.classList.remove('floating-headline');
  }

  function findReservedAdSlot() {
    // Po zniknięciu tekstu "ROZWIŃ" zostaje pusty wrapper, który wciąż
    // rezerwuje miejsce (typowe dla slotów reklamowych — mają ustaloną
    // wysokość niezależną od tego, czy coś się w nich renderuje). Szukamy go
    // po kształcie, nie po treści: leży tuż przy górnej krawędzi dokumentu,
    // jest (prawie) na pełną szerokość, ma niewielką wysokość, jest pusty
    // (brak tekstu, mało dzieci, przezroczyste tło) — to odróżnia go od
    // widocznego paska nawigacji WP, który ma tekst i własne tło.
    const candidates = document.querySelectorAll(
      'body > div, body > div > div, body > div > div > div, body > div > div > div > div'
    );
    for (const el of candidates) {
      if (hiddenContainers.has(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < -2 || rect.top > 10) continue;
      if (rect.width < window.innerWidth * 0.8) continue;
      if (rect.height < 20 || rect.height > 150) continue;
      if (el.children.length > 3) continue;
      if ((el.textContent || '').trim() !== '') continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(bg)) continue;
      return el;
    }
    return null;
  }

  // Reklamy wstawione JAKO WIERSZE listy maili (między prawdziwymi
  // wiadomościami) — treść to trwały "szkielet" (skeleton) ładowania, bo
  // skrypt reklamy (pub.dv.tech/...) jest blokowany przez CSP strony i nigdy
  // się nie wczytuje — wiersz zostaje na zawsze pusty/migoczący, tylko
  // zajmując miejsce. Próba dopasowania po `[role="option"]` (tak jak
  // prawdziwe wiadomości) zawiodła — inspektor pokazał DRUGI wariant tej
  // samej reklamy w zwykłym <div> BEZ role="option" wcale. Jedyny sygnał
  // wspólny obu wariantom to klasa siatki: WP koduje w niej wprost nazwy
  // obszarów grid-template-areas, a ta reklama ma "adInfo"/"adContent" —
  // czego prawdziwa wiadomość (inny układ: nadawca/temat/data) nie ma.
  const AD_GRID_CLASS_RE = /adInfo_adContent/;

  function findAdGridContainers() {
    return [...document.querySelectorAll('div')].filter((el) => AD_GRID_CLASS_RE.test(el.className || ''));
  }

  function findAdRowContainer(gridEl) {
    // Wspinamy się od kontenera siatki reklamy w górę, biorąc NAJBARDZIEJ
    // ZEWNĘTRZNEGO przodka, który wciąż wygląda jak pojedynczy wiersz listy
    // (rozsądna wysokość, prawie pełna szerokość) — tak jak przy banerze
    // u góry strony (findAdContainer) — żeby ukryć całe zarezerwowane
    // miejsce, nie tylko wewnętrzną siatkę.
    let el = gridEl;
    let candidate = gridEl;
    for (let depth = 0; depth < 8 && el.parentElement; depth++) {
      const parent = el.parentElement;
      const rect = parent.getBoundingClientRect();
      const looksLikeRow = rect.height > 0 && rect.height <= 150 && rect.width > 300;
      if (!looksLikeRow) break;
      candidate = parent;
      el = parent;
    }
    return candidate;
  }

  function scanAdRows() {
    for (const gridEl of findAdGridContainers()) {
      const row = findAdRowContainer(gridEl);
      if (!row || hiddenContainers.has(row)) continue;
      collapse(row);
    }
  }

  function scan() {
    for (const el of document.querySelectorAll('button, a, div, span')) {
      if (!isLeafish(el)) continue;
      if (!TRIGGER_RE.test((el.textContent || '').trim())) continue;

      const container = findAdContainer(el);
      if (!container || hiddenContainers.has(container)) continue;
      collapse(container);
    }

    const reserved = findReservedAdSlot();
    if (reserved) collapse(reserved);

    scanAdRows();
    scanSenderSpam();
  }

  // --- AUTOMATYCZNE ZAZNACZANIE I USUWANIE MAILI OD NADAWCÓW "/WP" ---
  //
  // To reklamy partnerskie (np. "Mazda Polska /WP"), nigdy nieczytane.
  // Wiersz maila to <div role="option"> (lista ma role="listbox"
  // aria-multiselectable="true" — to wzorzec ARIA listbox/option, część
  // kontraktu dostępności, a nie losowana przy wdrożeniu klasa CSS).
  // Nazwa nadawcy to pierwszy w kolejności DOM element z klasą "trunc_true"
  // wewnątrz wiersza — w markupie kolumna nadawcy poprzedza siatkę z
  // tematem/datą (grid-template-areas zawierające "mailContent"), więc
  // pierwsze trafienie zawsze jest nadawcą, nigdy tematem.
  const SENDER_SPAM_RE = /\/WP\b/;

  function getSenderText(row) {
    const el = row.querySelector('.trunc_true');
    return el ? (el.textContent || '').trim() : '';
  }

  function isCheckboxChecked(checkbox) {
    return checkbox.getAttribute('aria-checked') === 'true' || checkbox.dataset.state === 'checked';
  }

  function findDeleteButton() {
    for (const btn of document.querySelectorAll('button')) {
      if ((btn.textContent || '').trim() === 'Usuń') return btn;
    }
    return null;
  }

  function scanSenderSpam() {
    let selectedAny = false;
    for (const row of document.querySelectorAll('[role="option"]')) {
      if (hiddenContainers.has(row)) continue;
      if (!SENDER_SPAM_RE.test(getSenderText(row))) continue;

      const checkbox = row.querySelector('button[role="checkbox"]');
      if (!checkbox || isCheckboxChecked(checkbox)) continue;

      checkbox.click();
      selectedAny = true;
    }

    // Pasek narzędzi z przyciskiem "Usuń" pojawia się dopiero po
    // przerenderowaniu stanu zaznaczenia — dajemy React jedną klatkę.
    if (selectedAny) {
      requestAnimationFrame(() => {
        findDeleteButton()?.click();
      });
    }
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  }

  const observer = new MutationObserver(scheduleScan);

  function start() {
    scan();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Siatka bezpieczeństwa: reklama czasem znika po dłuższym czasie w sposób,
    // który nie wywołuje obserwowanych mutacji (np. zmiana wewnątrz iframe'a
    // reklamowego). Krótkie dodatkowe odpytywanie tylko przy starcie strony,
    // bez trzymania stałego interwału przez cały czas sesji.
    let ticks = 0;
    const safetyNet = setInterval(() => {
      scheduleScan();
      if (++ticks >= 20) clearInterval(safetyNet);
    }, 1000);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  // --- NAPRAW PRZEWIJANIE KÓŁKIEM MYSZY ---
  //
  // Coś na stronie blokuje domyślne przewijanie (preventDefault na wheel) —
  // strona przewija się tylko przez przeciąganie suwaka. Zamiast szukać, co
  // dokładnie to blokuje, odtwarzamy przewijanie ręcznie.

  function findScrollTarget(start, deltaY) {
    // Jeśli kursor jest nad elementem z prawdziwym własnym scrollem
    // (overflow-y: auto/scroll, jeszcze niedojechanym do końca), przewijamy
    // jego — tak jak zrobiłaby to przeglądarka. W przeciwnym razie całą
    // stronę (document.scrollingElement — poprawnie działa też w trybie
    // zgodności wstecznej, gdzie "scrollującym" elementem jest <body>).
    let el = start;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollHeight > el.clientHeight + 1) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          const atTop = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return el;
        }
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  window.addEventListener(
    'wheel',
    (e) => {
      const target = findScrollTarget(e.target, e.deltaY);
      target.scrollTop += e.deltaY;
      target.scrollLeft += e.deltaX;
    },
    { passive: true }
  );
})();
