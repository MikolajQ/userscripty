# userscripty

Skrypty dla Violentmonkeya (Brave od 28.10.2026, Firefox od 03.11.2026; wcześniej Tampermonkey — działają w obu). Instalacja: otwórz link „raw” pliku `*.user.js` — menedżer zaproponuje instalację i sam będzie sprawdzał aktualizacje (po podbiciu `@version`).

`medfile-tools`: dane praktyki do nagłówka i podpisu PDF nie są w kodzie — ustawia się je raz w konsoli na app.medfile.pl:
`medfileToolsDanePraktyki({ lewy: [...], podpis: [...] })`.

`serum-diag` (tymczasowy): sam zbiera zrzuty struktury strony Serum w kolejnych stanach pracy do `localStorage` (klucz `serum_diag_v1`), niczego nie zmienia na stronie i wyłącza się po 7 dniach. Do odinstalowania po zebraniu danych.

`lab-multilab-auto-login` (Multilab, 10.1.1.140 i gniew.lab-online.pl): auto logowanie, podtrzymanie sesji w tle (zapytanie co 4 min; gdy sesja mimo to wygaśnie — przeładowanie i ponowne logowanie) oraz „Data od” 60 dni wstecz. PESEL i PIN ustawia się raz z menu skryptu „Ustaw dane logowania”. Zastąpił `lab-data-od` — ten można odinstalować.
