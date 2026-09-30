// ==UserScript==
// @name         Kopiowanie wyników badań → Serum (BADANIE PRZEDMIOTOWE)
// @namespace    local.lab-to-serum
// @version      0.6.30
// @updateURL    https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-to-serum.user.js
// @downloadURL  https://raw.githubusercontent.com/MikolajQ/userscripty/main/lab-to-serum.user.js
// @description  Automatycznie kopiuje wyniki badań ze strony laboratorium do schowka
// @match        https://10.1.1.140/*
// @match        http://10.1.1.140/*
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DONE_KEY = 'lab_to_serum_done_v1';

  const CONFIG = {
    autoRun: true,
    maxWaitMs: 120_000,
    retryIntervalMs: 1_000,
    showManualButtons: true,
    lab: {
      // Strona 10.1.1.140 — tabela „Wynik badania diagnostycznego” (Nazwa / Jednostka / Wartość / Normy)
      resultsHeading: 'Wynik badania diagnostycznego',
      patientHeading: 'Dane pacjenta',
      includePatientInfo: true,
      includeNorms: true,
      includeUnit: true,
      // Nagłówek sekcji — data z „Data wydruku” w formacie DD.MM.YYYY
      sectionHeaderTemplate: '{data}',
      dateSeparator: '--------------------',
      // Nie kopiuj listy badań po lewej (Lp. / Pacjent / Pracownia)
      ignoreTableHeaders: ['lp.', 'lista badań'],
      // Automatycznie klika każdy przycisk „Wynik” w liście badań
      clickAllWynikButtons: true,
      wynikButtonText: 'Wynik',
      wynikReadyWaitMs: 2_500,
      delayBetweenClicksMs: 120,
      inProgressText: 'Wynik w opracowaniu',
      inProgressSkipDelayMs: 80,
      inProgressFallbackDelayMs: 350, // banner „w opracowaniu” wystarcza sam, gdy Pracownia się nie dopasowała na czas
      staleTableSkipMs: 280,
      patientSearchLabel: 'Pacjent / Pesel',
      searchPanelHeading: 'Szukaj',
      requireListaMatch: true,
      excludeResultNames: ['Ilość glukozy'],
      // Parametry z różnych badań scalane w jedną sekcję (kolejność w sekcji wg listy names)
      resultGroups: [
        { id: 'thyroid', names: ['TSH', 'FT3', 'FT4', 'fT3', 'fT4'] },
        {
          id: 'b12',
          names: ['B12', 'witamina B12', 'kwas foliowy', 'folian', 'homocysteina'],
        },
        {
          id: 'iron',
          names: [
            'żelazo',
            'TIBC',
            'ferrytyna',
            'ferritin',
            'ferritina',
            '=FER',
            'transferyna',
            'wysycenie transferyny',
            'sat. transferyny',
          ],
        },
        {
          id: 'calcium',
          names: [
            'wapń',
            'wapń zjonizowany',
            'Witamina D3 Tot (25-OH)',
          ],
        },
        {
          id: 'glucoseInsulin',
          names: [
            'Glukoza na czczo',
            'Glukoza po 120 min',
            'Glukoza 120 min',
            'Glukoza',
            'Insulina na czczo',
            'Insulina po 120 min',
            'Insulina',
          ],
        },
        {
          id: 'crpFibrynogen',
          names: ['CRP', 'białko C-reaktywne', 'fibrynogen'],
        },
      ],
      shippingLabFooter: 'Badanie wysyłkowe <<<=========<<',
      outOfRangeMarker: ' <<-------',
      // Morfologia — WYJĄTKI: standardowe oznaczanie (poza normą = strzałka)
      morphologyKeyParams: [
        'WBC',
        'RBC',
        'HGB',
        'MPV',
        'MCV',
        'MCH',
        'PLT',
        'HCT',
        'RDW',
        'hematokryt',
        'leukocyty',
        'erytrocyty',
        'hemoglobina',
        'płytki krwi',
        'trombocyty',
      ],
      // Morfologia — liczby bezwzględne rozmycia (NEU, LYM…): reguła 40%
      morphologyDiffCountParams: [
        'NEU',
        'LYM',
        'MON',
        'MONO',
        'EOS',
        'EO',
        'BAS',
        'BAZO',
        'IG',
        'GRA',
      ],
      // Morfologia — pozostałe parametry (MCHC, PDW…): reguła 40%
      morphologyOtherHints: [
        'neu%',
        'neu %',
        'lym%',
        'lym %',
        'mono%',
        'eo%',
        'eos%',
        'eoz%',
        'bas%',
        'bazo%',
        'mon%',
        'neutro',
        'limf',
        'mono',
        'eozyn',
        'bazof',
        'mchc',
        'pdw',
        'retikul',
        'nrbc',
        'blast',
        'aniz',
        'poik',
        'niedojrz',
        'jac3',
        'ig#',
        'ig %',
      ],
      morphologyDeviationRatio: 0.4,
      obParamNames: ['OB', 'O.B.', 'odczyn biernackiego'],
      // Stałe progi — oznaczaj niezależnie od normy na wydruku
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
    },
  };

  let labWatcher = null;
  let autoCopyUserGesture = false;
  let searchRequested = false;
  let searchRequestedAt = 0;
  let searchBaselineLista = '';
  let suppressSearchReset = false;
  let isCollecting = false;
  let activeListaDate = '';
  let reportHeaderDate = '';
  let lastCollectedText = '';
  let lastCollectedPatientKey = '';
  let lastCollectedSignature = '';
  let lastPatientKey = '';

  function isFormField(el) {
    const tag = el.tagName.toLowerCase();
    return tag === 'textarea' || (tag === 'input' && el.type === 'text') || el.isContentEditable;
  }

  function getFieldValue(field) {
    if (field.isContentEditable) return (field.textContent || '').trim();
    return (field.value || '').trim();
  }

  function normalizeText(text) {
    return (text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isIgnoredTable(table) {
    const header = normalizeText(
      (table.querySelector('thead tr') || table.querySelector('tr'))?.innerText || ''
    ).toLowerCase();
    return CONFIG.lab.ignoreTableHeaders.some((token) => header.includes(token));
  }

  function isResultsTable(table) {
    if (isIgnoredTable(table)) return false;
    const header = normalizeText(
      (table.querySelector('thead tr') || table.querySelector('tr'))?.innerText || ''
    ).toLowerCase();
    return header.includes('nazwa') && (header.includes('wartość') || header.includes('wartosc'));
  }

  function findResultsTables(root = getResultsPanelRoot()) {
    if (!root) return [];
    return [...root.querySelectorAll('table')].filter(isResultsTable);
  }

  function findSectionRoot(headingText) {
    const target = headingText.trim().toLowerCase();
    const candidates = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, td, th, legend, label')];

    for (const node of candidates) {
      const ownText = normalizeText(
        [...node.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE || (n.nodeType === Node.ELEMENT_NODE && n.childElementCount === 0))
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

  function extractLabelValuePairs(root) {
    if (!root) return {};

    const pairs = {};
    const text = root.innerText || '';
    const patterns = [
      ['pacjent', /pacjent\s*:\s*(.+)/i],
      ['pesel', /pesel\s*:\s*(\d{11})/i],
      ['pracownia', /pracownia\s*:\s*(.+)/i],
      ['numer', /numer\s*:\s*(.+)/i],
      [
        'dataWydruku',
        /data\s*wydruku\s*:?\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?|\d{2}\.\d{2}\.\d{4}(?:\s+\d{1,2}:\d{2})?|\d{4}\.\d{2}\.\d{2})/i,
      ],
      ['lekarz', /lekarz kier\.\s*:\s*(.+)/i],
    ];

    for (const [key, regex] of patterns) {
      const match = text.match(regex);
      if (match) pairs[key] = normalizeText(match[1]);
    }

    return pairs;
  }

  function shouldExcludeResult({ nazwa }) {
    const normalizedName = normalizeText(nazwa).toLowerCase();
    return CONFIG.lab.excludeResultNames.some((excluded) => {
      const normalizedExcluded = normalizeText(excluded).toLowerCase();
      return (
        normalizedName === normalizedExcluded ||
        normalizedName.includes(normalizedExcluded)
      );
    });
  }

  function parseResultsTable(table) {
    const rows = [...table.querySelectorAll('tr')];
    const headerRow = rows.find((row) => {
      const rowText = normalizeText(row.innerText).toLowerCase();
      return rowText.includes('nazwa') && (rowText.includes('wartość') || rowText.includes('wartosc'));
    });

    const colIdx = { nazwa: 0, jednostka: 1, wartosc: 2, normy: 3 };
    if (headerRow) {
      const cells = [...headerRow.querySelectorAll('th, td')];
      cells.forEach((cell, index) => {
        const label = normalizeText(cell.textContent).toLowerCase();
        if (label.includes('nazwa')) colIdx.nazwa = index;
        if (label.includes('jednostka')) colIdx.jednostka = index;
        if (label.includes('wartość') || label.includes('wartosc')) colIdx.wartosc = index;
        if (label.includes('normy')) colIdx.normy = index;
      });
    }

    return rows
      .filter((row) => row !== headerRow && row.querySelectorAll('td').length >= 3)
      .map((row) => {
        const cells = [...row.querySelectorAll('td')];
        const nazwa = normalizeText(cells[colIdx.nazwa]?.innerText);
        const jednostka = normalizeText(cells[colIdx.jednostka]?.innerText);
        const wartosc = normalizeText(cells[colIdx.wartosc]?.innerText);
        const normy = normalizeText(cells[colIdx.normy]?.innerText);
        if (!nazwa || !wartosc) return null;
        return { nazwa, jednostka, wartosc, normy };
      })
      .filter(Boolean)
      .filter((row) => !shouldExcludeResult(row));
  }

  function parseDateFromText(text) {
    const value = normalizeText(text);
    if (!value) return '';

    const patterns = [
      /(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)/,
      /(\d{2}\.\d{2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/,
      /(\d{4}\.\d{2}\.\d{2})/,
    ];

    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return normalizeText(match[1]);
    }

    return '';
  }

  function extractDatesFromText(text) {
    const dates = [];
    const pattern =
      /data\s*wydruku\s*:?\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?|\d{2}\.\d{2}\.\d{4}(?:\s+\d{1,2}:\d{2})?|\d{4}\.\d{2}\.\d{2})/gi;
    let match;

    while ((match = pattern.exec(text || '')) !== null) {
      if (match[1]) dates.push(normalizeText(match[1]));
    }

    return dates;
  }

  function isDataWydrukuLabel(text) {
    const normalized = normalizeText(text).replace(/:$/, '').toLowerCase();
    return normalized === 'data wydruku';
  }

  function findDateByLabelInScope(scope) {
    if (!scope) return '';

    const nodes = [...scope.querySelectorAll('td, th, label, span, div, dt, dd, p')];
    for (const node of nodes) {
      const nodeText = normalizeText(node.textContent);

      if (isDataWydrukuLabel(nodeText)) {
        const row = node.closest('tr');
        if (row) {
          const cells = [...row.querySelectorAll('td, th')];
          const labelIdx = cells.findIndex((cell) => cell === node || cell.contains(node));
          for (let i = labelIdx + 1; i < cells.length; i++) {
            const date = parseDateFromText(cells[i].innerText);
            if (date) return date;
          }
        }

        let sibling = node.nextElementSibling;
        for (let step = 0; step < 4 && sibling; step++) {
          const date = parseDateFromText(sibling.textContent);
          if (date) return date;
          sibling = sibling.nextElementSibling;
        }
      }

      const inline = nodeText.match(/data\s*wydruku\s*:?\s*(.+)$/i);
      if (inline) {
        const date = parseDateFromText(inline[1]);
        if (date) return date;
      }
    }

    const dates = extractDatesFromText(scope.innerText || '');
    return dates.length ? dates[dates.length - 1] : '';
  }

  function extractPatientInfo() {
    const roots = [findRightPanel(), getResultsPanelRoot(), document.body].filter(Boolean);
    const seen = new Set();

    for (const root of roots) {
      if (seen.has(root)) continue;
      seen.add(root);

      const pairs = extractLabelValuePairs(root);
      if (pairs.dataWydruku) return pairs;

      const byLabel = findDateByLabelInScope(root);
      if (byLabel) return { ...pairs, dataWydruku: byLabel };
    }

    return {};
  }

  function formatPrintDate(raw) {
    const value = parseDateFromText(raw) || normalizeText(raw);
    if (!value) return '';

    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return `${iso[3]}.${iso[2]}.${iso[1]}`;
    }

    const polish = value.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (polish) {
      return `${polish[1]}.${polish[2]}.${polish[3]}`;
    }

    const dotted = value.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
    if (dotted) {
      return `${dotted[3]}.${dotted[2]}.${dotted[1]}`;
    }

    return value;
  }

  function buildSectionHeader(patient) {
    if (!CONFIG.lab.includePatientInfo) return '';

    const data = formatPrintDate(patient.dataWydruku);
    if (!data) return '';

    return CONFIG.lab.sectionHeaderTemplate.replace('{data}', data).trim();
  }

  function formatNormy(normy) {
    const value = normalizeText(normy);
    if (!value) return '';
    if (/^do\s+/i.test(value)) return value;
    return value.replace(/([\d.,]+)\s*-\s*([\d.,]+)/g, '$1 - $2');
  }

  function parseResultNumber(text) {
    let value = normalizeText(text);
    if (!value) return NaN;

    value = value
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/^[<>=≤≥]+/g, '')
      .trim();

    const token = value.match(/-?\d+(?:[.,]\d+)?/);
    if (!token) return NaN;

    let raw = token[0];
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) {
        raw = raw.replace(/\./g, '').replace(',', '.');
      } else {
        raw = raw.replace(/,/g, '');
      }
    } else if (lastComma >= 0) {
      raw = raw.replace(',', '.');
    }

    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : NaN;
  }

  function parseNormRange(normy) {
    const value = normalizeText(normy);
    if (!value) return null;

    const range = value.match(/([\d.,]+)\s*-\s*([\d.,]+)/);
    if (range) {
      return {
        type: 'range',
        low: parseResultNumber(range[1]),
        high: parseResultNumber(range[2]),
      };
    }

    const maxOnly = value.match(/^(?:do\s+|<\s*|≤\s*|max\.?\s*)([\d.,]+)/i);
    if (maxOnly) {
      return { type: 'max', high: parseResultNumber(maxOnly[1]) };
    }

    const minOnly = value.match(/^(?:>\s*|≥\s*|min\.?\s*)([\d.,]+)/i);
    if (minOnly) {
      return { type: 'min', low: parseResultNumber(minOnly[1]) };
    }

    return null;
  }

  function getParamCoreName(nazwa) {
    const base = normalizeParamName(nazwa).split(/[\(\[]/)[0];
    const match = base.match(/^[a-z0-9+]+/);
    return match ? match[0] : base;
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
      normalized.includes('ft4') ||
      normalized.includes('freet4') ||
      normalized.includes('tyroksynawolna') ||
      normalized.includes('t4wolna')
    );
  }

  function isTotalCholesterolParam(nazwa) {
    const normalized = normalizeParamName(nazwa);
    if (!normalized.includes('cholesterol')) return false;
    if (
      normalized.includes('hdl') ||
      normalized.includes('ldl') ||
      normalized.includes('niehdl') ||
      normalized.includes('nonhdl')
    ) {
      return false;
    }
    return normalized === 'cholesterol';
  }

  function isLdlCholesterolParam(nazwa) {
    const normalized = normalizeParamName(nazwa);
    return normalized.includes('cholesterolldl') || normalized === 'ldlcholesterol';
  }

  function isShippingLabPracownia(text) {
    return normalizeText(text).toLowerCase().includes('wysyłkow');
  }

  function shouldAppendShippingLabFooter() {
    const patient = extractPatientInfo();
    if (isShippingLabPracownia(patient.pracownia)) return true;
    return findWynikButtons().some((item) => isShippingLabPracownia(item.pracownia));
  }

  function finalizeReportText(text) {
    if (!text || !shouldAppendShippingLabFooter()) return text;
    return `${text}\n\n${CONFIG.lab.shippingLabFooter}`;
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
      return (
        normalized === target ||
        normalized.includes(target) ||
        core.includes(target)
      );
    });
  }

  function isMorphologyKeyParam(nazwa) {
    return paramNameMatches(nazwa, CONFIG.lab.morphologyKeyParams);
  }

  function isPercentUnit(jednostka) {
    const unit = normalizeText(jednostka).toLowerCase();
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

    return CONFIG.lab.morphologyDiffCountParams.some((pattern) => {
      return core === normalizeParamName(pattern);
    });
  }

  // Wszystko z morfologii poza wyjątkami (morphologyKeyParams) — reguła 40%
  function isMorphologyFortyPercentParam(nazwa, jednostka = '') {
    if (isMorphologyKeyParam(nazwa)) return false;
    if (isMorphologyPercentParam(nazwa, jednostka)) return true;
    if (isMorphologyDiffCountParam(nazwa, jednostka)) return true;
    return paramNameMatches(nazwa, CONFIG.lab.morphologyOtherHints);
  }

  function isObParam(nazwa) {
    return paramNameMatches(nazwa, CONFIG.lab.obParamNames);
  }

  function isMorphologyParam(nazwa, jednostka = '') {
    if (isObParam(nazwa)) return false;
    return isMorphologyKeyParam(nazwa) || isMorphologyFortyPercentParam(nazwa, jednostka);
  }

  function extractParamNameFromLine(line) {
    const match = line.match(/^(.+?)\s{1,2}[\d,<≥>]/);
    return match ? normalizeText(match[1]) : normalizeText(line.split(/\s+/)[0] || '');
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
        const prevOb = isObParam(prev.nazwa);
        const currOb = isObParam(item.nazwa);
        const prevMorph = isMorphologyParam(prev.nazwa, prev.jednostka);
        const currMorph = isMorphologyParam(item.nazwa, item.jednostka);

        if ((prevOb && currMorph) || (prevMorph && currOb)) {
          lines.push('');
        }
      }

      lines.push(item.line);
    }

    return lines.join('\n');
  }

  function matchesAbsoluteThreshold(nazwa, value) {
    if (Number.isNaN(value)) return false;

    if (isPotassiumParam(nazwa) && value <= 4.4) return true;
    if (isFt4Param(nazwa) && value < 16) return true;
    if (isTotalCholesterolParam(nazwa)) return value > 8.0 || value < 4.4;
    if (isLdlCholesterolParam(nazwa)) return value > 3.3;

    const rules = CONFIG.lab.absoluteThresholds;
    const exclusiveRule = rules.find(
      (rule) => rule.exclusive && paramNameMatches(nazwa, rule.names)
    );
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

    if (range.type === 'max' && !Number.isNaN(range.high)) {
      return value > range.high;
    }

    if (range.type === 'min' && !Number.isNaN(range.low)) {
      return value < range.low;
    }

    return false;
  }

  function isFortyPercentOutOfRange(value, range) {
    if (Number.isNaN(value) || !range) return false;

    const ratio = CONFIG.lab.morphologyDeviationRatio;

    if (range.type === 'range') {
      if (!Number.isNaN(range.low) && range.low > 0) {
        const belowBy = (range.low - value) / range.low;
        if (belowBy >= ratio) return true;
      }
      if (!Number.isNaN(range.high) && range.high > 0) {
        const aboveBy = (value - range.high) / range.high;
        if (aboveBy >= ratio) return true;
      }
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

    if (isTotalCholesterolParam(nazwa) || isLdlCholesterolParam(nazwa)) {
      return false;
    }

    const range = parseNormRange(normy);

    if (isUricAcidOverNinetyPercent(nazwa, value, range)) return true;

    // Wyjątki morfologii → standard; reszta morfologii (abs. i %) → 40%
    if (isMorphologyKeyParam(nazwa)) {
      return isStandardOutOfRange(value, range);
    }

    if (isMorphologyFortyPercentParam(nazwa, jednostka)) {
      return isFortyPercentOutOfRange(value, range);
    }

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
    if (CONFIG.lab.includeUnit && jednostka) line += ' ' + jednostka;
    const formattedNormy = formatNormy(normy);
    if (CONFIG.lab.includeNorms && formattedNormy) line += ' (' + formattedNormy + ')';
    if (shouldMarkOutOfRange({ nazwa, jednostka, wartosc, normy })) {
      line += CONFIG.lab.outOfRangeMarker;
    }
    return line;
  }

  function normalizeParamName(name) {
    return normalizeText(name)
      .toLowerCase()
      .replace(/ą/g, 'a')
      .replace(/ć/g, 'c')
      .replace(/ę/g, 'e')
      .replace(/ł/g, 'l')
      .replace(/ń/g, 'n')
      .replace(/ó/g, 'o')
      .replace(/ś/g, 's')
      .replace(/ź/g, 'z')
      .replace(/ż/g, 'z')
      .replace(/[-–—:]/g, '')
      .replace(/\s+/g, '');
  }

  function findResultGroup(nazwa) {
    const normalized = normalizeParamName(nazwa);

    for (const group of CONFIG.lab.resultGroups) {
      for (const pattern of group.names) {
        const target = normalizeParamName(pattern);
        if (
          normalized === target ||
          normalized.includes(target) ||
          target.includes(normalized)
        ) {
          return group.id;
        }
      }
    }

    return null;
  }

  function getOrderInGroup(groupId, nazwa) {
    const group = CONFIG.lab.resultGroups.find((item) => item.id === groupId);
    if (!group) return 999;

    const normalized = normalizeParamName(nazwa);
    let best = 999;

    group.names.forEach((pattern, index) => {
      const target = normalizeParamName(pattern);
      if (
        normalized === target ||
        normalized.includes(target) ||
        target.includes(normalized)
      ) {
        best = Math.min(best, index);
      }
    });

    return best;
  }

  function buildLabRowEntries() {
    const entries = [];

    for (const table of findResultsTables()) {
      const dataWydruku = extractDateNearTable(table) || activeListaDate;

      for (const row of parseResultsTable(table)) {
        entries.push({
          ...row,
          fingerprint: `${row.nazwa}|${row.wartosc}`,
          dataWydruku,
        });
      }
    }

    return entries;
  }

  function resolveReportHeaderDateFromRows(rows) {
    if (reportHeaderDate) return reportHeaderDate;

    const fromRow = rows.find((row) => row.dataWydruku)?.dataWydruku;
    if (fromRow) return fromRow;

    if (activeListaDate) return activeListaDate;

    const patient = extractPatientInfo();
    return patient.dataWydruku || '';
  }

  function getRowDateKey(row) {
    return formatPrintDate(row.dataWydruku) || '';
  }

  function buildDayReportBody(rows) {
    if (!rows.length) return '';

    const groupedLines = new Map();
    const ungroupedBatches = new Map();

    for (const row of rows) {
      const line = formatResultLine(row);
      const groupId = findResultGroup(row.nazwa);

      if (groupId) {
        if (!groupedLines.has(groupId)) groupedLines.set(groupId, []);
        groupedLines.get(groupId).push({
          order: getOrderInGroup(groupId, row.nazwa),
          collectOrder: row.collectOrder,
          line,
        });
      } else {
        if (!ungroupedBatches.has(row.batchId)) ungroupedBatches.set(row.batchId, []);
        ungroupedBatches.get(row.batchId).push({
          nazwa: row.nazwa,
          jednostka: row.jednostka,
          collectOrder: row.collectOrder,
          line,
        });
      }
    }

    const sectionBodies = [];

    for (const group of CONFIG.lab.resultGroups) {
      const items = groupedLines.get(group.id);
      if (!items?.length) continue;

      items.sort((a, b) => a.order - b.order || a.collectOrder - b.collectOrder);
      sectionBodies.push({
        sortKey: Math.min(...items.map((item) => item.collectOrder)),
        text: items.map((item) => item.line).join('\n'),
      });
    }

    for (const items of ungroupedBatches.values()) {
      sectionBodies.push({
        sortKey: Math.min(...items.map((item) => item.collectOrder)),
        text: joinBatchLines(items),
      });
    }

    sectionBodies.sort((a, b) => a.sortKey - b.sortKey);

    const parts = [];
    for (let i = 0; i < sectionBodies.length; i++) {
      const text = sectionBodies[i].text;
      if (!text) continue;

      if (i > 0 && parts.length) {
        const prevText = parts[parts.length - 1];
        const prevLines = prevText.split('\n').filter((line) => line.trim());
        const currLines = text.split('\n').filter((line) => line.trim());
        const prevLast = prevLines[prevLines.length - 1];
        const currFirst = currLines[0];

        if (addObMorphologySeparator(prevLast, currFirst)) {
          parts[parts.length - 1] = `${prevText}\n`;
        }
      }

      parts.push(text);
    }

    return parts.join('\n\n');
  }

  function assembleGroupedReport(rows, fallbackHeaderDate) {
    if (!rows.length) return null;

    const dayBuckets = new Map();

    for (const row of rows) {
      const dateKey = getRowDateKey(row) || '__nodate__';
      if (!dayBuckets.has(dateKey)) dayBuckets.set(dateKey, []);
      dayBuckets.get(dateKey).push(row);
    }

    const orderedDateKeys = [...dayBuckets.keys()].sort((a, b) => {
      const minOrder = (key) => Math.min(...dayBuckets.get(key).map((row) => row.collectOrder));
      return minOrder(a) - minOrder(b);
    });

    const parts = [];

    for (const dateKey of orderedDateKeys) {
      const body = buildDayReportBody(dayBuckets.get(dateKey));
      if (!body) continue;

      const displayDate =
        dateKey === '__nodate__'
          ? formatPrintDate(fallbackHeaderDate || resolveReportHeaderDateFromRows(rows))
          : dateKey;
      const header = displayDate ? buildSectionHeader({ dataWydruku: displayDate }) : '';

      parts.push(header ? `${header}\n\n${body}` : body);
    }

    if (!parts.length) return null;

    const betweenDays = `\n\n${CONFIG.lab.dateSeparator}\n\n`;
    return parts.join(betweenDays);
  }

  function mergeRowsFromPage(seen, allRows, ignoreFingerprints = null, batchId = 0, batchDate = '') {
    let added = 0;

    for (const row of buildLabRowEntries()) {
      const dataWydruku = batchDate || row.dataWydruku;
      const fingerprint = `${row.nazwa}|${row.wartosc}|${formatPrintDate(dataWydruku) || batchId}`;

      if (ignoreFingerprints?.has(fingerprint)) continue;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      if (!reportHeaderDate && dataWydruku) {
        reportHeaderDate = dataWydruku;
      }

      allRows.push({
        ...row,
        dataWydruku,
        batchId,
        collectOrder: allRows.length,
      });
      added++;
    }

    return added;
  }

  function matchesResultsHeading(node) {
    const target = CONFIG.lab.resultsHeading.trim().toLowerCase();
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
    const full = normalizeText(node.textContent).toLowerCase();
    return ownText === target || (full === target && normalizeText(node.textContent).length <= 60);
  }

  function extractDateNearTable(table) {
    let node = table;

    for (let step = 0; step < 50 && node; step++) {
      let previous = node.previousElementSibling;
      while (previous) {
        const byLabel = findDateByLabelInScope(previous);
        if (byLabel) return byLabel;

        const dates = extractDatesFromText(previous.innerText || '');
        if (dates.length) return dates[dates.length - 1];

        previous = previous.previousElementSibling;
      }

      const parentDate = findDateByLabelInScope(node.parentElement);
      if (parentDate) return parentDate;

      node = node.parentElement;
      if (!node || node === document.body) break;
    }

    const patient = extractPatientInfo();
    if (patient.dataWydruku) return patient.dataWydruku;

    const panel = findRightPanel();
    if (panel) {
      const dates = extractDatesFromText(panel.innerText || '');
      if (dates.length) return dates[dates.length - 1];
      const byLabel = findDateByLabelInScope(panel);
      if (byLabel) return byLabel;
    }

    return activeListaDate || '';
  }

  function extractDateFromListaRow(row) {
    const table = row.closest('table');
    const headerRow = table?.querySelector('thead tr') || table?.querySelector('tr');
    const headers = headerRow
      ? [...headerRow.querySelectorAll('th, td')].map((cell) => normalizeText(cell.textContent).toLowerCase())
      : [];
    const cells = [...row.querySelectorAll('td')];

    const dataIdx = headers.findIndex((label) => label === 'data' || label.startsWith('data '));
    if (dataIdx >= 0 && cells[dataIdx]) {
      return parseDateFromText(cells[dataIdx].innerText) || normalizeText(cells[dataIdx].innerText);
    }

    if (cells[1]) {
      const date = parseDateFromText(cells[1].innerText);
      if (date) return date;
    }

    return '';
  }

  function resolveReportHeaderDate(sections) {
    if (reportHeaderDate) return reportHeaderDate;

    const fromSection = sections.find((section) => section.dataWydruku)?.dataWydruku;
    if (fromSection) return fromSection;

    if (activeListaDate) return activeListaDate;

    const patient = extractPatientInfo();
    return patient.dataWydruku || '';
  }

  function assembleReport(sectionBodies, headerDate) {
    if (!sectionBodies.length) return null;

    const header = buildSectionHeader({ dataWydruku: headerDate });
    if (header) {
      return [header, '', sectionBodies.join('\n\n')].join('\n');
    }

    return sectionBodies.join('\n\n');
  }

  function buildLabSections() {
    const tables = findResultsTables();
    const sections = [];

    for (const table of tables) {
      const rows = parseResultsTable(table);
      if (!rows.length) continue;

      const fingerprint = rows.map((row) => `${row.nazwa}|${row.wartosc}`).join(';');
      const dataWydruku = extractDateNearTable(table) || activeListaDate;

      sections.push({
        fingerprint,
        dataWydruku,
        text: rows.map(formatResultLine).join('\n'),
      });
    }

    return sections;
  }

  function buildLabReport() {
    const rows = buildLabRowEntries().map((row, index) => ({
      ...row,
      batchId: 0,
      collectOrder: index,
    }));
    if (!rows.length) return null;
    return assembleGroupedReport(rows, resolveReportHeaderDateFromRows(rows));
  }

  function mergeSectionsFromPage(seen, sections, ignoreFingerprints = null) {
    let added = 0;

    for (const section of buildLabSections()) {
      if (ignoreFingerprints?.has(section.fingerprint)) continue;
      if (seen.has(section.fingerprint)) continue;
      seen.add(section.fingerprint);

      if (!reportHeaderDate && section.dataWydruku) {
        reportHeaderDate = section.dataWydruku;
      }

      sections.push(section.text);
      added++;
    }

    return added;
  }

  function getSectionFingerprintSet() {
    return new Set(buildLabSections().map((section) => section.fingerprint));
  }

  function tryExtractLabResults() {
    return buildLabReport();
  }

  function matchesPatientSearchLabel(node, target) {
    const normalizedTarget = target.replace(/\s*\/\s*/g, ' / ').trim();

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
      .replace(/\s*\/\s*/g, ' / ');

    if (ownText === normalizedTarget) return true;
    if (ownText.replace(/\s/g, '') === normalizedTarget.replace(/\s/g, '')) return true;

    const full = normalizeText(node.textContent).toLowerCase().replace(/\s*\/\s*/g, ' / ');
    return full === normalizedTarget && normalizeText(node.textContent).length <= 40;
  }

  function isDateField(input) {
    const meta = normalizeText(
      [input.name, input.id, input.placeholder, input.getAttribute('aria-label')]
        .filter(Boolean)
        .join(' ')
    ).toLowerCase();

    if (/(data\s*(od|do)|date|calendar)/i.test(meta)) return true;

    const row = input.closest('tr, .form-group, .field, label, div');
    if (!row) return false;
    const rowText = normalizeText(row.textContent).toLowerCase();
    return rowText.includes('data od') || rowText.includes('data do');
  }

  function isSearchInput(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return !isDateField(el);
    if (tag !== 'input') return false;
    if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'date'].includes(el.type)) return false;
    return !isDateField(el);
  }

  function findInputNearLabel(labelNode) {
    if (labelNode.htmlFor) {
      const linked = document.getElementById(labelNode.htmlFor);
      if (linked && isSearchInput(linked)) return linked;
    }

    const row = labelNode.closest('tr');
    if (row) {
      const cells = [...row.querySelectorAll('td, th')];
      const labelCellIdx = cells.findIndex((cell) => cell === labelNode || cell.contains(labelNode));
      if (labelCellIdx >= 0) {
        for (let i = labelCellIdx + 1; i < cells.length; i++) {
          const input = cells[i].querySelector('input, textarea');
          if (input && isSearchInput(input)) return input;
        }
      }
    }

    let sibling = labelNode.nextElementSibling;
    let steps = 0;
    while (sibling && steps < 4) {
      if (sibling.matches?.('input, textarea') && isSearchInput(sibling)) return sibling;
      const nested = sibling.querySelector?.('input, textarea');
      if (nested && isSearchInput(nested)) return nested;
      if (matchesPatientSearchLabel(sibling, CONFIG.lab.patientSearchLabel)) break;
      sibling = sibling.nextElementSibling;
      steps++;
    }

    const parent = labelNode.parentElement;
    const inParent = parent?.querySelector(':scope > input, :scope > textarea');
    if (inParent && isSearchInput(inParent)) return inParent;

    return null;
  }

  function findPatientSearchField() {
    const panel = findSectionRoot(CONFIG.lab.searchPanelHeading) || document;
    const target = CONFIG.lab.patientSearchLabel.trim().toLowerCase();
    const nodes = [...panel.querySelectorAll('label, span, td, th, legend, p, div')];

    for (const node of nodes) {
      if (!matchesPatientSearchLabel(node, target)) continue;
      const input = findInputNearLabel(node);
      if (input) return input;
    }

    return null;
  }

  function isDateLikeValue(value) {
    return /^\d{2}\.\d{2}\.\d{4}$/.test(value);
  }

  function getPatientSearchValue() {
    const field = findPatientSearchField();
    if (!field) return '';
    return normalizeText(getFieldValue(field));
  }

  function getPatientKey() {
    return getPatientSearchValue().toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function getPatientPanelRoot() {
    return findSectionRoot(CONFIG.lab.patientHeading) || findRightPanel();
  }

  function patientPanelMatchesSearch() {
    const search = getPatientKey();
    if (!search) return false;

    const root = getPatientPanelRoot();
    if (!root) return false;

    const panelText = normalizeText(root.innerText).toLowerCase();
    const pairs = extractLabelValuePairs(root);

    if (/^\d{11}$/.test(search)) {
      return pairs.pesel === search || panelText.includes(search);
    }

    const firstToken = search.split(/\s+/)[0];
    if (pairs.pacjent && normalizeText(pairs.pacjent).toLowerCase().includes(firstToken)) {
      return true;
    }

    return panelText.includes(search) || (firstToken.length >= 3 && panelText.includes(firstToken));
  }

  function resetPatientState() {
    lastCollectedText = '';
    lastCollectedPatientKey = '';
    lastCollectedSignature = '';
    reportHeaderDate = '';
    searchRequested = false;
    searchRequestedAt = 0;
    searchBaselineLista = '';
    sessionStorage.removeItem(DONE_KEY);
  }

  function syncPatientChange() {
    const key = getPatientKey();
    if (!isValidPatientSearchValue(key)) {
      if (lastPatientKey) resetPatientState();
      lastPatientKey = '';
      return;
    }

    if (lastPatientKey && lastPatientKey !== key) {
      resetPatientState();
    }
    lastPatientKey = key;
  }

  function isValidPatientSearchValue(value) {
    if (!value || isDateLikeValue(value)) return false;
    if (/^\d{11}$/.test(value)) return true;
    if (/[a-ząćęłńóśźż]/i.test(value) && value.length >= 3) return true;
    return false;
  }

  function isPatientSearchFilled() {
    return isValidPatientSearchValue(getPatientSearchValue());
  }

  function findListaBadanTable() {
    return [...document.querySelectorAll('table')].find((table) => {
      const header = normalizeText(
        (table.querySelector('thead tr') || table.querySelector('tr'))?.innerText || ''
      ).toLowerCase();
      return header.includes('lp.') && header.includes('pracownia');
    });
  }

  function listaMatchesSearch() {
    if (!CONFIG.lab.requireListaMatch) return true;

    const search = getPatientSearchValue().toLowerCase();
    if (!search) return false;

    const table = findListaBadanTable();
    if (!table) return false;

    if (/^\d{11}$/.test(search)) {
      return findWynikButtons().length > 0;
    }

    const tableText = normalizeText(table.innerText).toLowerCase();
    if (tableText.includes(search)) return true;

    const firstToken = search.split(/\s+/)[0];
    return firstToken.length >= 3 && tableText.includes(firstToken);
  }

  function isLabReadyForCollection() {
    if (!searchRequested) return false;

    syncPatientChange();
    if (!isPatientSearchFilled()) return false;
    if (!findWynikButtons().length) return false;
    if (!listaMatchesSearch()) return false;

    const search = getPatientKey();
    if (/^\d{11}$/.test(search)) {
      const currentLista = normalizeText(findListaBadanTable()?.innerText || '');
      const listaChanged = currentLista !== searchBaselineLista;
      const waitedEnough = Date.now() - searchRequestedAt > 1_000;
      return listaChanged || waitedEnough;
    }

    return true;
  }

  function scheduleAutoCopy({ userGesture = false } = {}) {
    autoCopyUserGesture = userGesture;
    labWatcher?.disconnect?.();
    startLabAutoRun();
  }

  function watchPatientSearchField() {
    const attach = () => {
      const field = findPatientSearchField();
      if (!field || field.dataset.labToSerumWatch) return;
      field.dataset.labToSerumWatch = '1';

      const resetIfNeeded = () => {
        if (suppressSearchReset) return;
        syncPatientChange();
        searchRequested = false;
        searchRequestedAt = 0;
        searchBaselineLista = '';
      };

      field.addEventListener('input', resetIfNeeded);
      field.addEventListener('change', resetIfNeeded);
      field.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (!isPatientSearchFilled()) return;

        suppressSearchReset = true;
        syncPatientChange();
        sessionStorage.removeItem(DONE_KEY);
        lastCollectedText = '';
        lastCollectedPatientKey = '';
        searchBaselineLista = normalizeText(findListaBadanTable()?.innerText || '');
        searchRequested = true;
        searchRequestedAt = Date.now();
        scheduleAutoCopy({ userGesture: true });
        setTimeout(() => {
          suppressSearchReset = false;
        }, 500);
      });
    };

    attach();
    waitUntil(() => Boolean(findPatientSearchField()), attach, {
      maxWaitMs: CONFIG.maxWaitMs,
      intervalMs: CONFIG.retryIntervalMs,
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findWynikButtonInRow(row) {
    const candidates = [...row.querySelectorAll('button, a, input[type="button"], [role="button"]')];
    const target = CONFIG.lab.wynikButtonText.toLowerCase();

    return (
      candidates.find((el) => normalizeText(el.textContent).toLowerCase() === target) ||
      candidates.find((el) => normalizeText(el.textContent).toLowerCase().includes(target))
    );
  }

  function extractPracowniaFromRow(row) {
    const table = row.closest('table');
    const headerRow = table?.querySelector('thead tr') || table?.querySelector('tr');
    const headers = headerRow
      ? [...headerRow.querySelectorAll('th, td')].map((cell) => normalizeText(cell.textContent).toLowerCase())
      : [];
    const cells = [...row.querySelectorAll('td')];

    const pracowniaIdx = headers.findIndex((label) => label.includes('pracownia'));
    if (pracowniaIdx >= 0 && cells[pracowniaIdx]) {
      return normalizeText(cells[pracowniaIdx].innerText);
    }

    for (const cell of cells) {
      const text = normalizeText(cell.innerText);
      if (!text || /^wynik$/i.test(text)) continue;
      if (/^(biochemia|hematologia|koagulologia|immunologia|badania|mikrobiologia|serologia)/i.test(text)) {
        return text;
      }
    }

    return '';
  }

  function findWynikButtons() {
    const listaTables = [...document.querySelectorAll('table')].filter((table) => {
      const header = normalizeText(
        (table.querySelector('thead tr') || table.querySelector('tr'))?.innerText || ''
      ).toLowerCase();
      return header.includes('lp.') && header.includes('pracownia');
    });

    const items = [];

    for (const table of listaTables) {
      const rows = [...table.querySelectorAll('tbody tr, tr')];
      for (const row of rows) {
        if (row.querySelector('th')) continue;
        const button = findWynikButtonInRow(row);
        if (!button) continue;
        items.push({
          button,
          row,
          pracownia: extractPracowniaFromRow(row),
          listaDate: extractDateFromListaRow(row),
        });
      }
    }

    return items;
  }

  function findRightPanel() {
    const patientHeading = findSectionRoot(CONFIG.lab.patientHeading);
    if (!patientHeading) return null;

    let node = patientHeading;
    for (let depth = 0; depth < 10 && node.parentElement; depth++) {
      node = node.parentElement;
      const text = normalizeText(node.innerText).toLowerCase();
      if (
        text.includes('dane pacjenta') &&
        (text.includes('wynik badania diagnostycznego') || text.includes('w opracowaniu'))
      ) {
        return node;
      }
    }

    return patientHeading.parentElement?.parentElement || patientHeading;
  }

  function getResultsPanelRoot() {
    return findRightPanel() || findSectionRoot(CONFIG.lab.patientHeading) || document.body;
  }

  function hasResultDataRows() {
    return buildLabSections().length > 0;
  }

  function hasInProgressBanner() {
    const lista = findListaBadanTable();
    const root = getResultsPanelRoot() || document;
    const nodes = [...root.querySelectorAll('div, span, p, label, h1, h2, h3, h4, h5, h6')];

    for (const node of nodes) {
      if (lista?.contains(node)) continue;
      const text = normalizeText(node.textContent).toLowerCase();
      if (!text || text.length > 40) continue;
      if (text === 'wynik w opracowaniu' || text.includes('wynik w opracowaniu')) {
        return true;
      }
    }

    return false;
  }

  function getPatientPanelSignature() {
    const patient = extractLabelValuePairs(findSectionRoot(CONFIG.lab.patientHeading));
    return [patient.pracownia, patient.numer, patient.pesel].join('|');
  }

  function getTableFingerprint() {
    return findResultsTables()
      .flatMap((table) => parseResultsTable(table))
      .map((row) => `${row.nazwa}|${row.wartosc}`)
      .join(';');
  }

  function pracowniaMatchesExpected(patientPracownia, expectedPracownia) {
    if (!expectedPracownia) return true;
    const actual = normalizeText(patientPracownia).toLowerCase();
    const expected = normalizeText(expectedPracownia).toLowerCase();
    if (!actual || !expected) return false;
    return actual.includes(expected) || expected.includes(actual);
  }

  function isResultInProgress() {
    if (buildLabSections().length > 0) return false;
    return hasInProgressBanner();
  }

  function hasNewSectionsSince(beforeFingerprints) {
    const current = buildLabSections();
    if (!current.length) return false;
    return current.some((section) => !beforeFingerprints.has(section.fingerprint));
  }

  function getResultsSignature() {
    const patient = extractLabelValuePairs(findSectionRoot(CONFIG.lab.patientHeading));
    const tables = findResultsTables();
    const rows = tables[0] ? parseResultsTable(tables[0]) : [];
    const rowCount = rows.length;
    const firstParam = rows[0]?.nazwa || '';
    const lastParam = rows[rows.length - 1]?.nazwa || '';
    return [patient.pracownia, patient.numer, rowCount, firstParam, lastParam].join('|');
  }

  function waitForNewResults(previousSignature, { expectedPracownia = '', beforeFingerprints = null } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const readyWaitMs = CONFIG.lab.wynikReadyWaitMs;
      const skipDelayMs = CONFIG.lab.inProgressSkipDelayMs;
      const fallbackDelayMs = CONFIG.lab.inProgressFallbackDelayMs;
      const knownFingerprints = beforeFingerprints || new Set();
      let settled = false;
      let observer = null;

      const finish = (status) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        resolve(status);
      };

      const check = () => {
        const elapsed = Date.now() - start;
        const pageSections = buildLabSections();
        const hasRows = pageSections.length > 0;
        const hasNew = hasNewSectionsSince(knownFingerprints);

        if (hasRows && hasNew) {
          finish('ready');
          return;
        }

        const patient = extractLabelValuePairs(findSectionRoot(CONFIG.lab.patientHeading));
        const panelMatches = pracowniaMatchesExpected(patient.pracownia, expectedPracownia);

        if (hasRows && !knownFingerprints.size) {
          finish('ready');
          return;
        }

        if (!hasRows && hasInProgressBanner()) {
          if (panelMatches && elapsed >= skipDelayMs) {
            finish('in_progress');
            return;
          }
          if (elapsed >= fallbackDelayMs) {
            finish('in_progress');
            return;
          }
        }

        if (panelMatches && !hasRows && !patient.dataWydruku && elapsed >= skipDelayMs) {
          finish('in_progress');
          return;
        }

        if (elapsed >= readyWaitMs) {
          if (hasRows) {
            finish('ready');
          } else if (hasInProgressBanner()) {
            finish('in_progress');
          } else {
            finish('timeout');
          }
          return;
        }

        setTimeout(check, 60);
      };

      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  async function collectAllFromWynikButtons() {
    if (isCollecting) return null;
    isCollecting = true;

    try {
      syncPatientChange();
      const collectionPatientKey = getPatientKey();
      const items = findWynikButtons();
      if (!items.length) return null;

      const allRows = [];
      const seen = new Set();
      reportHeaderDate = '';
      let batchId = 0;

      let skippedInProgress = 0;

      // Tylko gdy panel już pokazuje bieżącego pacjenta — unikamy starych wyników w DOM
      if (patientPanelMatchesSearch()) {
        if (mergeRowsFromPage(seen, allRows, null, batchId) > 0) {
          batchId++;
        }
      }

      notify(`Zbieram wyniki: ${batchId}/${items.length}…`, true, true);

      for (let i = 0; i < items.length; i++) {
        if (getPatientKey() !== collectionPatientKey) {
          console.info('[lab-to-serum] przerwano — zmieniono pacjenta podczas zbierania');
          return null;
        }

        const { button, pracownia, listaDate } = items[i];
        const beforeSig = getResultsSignature();
        const beforeFingerprints = getSectionFingerprintSet();

        activeListaDate = listaDate || '';
        button.click();
        const outcome = await waitForNewResults(beforeSig, {
          expectedPracownia: pracownia,
          beforeFingerprints,
        });

        await sleep(CONFIG.lab.delayBetweenClicksMs);

        if (!patientPanelMatchesSearch()) continue;

        const added = mergeRowsFromPage(
          seen,
          allRows,
          beforeFingerprints,
          batchId,
          listaDate || activeListaDate
        );

        if (added > 0) {
          batchId++;
        }

        if (added === 0 && (outcome === 'in_progress' || !hasResultDataRows())) {
          skippedInProgress++;
          notify(
            `Pominięto „${CONFIG.lab.inProgressText}”: ${pracownia || 'badanie ' + (i + 1)}`,
            true,
            true
          );
        }

        notify(`Zbieram wyniki: ${batchId}/${items.length}…`, true, true);
      }

      if (skippedInProgress > 0) {
        console.info('[lab-to-serum] pominięto w opracowaniu:', skippedInProgress);
      }

      return assembleGroupedReport(allRows, reportHeaderDate);
    } finally {
      isCollecting = false;
    }
  }

  function markDone(kind, detail) {
    sessionStorage.setItem(
      DONE_KEY,
      JSON.stringify({ kind, detail, patientKey: getPatientKey(), at: Date.now() })
    );
  }

  function wasDone(kind) {
    try {
      const raw = sessionStorage.getItem(DONE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data.kind === kind && data.patientKey === getPatientKey();
    } catch {
      return false;
    }
  }

  function notify(msg, ok = true, sticky = false) {
    const id = 'lab-to-serum-toast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'right:20px',
        'z-index:2147483647',
        'max-width:420px',
        'padding:12px 16px',
        'border-radius:8px',
        'font:14px/1.4 system-ui,sans-serif',
        'box-shadow:0 4px 16px rgba(0,0,0,.25)',
        'color:#fff',
      ].join(';');
      document.body.appendChild(el);
    }
    el.style.background = ok ? '#1b7f3a' : '#b3261e';
    el.textContent = msg;
    clearTimeout(el._hideTimer);
    if (!sticky) {
      el._hideTimer = setTimeout(() => el.remove(), ok ? 5000 : 8000);
    }
  }

  async function copyToClipboard(text, { userGesture = false } = {}) {
    if (userGesture && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fallback poniżej
      }
    }

    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;';
    document.body.appendChild(el);
    el.focus({ preventScroll: true });
    el.select();
    el.setSelectionRange(0, text.length);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    el.remove();

    if (copied) return true;

    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return true;
    }

    return false;
  }

  async function copyFromLab({ silent = false, userGesture = false, onlyCopy = false } = {}) {
    syncPatientChange();

    if (!isPatientSearchFilled()) {
      if (!silent) {
        notify('Wpisz pacjenta lub PESEL w polu „Pacjent / Pesel” i wyszukaj.', false);
      }
      return false;
    }

    const canReuseCache =
      onlyCopy &&
      lastCollectedText &&
      lastCollectedPatientKey === getPatientKey() &&
      lastCollectedSignature === getResultsSignature();

    let text = canReuseCache ? lastCollectedText : null;

    if (!text) {
      if (CONFIG.lab.clickAllWynikButtons && findWynikButtons().length > 0) {
        text = await collectAllFromWynikButtons();
      }

      if (!text) {
        text = tryExtractLabResults();
      }

      if (!text) {
        if (!silent) {
          notify(
            'Nie znaleziono wyników. Wyszukaj pacjenta i poczekaj na listę badań z przyciskami „Wynik”.',
            false
          );
        }
        return false;
      }

      lastCollectedText = text;
      lastCollectedPatientKey = getPatientKey();
      lastCollectedSignature = getResultsSignature();
    }

    text = finalizeReportText(text);
    const copied = await copyToClipboard(text, { userGesture });

    const sectionCount = text.split('\n\n').length;
    markDone('lab', text.length);

    if (copied) {
      notify(
        `Skopiowano ${sectionCount} ${sectionCount === 1 ? 'badanie' : 'badań'} (${text.split('\n').length} linii). Wklej środkowym przyciskiem myszy w polu BADANIE PRZEDMIOTOWE w Serum.`
      );
    } else if (!silent) {
      notify(
        `Zebrano ${sectionCount} ${sectionCount === 1 ? 'badanie' : 'badań'}. Kliknij „Kopiuj badania”, jeśli wklejanie nie działa.`,
        false
      );
    }
    console.info('[lab-to-serum] zapisano wyniki:', sectionCount, 'badań,', text.split('\n').length, 'linii');
    return true;
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

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    setTimeout(() => observer.disconnect(), maxWaitMs);
    return observer;
  }

  function startLabAutoRun() {
    if (!CONFIG.autoRun) return;

    labWatcher = waitUntil(
      () => !isCollecting && isLabReadyForCollection(),
      () => {
        if (!wasDone('lab') && !isCollecting) {
          const useGesture = autoCopyUserGesture;
          autoCopyUserGesture = false;
          copyFromLab({ userGesture: useGesture });
        }
      },
      {
        maxWaitMs: CONFIG.maxWaitMs,
        intervalMs: CONFIG.retryIntervalMs,
        onTimeout: () => {
          if (!isPatientSearchFilled()) {
            console.info('[lab-to-serum] lab: czekam na wypełnienie pola „Pacjent / Pesel”');
          } else {
            console.info('[lab-to-serum] lab: czekam na listę badań po wyszukaniu');
          }
        },
      }
    );
  }

  function addFloatingButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = [
      'position:fixed',
      'top:80px',
      'right:16px',
      'z-index:2147483646',
      'padding:10px 14px',
      'border:none',
      'border-radius:8px',
      'background:#1565c0',
      'color:#fff',
      'font:13px system-ui,sans-serif',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,.2)',
    ].join(';');
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
  }

  function registerHotkey(handler) {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handler();
        }
      },
      true
    );
  }

  function boot() {
    watchPatientSearchField();
    const copyWithGesture = () =>
      copyFromLab({
        userGesture: true,
        onlyCopy: Boolean(lastCollectedText && lastCollectedPatientKey === getPatientKey()),
      });

    GM_registerMenuCommand?.('Kopiuj badania (ręcznie)', copyWithGesture);
    if (CONFIG.showManualButtons) addFloatingButton('📋 Kopiuj badania', copyWithGesture);
    registerHotkey(copyWithGesture);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
