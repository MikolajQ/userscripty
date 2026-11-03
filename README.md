# userscripty

Skrypty dla Violentmonkeya (Brave od 28.10.2026, Firefox od 03.11.2026; wcześniej Tampermonkey — działają w obu). Instalacja: otwórz link „raw” pliku `*.user.js` — menedżer zaproponuje instalację i sam będzie sprawdzał aktualizacje (po podbiciu `@version`).

`medfile-tools`: dane praktyki do nagłówka i podpisu PDF nie są w kodzie — ustawia się je raz w konsoli na app.medfile.pl:
`medfileToolsDanePraktyki({ lewy: [...], podpis: [...] })`.

`serum-diag` (tymczasowy): sam zbiera zrzuty struktury strony Serum w kolejnych stanach pracy do `localStorage` (klucz `serum_diag_v1`), niczego nie zmienia na stronie i wyłącza się po 7 dniach. Do odinstalowania po zebraniu danych.
