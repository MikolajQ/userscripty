// ==UserScript==
// @name         NFZ — kod świadczeniodawcy przy logowaniu
// @namespace    local.nfz-kod-swiadczeniodawcy
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/nfz-kod-swiadczeniodawcy.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/nfz-kod-swiadczeniodawcy.user.js
// @description  Logowanie NFZ (dt.nfz.gov.pl): wpisuje zapamiętany kod świadczeniodawcy w puste pole. Kod ustawia się z menu Tampermonkeya.
// @match        https://dt.nfz.gov.pl/ap-idp-mfa/user/auth/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Repo jest publiczne — kod nie jest w skrypcie, tylko w pamięci Tampermonkeya.
  const KLUCZ = 'nfz_kod_swiadczeniodawcy';
  // id/name pola ("FFFRAXswiad") wygląda na generowane, więc szukamy po układzie formularza.
  const SELEKTOR = 'form.auth-login-form .auth-swiad input.login';

  GM_registerMenuCommand('Ustaw kod świadczeniodawcy', () => {
    const pole = document.querySelector(SELEKTOR);
    // Podpowiedź: to, co jest w polu (np. wybrane z listy strony), inaczej zapamiętany kod.
    const kod = prompt('Kod świadczeniodawcy (puste = nie wpisuj):',
      (pole && pole.value.trim()) || GM_getValue(KLUCZ, ''));
    if (kod === null) return;
    GM_setValue(KLUCZ, kod.trim());
    if (pole && kod.trim()) pole.value = kod.trim();
  });

  const kod = GM_getValue(KLUCZ, '');
  if (!kod) return;

  // Sama wartość, bez zdarzeń input — te otwierałyby listę autouzupełniania strony.
  const wpisz = (pole) => { if (!pole.value) pole.value = kod; };

  const pole = document.querySelector(SELEKTOR);
  if (pole) { wpisz(pole); return; }

  // Formularz dorysowany później — czekamy chwilę i odpinamy obserwatora.
  const obs = new MutationObserver(() => {
    const p = document.querySelector(SELEKTOR);
    if (p) { obs.disconnect(); wpisz(p); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 10000);
})();
