// Zakładka "Podgląd" — monitor procesu, wiele falowników jednocześnie
// (Hz, m/min, prąd, napięcie). Czysto dodatkowy moduł — nie modyfikuje
// istniejącego workflow READ/PROGRAMOWANIE/WERYFIKACJA w app.js/ui.js.
//
// UWAGA: adresy MON-FREQ/MON-CUR/MON-VOLT (katalog, grupa "MON") są
// NIEPOTWIERDZONE empirycznie na sprzęcie — tabela "Monitoring Area" w
// manualu jest silnie połamana przez zawijanie kolumn w PDF. Baner
// ostrzegawczy w UI poniżej, do usunięcia dopiero po weryfikacji sweepem
// (ten sam wzorzec co przy innych adresach w tym projekcie).

const Monitor = (() => {
  const POLL_CODES = ['MON-FREQ', 'MON-CUR', 'MON-VOLT'];
  const POLL_PAUSE_MS = 1000; // przerwa między pełnymi cyklami (wszystkie falowniki)

  let running = false;
  let stopRequested = false;
  let rootEl = null;
  const values = {}; // inverterId -> {freq, cur, volt, error, lastUpdate}

  function init(root) {
    rootEl = root;
    render();
  }

  function render() {
    if (!rootEl) return;
    const cfg = ConfigStore.getState();
    rootEl.innerHTML = '';

    const warn = UI.el('p', { class: 'hint-text warn-text' },
      '⚠ Adresy pomiarowe (częstotliwość/prąd/napięcie wyjściowe) są NIEPOTWIERDZONE empirycznie na sprzęcie — porównaj wartości z klawiaturą/DriveView zanim zaczniesz na nich polegać operacyjnie. Szczegóły w katalogu, wpisy MON-FREQ/MON-CUR/MON-VOLT.');
    rootEl.appendChild(warn);

    const bar = UI.el('div', { class: 'workflow-bar' });
    const toggleBtn = UI.el('button', {
      class: 'btn btn-primary',
      disabled: !bleClient.connected,
      onclick: () => (running ? stop() : start()),
    }, running ? 'Zatrzymaj podgląd' : 'Uruchom podgląd');
    bar.appendChild(toggleBtn);
    rootEl.appendChild(bar);

    if (cfg.inverters.length === 0) {
      rootEl.appendChild(UI.el('p', { class: 'empty-hint' }, 'Brak skonfigurowanych falowników — dodaj je w zakładce „Konfiguracja”.'));
      return;
    }

    const table = UI.el('table', { class: 'monitor-table' });
    const thead = UI.el('thead');
    const headRow = UI.el('tr');
    ['Falownik', 'Hz', 'm/min', 'Prąd (A)', 'Napięcie (V)', ''].forEach((h) => headRow.appendChild(UI.el('th', {}, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = UI.el('tbody');
    for (const inv of cfg.inverters) {
      const v = values[inv.id] || {};
      const mpm = (v.freq != null && inv.mPerMinFactor != null) ? (v.freq * inv.mPerMinFactor).toFixed(1) : '—';
      const tr = UI.el('tr');
      tr.appendChild(UI.el('td', {}, `${inv.name} (#${inv.modbusAddress})`));
      tr.appendChild(UI.el('td', {}, v.freq != null ? v.freq.toFixed(2) : '—'));
      tr.appendChild(UI.el('td', {}, mpm));
      tr.appendChild(UI.el('td', {}, v.cur != null ? v.cur.toFixed(1) : '—'));
      tr.appendChild(UI.el('td', {}, v.volt != null ? v.volt.toFixed(1) : '—'));
      tr.appendChild(UI.el('td', { class: 'hint-text' }, v.error ? ('błąd: ' + v.error) : ''));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    rootEl.appendChild(table);
  }

  function start() {
    if (running) return;
    if (!bleClient.connected) {
      alert('Najpierw połącz przez BLE (przycisk CONNECT w górnym pasku).');
      return;
    }
    running = true;
    stopRequested = false;
    render();
    pollLoop();
  }

  function stop() {
    if (!running) return;
    stopRequested = true;
    running = false;
    render();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollLoop() {
    while (!stopRequested) {
      const cfg = ConfigStore.getState();
      for (const inv of cfg.inverters) {
        if (stopRequested) break;
        if (!bleClient.connected) {
          stop();
          break;
        }
        const result = { lastUpdate: Date.now() };
        try {
          for (const code of POLL_CODES) {
            const entry = Catalog.get(code);
            if (!entry) continue;
            const r = await ModbusClient.readEntry(inv.modbusAddress, entry);
            if (code === 'MON-FREQ') result.freq = r.display;
            if (code === 'MON-CUR') result.cur = r.display;
            if (code === 'MON-VOLT') result.volt = r.display;
          }
        } catch (e) {
          result.error = e.message || String(e);
        }
        values[inv.id] = result;
        render();
      }
      if (stopRequested) break;
      await sleep(POLL_PAUSE_MS);
    }
  }

  return { init, render, start, stop };
})();
