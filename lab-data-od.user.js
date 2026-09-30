// ==UserScript==
// @name         Multilab — auto „Data od” (60 dni wstecz)
// @namespace    local.lab-data-od
// @version      1.2.1
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-data-od.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-data-od.user.js
// @description  Po załadowaniu strony Home ustawia „Data od” na 60 dni przed dzisiejszą datą
// @match        https://10.1.1.140/page,Home*
// @match        http://10.1.1.140/page,Home*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    daysBack: 60,
    fieldLabel: 'Data od',
    searchPanelHeading: 'Szukaj',
    maxWaitMs: 120_000,
    retryIntervalMs: 500,
    dataOdSelectors: [
      '#ctl0_Main_edDt1_DateTextBox',
      'input[name="ctl0$Main$edDt1_DateTextBox"]',
      'input[name*="edDt1" i][type="date"]',
    ],
  };

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function formatDateDaysAgo(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - days);

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return {
      iso: `${year}-${month}-${day}`,
      polish: `${day}.${month}.${year}`,
    };
  }

  function findSectionRoot(headingText) {
    const target = headingText.trim().toLowerCase();
    const nodes = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, td, th, legend, label')];

    for (const node of nodes) {
      const ownText = normalizeText(
        [...node.childNodes]
          .filter(
            (n) =>
              n.nodeType === Node.TEXT_NODE ||
              (n.nodeType === Node.ELEMENT_NODE && n.childElementCount === 0)
          )
          .map((n) => n.textContent)
          .join('')
      ).toLowerCase();

      const fullText = normalizeText(node.textContent).toLowerCase();
      if (ownText === target || fullText === target) {
        return node.closest('section, article, fieldset, .panel, .card, div') || node.parentElement;
      }
    }

    return null;
  }

  function matchesFieldLabel(node, label) {
    const target = label.trim().toLowerCase().replace(/:$/, '');
    const ownText = normalizeText(
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

    const fullText = normalizeText(node.textContent).toLowerCase().replace(/:$/, '');
    return ownText === target || (fullText === target && normalizeText(node.textContent).length <= 30);
  }

  function isDataOdField(input) {
    if (!input || input.tagName !== 'INPUT') return false;

    const name = normalizeText(input.name || input.id).toLowerCase();
    if (name.includes('eddt1') || name.includes('eddt1_datetextbox')) return true;
    if (name.includes('eddt2') || name.includes('eddt2_datetextbox')) return false;

    const meta = normalizeText(
      [input.name, input.id, input.placeholder, input.getAttribute('aria-label')].filter(Boolean).join(' ')
    ).toLowerCase();

    if (/\bdata\s*do\b/.test(meta) && !/\bdata\s*od\b/.test(meta)) return false;

    const row = input.closest('tr, .form-group, .field, label, div');
    const rowText = normalizeText(row?.textContent || '').toLowerCase();
    if (rowText.includes('data do') && !rowText.includes('data od')) return false;

    return true;
  }

  function findInputNearLabel(labelNode) {
    if (labelNode.htmlFor) {
      const linked = document.getElementById(labelNode.htmlFor);
      if (linked && isDataOdField(linked)) return linked;
    }

    const row = labelNode.closest('tr');
    if (row) {
      const cells = [...row.querySelectorAll('td, th')];
      const labelIdx = cells.findIndex((cell) => cell === labelNode || cell.contains(labelNode));
      if (labelIdx >= 0) {
        for (let i = labelIdx + 1; i < cells.length; i++) {
          const input = cells[i].querySelector('input[type="date"], input');
          if (input && isDataOdField(input)) return input;
        }
      }
    }

    let sibling = labelNode.nextElementSibling;
    for (let step = 0; step < 4 && sibling; step++) {
      if (sibling.matches?.('input') && isDataOdField(sibling)) return sibling;
      const nested = sibling.querySelector?.('input[type="date"], input');
      if (nested && isDataOdField(nested)) return nested;
      sibling = sibling.nextElementSibling;
    }

    return null;
  }

  function findDataOdField() {
    for (const selector of CONFIG.dataOdSelectors) {
      try {
        const input = document.querySelector(selector);
        if (input) return input;
      } catch {
        // nieprawidłowy selektor
      }
    }

    const panel = findSectionRoot(CONFIG.searchPanelHeading) || document;
    const nodes = [...panel.querySelectorAll('label, span, td, th, legend, p, div')];

    for (const node of nodes) {
      if (!matchesFieldLabel(node, CONFIG.fieldLabel)) continue;
      const input = findInputNearLabel(node);
      if (input) return input;
    }

    return null;
  }

  function setDateField(field, isoDate) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(field, isoDate);
    } else {
      field.value = isoDate;
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyDataOd() {
    const field = findDataOdField();
    if (!field) return false;

    const target = formatDateDaysAgo(CONFIG.daysBack);
    const current = normalizeText(field.value);

    if (current === target.iso) {
      console.info('[lab-data-od] Data od już ustawiona:', target.polish);
      return true;
    }

    setDateField(field, target.iso);

    if (field.value === target.iso) {
      console.info('[lab-data-od] ustawiono Data od:', target.polish, `(${target.iso})`);
      return true;
    }

    console.warn('[lab-data-od] nie udało się ustawić daty, pole:', field.value);
    return false;
  }

  function waitUntil(predicate, onSuccess, { maxWaitMs, intervalMs, onTimeout }) {
    const start = Date.now();

    const attempt = () => {
      if (predicate()) {
        onSuccess();
        return;
      }
      if (Date.now() - start >= maxWaitMs) {
        onTimeout?.();
        return;
      }
      setTimeout(attempt, intervalMs);
    };

    attempt();

    const observer = new MutationObserver(() => {
      if (predicate()) {
        observer.disconnect();
        onSuccess();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    setTimeout(() => observer.disconnect(), maxWaitMs);
  }

  function boot() {
    waitUntil(
      () => Boolean(findDataOdField()),
      () => applyDataOd(),
      {
        maxWaitMs: CONFIG.maxWaitMs,
        intervalMs: CONFIG.retryIntervalMs,
        onTimeout: () => {
          console.info('[lab-data-od] nie znaleziono pola „Data od”');
        },
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();