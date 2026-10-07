// ==UserScript==
// @name         KSeF - podpowiedź NIP przy logowaniu
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/ksef-podpowiedz-nip.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/ksef-podpowiedz-nip.user.js
// @description  Aplikacja Podatnika KSeF: w polu „NIP firmy” (wybór kontekstu logowania) podpowiada zapamiętane NIP-y. Pierwszy poprawny NIP wpisany ręcznie zostaje zapamiętany.
// @match        https://ap.ksef.mf.gov.pl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Repo jest publiczne — NIP-y nie są w kodzie, tylko w pamięci Tampermonkeya.
  const KLUCZ = 'ksef_nipy';
  const SELEKTOR = 'input#enter-context__nip, input[formcontrolname="nip"]';

  const wczytaj = () => {
    const v = GM_getValue(KLUCZ, []);
    return Array.isArray(v) ? v : [];
  };
  const zapisz = (lista) => GM_setValue(KLUCZ, lista);

  // Suma kontrolna NIP — żeby nie zapamiętywać literówek.
  function poprawnyNip(nip) {
    if (!/^\d{10}$/.test(nip)) return false;
    const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    const suma = wagi.reduce((s, w, i) => s + w * Number(nip[i]), 0);
    return suma % 11 === Number(nip[9]);
  }

  function zapamietaj(nip) {
    nip = String(nip).replace(/\D/g, '');
    if (!poprawnyNip(nip)) return;
    // Ostatnio użyty na początek listy.
    const lista = wczytaj().filter((n) => n !== nip);
    lista.unshift(nip);
    zapisz(lista.slice(0, 10));
  }

  GM_registerMenuCommand('Dodaj NIP do podpowiedzi', () => {
    const nip = (prompt('NIP (10 cyfr):') || '').replace(/\D/g, '');
    if (!nip) return;
    if (!poprawnyNip(nip)) { alert('Niepoprawny NIP (suma kontrolna).'); return; }
    zapamietaj(nip);
  });
  GM_registerMenuCommand('Wyczyść zapamiętane NIP-y', () => {
    if (confirm('Usunąć wszystkie zapamiętane NIP-y (' + wczytaj().join(', ') + ')?')) zapisz([]);
  });

  const style = document.createElement('style');
  style.textContent = `
    .ksef-nip-lista {
      position: absolute; z-index: 10000; margin: 0; padding: 4px 0; list-style: none;
      background: #fff; border: 1px solid #717171; border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,.18); font: 400 16px/28px "Open Sans", sans-serif;
    }
    .ksef-nip-lista li { padding: 2px 14px; cursor: pointer; letter-spacing: .2px; }
    .ksef-nip-lista li.aktywny, .ksef-nip-lista li:hover { background: #e5eef6; color: #0052a5; }
  `;
  document.head.appendChild(style);

  // Angular (reactive forms) słucha zdarzenia input; natywny setter omija
  // ewentualne nadpisanie właściwości value przez framework.
  function ustawWartosc(input, wartosc) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, wartosc);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function podepnij(input) {
    if (input.dataset.ksefNip) return;
    input.dataset.ksefNip = '1';

    const ul = document.createElement('ul');
    ul.className = 'ksef-nip-lista';
    ul.hidden = true;
    document.body.appendChild(ul);
    let aktywny = -1;

    function pokaz() {
      const wpisane = input.value.replace(/\D/g, '');
      const pasujace = wczytaj().filter((n) => n.startsWith(wpisane) && n !== wpisane);
      ul.replaceChildren(...pasujace.map((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        // mousedown zamiast click — przed blur pola, które schowałoby listę.
        li.addEventListener('mousedown', (e) => { e.preventDefault(); wybierz(n); });
        return li;
      }));
      aktywny = pasujace.length ? 0 : -1;
      podswietl();
      if (!pasujace.length || !input.isConnected) { ul.hidden = true; return; }
      const r = input.getBoundingClientRect();
      ul.style.left = (r.left + window.scrollX) + 'px';
      ul.style.top = (r.bottom + window.scrollY + 2) + 'px';
      ul.style.minWidth = r.width + 'px';
      ul.hidden = false;
    }
    function schowaj() { ul.hidden = true; }
    function podswietl() {
      [...ul.children].forEach((li, i) => li.classList.toggle('aktywny', i === aktywny));
    }
    function wybierz(nip) {
      ustawWartosc(input, nip);
      zapamietaj(nip);
      schowaj();
    }

    input.addEventListener('focus', pokaz);
    input.addEventListener('input', pokaz);
    input.addEventListener('blur', () => {
      schowaj();
      zapamietaj(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (ul.hidden) return;
      const n = ul.children.length;
      if (e.key === 'ArrowDown') { aktywny = (aktywny + 1) % n; podswietl(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { aktywny = (aktywny - 1 + n) % n; podswietl(); e.preventDefault(); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && aktywny >= 0) {
        wybierz(ul.children[aktywny].textContent);
        if (e.key === 'Enter') e.preventDefault();
      } else if (e.key === 'Escape') schowaj();
    });
    // Enter na formularzu bez blur — zapamiętaj też przy wysłaniu.
    input.form?.addEventListener('submit', () => zapamietaj(input.value), true);

    // Pole często dostaje autofocus zanim skrypt się podepnie.
    if (document.activeElement === input) pokaz();

    // SPA: po zniknięciu pola sprzątamy listę.
    const sprzatacz = new MutationObserver(() => {
      if (!input.isConnected) { ul.remove(); sprzatacz.disconnect(); }
    });
    sprzatacz.observe(document.body, { childList: true, subtree: true });
  }

  const skanuj = () => document.querySelectorAll(SELEKTOR).forEach(podepnij);
  new MutationObserver(skanuj).observe(document.body, { childList: true, subtree: true });
  skanuj();
})();
