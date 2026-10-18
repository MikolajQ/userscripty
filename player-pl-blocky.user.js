// ==UserScript==
// @name         Player.pl - odtwarzanie mimo blokady DNS (blocky)
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/player-pl-blocky.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/player-pl-blocky.user.js
// @description  Blocky blokuje cdn.cookielaw.org (OneTrust), przez co strona nie tworzy window.dataLayer i inicjalizacja odtwarzacza pada na "window.dataLayer is undefined". Blokuje też tvn.adocean.pl / tvn.hit.gemius.pl, przez co wykrywacz adblocka w SDK TVN zgłasza "DETECTED" i Nuvi wstrzymuje materiał. Skrypt tworzy pusty dataLayer i podstawia udane, puste odpowiedzi na fetch do tych hostów (pusty VAST = brak reklam).
// @match        https://player.pl/*
// @match        https://*.player.pl/*
// @grant        none
// @sandbox      raw
// @inject-into  page
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // dataLayer tworzy dopiero snippet GTM w index.html, i to po zdarzeniach
  // pix2loaded ORAZ OneTrust — bez OneTrust nigdy. Tymczasem init odtwarzacza
  // (chunk portalu) robi `window.dataLayer.access_model = ...` i bez tego
  // rzuca TypeError, więc Nuvi w ogóle nie startuje. Snippet GTM robi
  // `w[l]=w[l]||[]`, więc wcześniejsza tablica mu nie przeszkadza.
  window.dataLayer = window.dataLayer || [];

  // Hosty blokowane przez blocky, o które pyta wykrywacz adblocka / SDK
  // reklamowe (at-app.cdntvn.pl, 3.10.x). recontent/rcontent/scontent to
  // first-party proxy TVN na adocean i gemius.
  const FAKE_HOSTS = [
    /(^|\.)adocean\.pl$/,
    /(^|\.)gemius\.pl$/,
    /^(recontent|rcontent|scontent)\.services\.tvn\.pl$/,
  ];

  // Pusty VAST = "brak reklamy do wyświetlenia", legalny stan dla SDK.
  const EMPTY_VAST = '<?xml version="1.0" encoding="UTF-8"?><VAST version="4.0"></VAST>';
  // Przezroczysty GIF 1x1 (redot.gif gemiusa).
  const GIF_1X1 = Uint8Array.from(
    atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
    (c) => c.charCodeAt(0)
  );

  function targetHost(input) {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
      const url = new URL(raw, location.href);
      return FAKE_HOSTS.some((re) => re.test(url.hostname)) ? url : null;
    } catch (e) {
      return null;
    }
  }

  function fakeResponse(url) {
    if (/\.gif$/i.test(url.pathname)) {
      return new Response(GIF_1X1, { status: 200, headers: { 'Content-Type': 'image/gif' } });
    }
    if (/\/ad\.xml$/i.test(url.pathname) || /adocean\.pl$|recontent\./.test(url.hostname)) {
      return new Response(EMPTY_VAST, { status: 200, headers: { 'Content-Type': 'text/xml' } });
    }
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = targetHost(input);
    if (url) {
      console.debug('[player-pl-blocky] podstawiono odpowiedź:', url.href);
      return Promise.resolve(fakeResponse(url));
    }
    return origFetch.apply(this, arguments);
  };
  // SDK nie sprawdza natywności, ale niech toString() wygląda jak oryginał.
  window.fetch.toString = () => origFetch.toString();
})();
