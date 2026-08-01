# CLAUDE.md — ui-agent

Baca root `CLAUDE.md` dulu. Divisi ini urus shell layout & filter, BUKAN chart (itu punya viz-agent).

## Scope
1. `src/components/shell.ts` — layout dasar dashboard: header, grid area untuk KPI cards, area chart, sidebar filter. Styling mendekati look-and-feel MyGeotab (font system, spacing, warna netral) supaya add-in terasa "menyatu", bukan seperti embed asing.
2. `src/components/filter-bar.ts` — filter: date range picker, device group selector (ambil dari `Group` entity via data-agent), zone selector. Filter berubah -> trigger event yang didengarkan viz-agent untuk re-render chart (pakai simple pub/sub atau CustomEvent, jangan import framework state management berat).
3. `src/styles/*.css` — plain CSS, no CSS framework besar (add-in load di iframe, minimalkan bundle size).

## Larangan
- Jangan fetch data langsung — ui-agent hanya render & emit filter-change event, data agent lain yang fetch
- Jangan pakai React/Vue kecuali sudah ada keputusan eksplisit ganti stack (default: vanilla TS + DOM API)

## Kontrak dengan viz-agent
Filter bar men-dispatch `CustomEvent('dashboard:filter-change', { detail: { dateFrom, dateTo, groupId, zoneId } })` di elemen root dashboard. viz-agent listen event ini untuk refresh chart.
