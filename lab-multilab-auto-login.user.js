// ==UserScript==
// @name         Multilab — auto logowanie (tczew)
// @namespace    local.lab-multilab-auto-login
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-multilab-auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-multilab-auto-login.user.js
// @description  Auto wypełnienie i wysłanie formularza logowania (PESEL + PIN) zapamiętanego przez Tampermonkey
// @match        https://10.1.1.140/page,login*
// @match        http://10.1.1.140/page,login*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY_PESEL = 'multilab_tczew_pesel';
  const STORE_KEY_PIN = 'multilab_tczew_pin';
  const SUBMIT_GRACE_MS = 200;

  const DEBUG_LOG = [];
  function dbg(msg) {
    const line = new Date().toLocaleTimeString('pl-PL', { hour12: false }) + '.' +
      String(new Date().getMilliseconds()).padStart(3, '0') + ' ' + msg;
    DEBUG_LOG.push(line);
    if (DEBUG_LOG.length > 300) DEBUG_LOG.shift();
  }

  if (typeof GM_registerMenuCommand === 'function') {
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

    GM_registerMenuCommand('Pokaż log debug (Multilab login)', () => {
      alert(DEBUG_LOG.join('\n') || '(pusty log)');
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findUsernameField() {
    return document.getElementById('ctl0_Main_username');
  }
  function findPasswordField() {
    return document.getElementById('ctl0_Main_password');
  }
  function findSubmitButton() {
    return document.getElementById('ctl0_Main_ctl4');
  }
  function findErrorMessage() {
    return document.getElementById('ctl0_Main_ctl5');
  }

  function isLoginPage() {
    const u = findUsernameField();
    const p = findPasswordField();
    return isVisible(u) && isVisible(p);
  }

  function hasVisibleError() {
    const err = findErrorMessage();
    return isVisible(err) && (err.textContent || '').trim().length > 0;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let attempted = false;

  function tryLogin() {
    if (attempted) return;
    if (!isLoginPage()) return;

    if (hasVisibleError()) {
      dbg('tryLogin: widoczny komunikat błędu logowania — rezygnuję z auto-loginu na tej stronie');
      attempted = true;
      return;
    }

    const pesel = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY_PESEL, '') : '';
    const pin = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY_PIN, '') : '';
    if (!pesel || !pin) {
      dbg('tryLogin: brak zapisanych danych logowania (użyj menu Tampermonkey „Ustaw dane logowania”)');
      attempted = true;
      return;
    }

    const userField = findUsernameField();
    const passField = findPasswordField();
    if (!userField || !passField) return;

    if (userField.value.trim() || passField.value.trim()) return; // pola już zajęte (ręczny wpis) — nie ruszamy

    attempted = true;
    dbg('tryLogin: wypełniam PESEL + PIN i wysyłam formularz za ' + SUBMIT_GRACE_MS + 'ms');
    setNativeValue(userField, pesel);
    setNativeValue(passField, pin);

    setTimeout(() => {
      const btn = findSubmitButton();
      if (btn) {
        dbg('tryLogin: klik Login');
        btn.click();
      }
    }, SUBMIT_GRACE_MS);
  }

  function boot() {
    tryLogin();
    const observer = new MutationObserver(() => tryLogin());
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15_000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
