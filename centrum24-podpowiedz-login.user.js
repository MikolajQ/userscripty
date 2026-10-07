// ==UserScript==
// @name         Erste centrum24 - podpowiedź loginu
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/centrum24-podpowiedz-login.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/centrum24-podpowiedz-login.user.js
// @description  Logowanie do centrum24 (Erste): w polu „Login” podpowiada zapamiętane loginy. Pierwszy login wpisany ręcznie zostaje zapamiętany po kliknięciu „Dalej”.
// @match        https://www.centrum24.pl/centrum24-web/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Repo jest publiczne — loginy nie są w kodzie, tylko w pamięci Tampermonkeya.
  const KLUCZ = 'centrum24_loginy';
  const SELEKTOR = 'input#login-input';
  const MAKS = 20; // maxlength pola

  const wczytaj = () => {
    const v = GM_getValue(KLUCZ, []);
    return Array.isArray(v) ? v : [];
  };
  const zapisz = (lista) => GM_setValue(KLUCZ, lista);

  // Pole ma valueismasked="true" — wartość może być zastąpiona kropkami
  // lub gwiazdkami; takiej nie zapamiętujemy.
  const poprawnyLogin = (s) =>
    typeof s === 'string' && s.length >= 3 && s.length <= MAKS && !/[\s*•●·]/.test(s);

  function zapamietaj(login) {
    if (!poprawnyLogin(login)) return;
    // Ostatnio użyty na początek listy.
    const lista = wczytaj().filter((l) => l !== login);
    lista.unshift(login);
    zapisz(lista.slice(0, 10));
  }

  GM_registerMenuCommand('Dodaj login do podpowiedzi', () => {
    const login = (prompt('Login:') || '').trim();
    if (!login) return;
    if (!poprawnyLogin(login)) { alert('Niepoprawny login.'); return; }
    zapamietaj(login);
  });
  GM_registerMenuCommand('Wyczyść zapamiętane loginy', () => {
    if (confirm('Usunąć wszystkie zapamiętane loginy (' + wczytaj().length + ')?')) zapisz([]);
  });

  const style = document.createElement('style');
  style.textContent = `
    .c24-login-lista {
      position: absolute; z-index: 10000; margin: 0; padding: 4px 0; list-style: none;
      background: #fff; border: 1px solid #8a94a6; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,.18); font-size: 16px; line-height: 28px;
    }
    .c24-login-lista li { padding: 4px 16px; cursor: pointer; }
    .c24-login-lista li.aktywny, .c24-login-lista li:hover { background: #e8f0fe; color: #2870ed; }
  `;
  document.head.appendChild(style);

  // Angular słucha zdarzenia input; natywny setter omija ewentualne
  // nadpisanie właściwości value przez komponent.
  function ustawWartosc(input, wartosc) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, wartosc);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function podepnij(input) {
    if (input.dataset.c24Login) return;
    input.dataset.c24Login = '1';

    const ul = document.createElement('ul');
    ul.className = 'c24-login-lista';
    ul.hidden = true;
    document.body.appendChild(ul);
    let aktywny = -1;
    // Ostatnia niezamaskowana wartość — to ją zapamiętujemy przy „Dalej”.
    let wpisany = '';

    function pokaz() {
      const tekst = input.value;
      const pasujace = wczytaj().filter((l) =>
        l !== tekst && l.toLowerCase().startsWith(poprawnyLogin(tekst) ? tekst.toLowerCase() : ''));
      ul.replaceChildren(...pasujace.map((l) => {
        const li = document.createElement('li');
        li.textContent = l;
        // mousedown zamiast click — przed blur pola, które schowałoby listę.
        li.addEventListener('mousedown', (e) => { e.preventDefault(); wybierz(l); });
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
    function wybierz(login) {
      ustawWartosc(input, login);
      wpisany = login;
      schowaj();
    }

    input.addEventListener('focus', pokaz);
    input.addEventListener('input', () => {
      if (poprawnyLogin(input.value) || input.value === '') wpisany = input.value;
      pokaz();
    });
    input.addEventListener('blur', schowaj);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (ul.hidden || aktywny < 0)) { zapamietaj(wpisany); return; }
      if (ul.hidden) return;
      const n = ul.children.length;
      if (e.key === 'ArrowDown') { aktywny = (aktywny + 1) % n; podswietl(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { aktywny = (aktywny - 1 + n) % n; podswietl(); e.preventDefault(); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && aktywny >= 0) {
        wybierz(ul.children[aktywny].textContent);
        if (e.key === 'Enter') e.preventDefault();
      } else if (e.key === 'Escape') schowaj();
    });

    // Zapamiętujemy dopiero przy wysłaniu („Dalej” / submit) — nie przy
    // każdym wyjściu z pola, żeby nie łapać niedokończonych wpisów.
    const form = input.closest('form');
    form?.addEventListener('submit', () => zapamietaj(wpisany), true);
    const naKlik = (e) => {
      const btn = e.target.closest('button');
      if (btn && (btn.type === 'submit' || /^\s*dalej\s*$/i.test(btn.textContent)) &&
          (!form || form.contains(btn) || btn.closest('app-login'))) {
        zapamietaj(wpisany);
      }
    };
    document.addEventListener('click', naKlik, true);

    // Pole ma appautofocus — zwykle jest aktywne, zanim skrypt się podepnie.
    if (document.activeElement === input) pokaz();

    // SPA: po zniknięciu pola sprzątamy listę.
    const sprzatacz = new MutationObserver(() => {
      if (!input.isConnected) {
        ul.remove(); sprzatacz.disconnect();
        document.removeEventListener('click', naKlik, true);
      }
    });
    sprzatacz.observe(document.body, { childList: true, subtree: true });
  }

  const skanuj = () => document.querySelectorAll(SELEKTOR).forEach(podepnij);
  new MutationObserver(skanuj).observe(document.body, { childList: true, subtree: true });
  skanuj();
})();
