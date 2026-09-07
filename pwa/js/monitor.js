// Zakładka "Podgląd" — monitor procesu, wiele falowników jednocześnie
// (Hz zadane/rzeczywiste, m/min, prąd, napięcie, DC link, moc, status,
// wejścia analogowe V1/V0/I2). Czysto dodatkowy moduł — nie modyfikuje
// istniejącego workflow READ/PROGRAMOWANIE/WERYFIKACJA w app.js/ui.js.
//
// Adresy (katalog, grupa "MON", Common Area 0h0004-0h0013) zweryfikowane
// sweepem 2026-09-07: MON-FREQ (0h0004) POTWIERDZONE (zgodne z 12 Hz na
// klawiaturze), MON-DCLINK (0h000B) wiarygodne (564V, fizycznie spójne z
// wyprostowanym napięciem 3-fazowym ~400V), reszta (FREQ-ACT/CUR/VOLT/POWER/
// STATUS/V1/V0) NIEPOTWIERDZONA W PELNI — sweep wykonany w stanie STOP, więc
// zerowe odczyty są spójne zarówno z poprawnym adresem (silnik stał) jak i
// (mniej prawdopodobnie) błędnym. Do potwierdzenia: powtórzyć porównanie
// z falownikiem w stanie RUN. Baner ostrzegawczy w UI poniżej, do usunięcia
// dopiero po tej weryfikacji. MON-I2 w ogóle jeszcze nie zamieciony sweepem.
//
// Odczyt: JEDEN batch FC03 (0h0004, qty=16) pokrywa cały blok MON-* naraz
// (10 wartości z jednej transakcji Modbus zamiast 10 osobnych), plus 3
// osobne odczyty In-05/In-35/In-50 (wartości precyzyjne w V/mA, poza blokiem).

const Monitor = (() => {
  const BLOCK_START = 0x0004;
  const BLOCK_QTY = 16;
  const BLOCK_CODES = ['MON-FREQ', 'MON-FREQ-ACT', 'MON-CUR', 'MON-VOLT', 'MON-DCLINK', 'MON-POWER', 'MON-STATUS', 'MON-V1', 'MON-V0', 'MON-I2'];
  const PRECISE_CODES = ['In-05', 'In-35', 'In-50']; // V1(V), V0(V), I2(mA) — już zweryfikowane wpisy PDF, offset -1 standardowy
  const POLL_PAUSE_MS = 1000; // przerwa między pełnymi cyklami (wszystkie falowniki)

  let running = false;
  let stopRequested = false;
  let rootEl = null;
  const values = {}; // inverterId -> {freqSet, freqAct, cur, volt, dclink, power, statusRaw, v1pct, v0pct, i2pct, v1V, v0V, i2mA, error, lastUpdate}

  function init(root) {
    rootEl = root;
    render();
  }

  function blockOffset(entry) {
    return parseInt(String(entry.pdu_address).replace('0h', ''), 16) - BLOCK_START;
  }

  function render() {
    if (!rootEl) return;
    const cfg = ConfigStore.getState();
    rootEl.innerHTML = '';

    const warn = UI.el('p', { class: 'hint-text warn-text' },
      '⚠ Częstotliwość zadana (Hz zad.) i DC link są potwierdzone/wiarygodne. Pozostałe wartości (Hz rzecz., prąd, napięcie, moc, status, V1/V0/I2) były testowane tylko w stanie STOP (falownik nieuruchomiony) — porównaj z klawiaturą/DriveView przy pracującym falowniku zanim zaczniesz na nich polegać operacyjnie. Szczegóły w katalogu, wpisy MON-*.');
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
    ['Falownik', 'Hz zad.', 'Hz rzecz.', 'm/min', 'Prąd (A)', 'Napięcie (V)', 'DC (V)', 'Moc (kW)', 'V1', 'V0', 'I2', 'Status', ''].forEach((h) => headRow.appendChild(UI.el('th', {}, h)));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = UI.el('tbody');
    for (const inv of cfg.inverters) {
      const v = values[inv.id] || {};
      const freqForSpeed = v.freqAct != null ? v.freqAct : null;
      const mpm = (freqForSpeed != null && inv.mPerMinFactor != null) ? (freqForSpeed * inv.mPerMinFactor).toFixed(1) : '—';
      const tr = UI.el('tr');
      tr.appendChild(UI.el('td', {}, `${inv.name} (#${inv.modbusAddress})`));
      tr.appendChild(UI.el('td', {}, v.freqSet != null ? v.freqSet.toFixed(2) : '—'));
      tr.appendChild(UI.el('td', {}, v.freqAct != null ? v.freqAct.toFixed(2) : '—'));
      tr.appendChild(UI.el('td', {}, mpm));
      tr.appendChild(UI.el('td', {}, v.cur != null ? v.cur.toFixed(1) : '—'));
      tr.appendChild(UI.el('td', {}, v.volt != null ? v.volt.toFixed(0) : '—'));
      tr.appendChild(UI.el('td', {}, v.dclink != null ? v.dclink.toFixed(0) : '—'));
      tr.appendChild(UI.el('td', {}, v.power != null ? v.power.toFixed(1) : '—'));
      tr.appendChild(UI.el('td', {}, v.v1V != null ? `${v.v1V.toFixed(2)}V` : (v.v1pct != null ? `${v.v1pct.toFixed(1)}%` : '—')));
      tr.appendChild(UI.el('td', {}, v.v0V != null ? `${v.v0V.toFixed(2)}V` : (v.v0pct != null ? `${v.v0pct.toFixed(1)}%` : '—')));
      tr.appendChild(UI.el('td', {}, v.i2mA != null ? `${v.i2mA.toFixed(2)}mA` : (v.i2pct != null ? `${v.i2pct.toFixed(1)}%` : '—')));
      tr.appendChild(UI.el('td', {}, v.statusRaw != null ? `0x${v.statusRaw.toString(16).padStart(4, '0')}` : '—'));
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

  async function readInverter(inv) {
    const result = { lastUpdate: Date.now() };

    const blockResp = await ModbusClient.readRawRegister(inv.modbusAddress, 3, `0h${BLOCK_START.toString(16).padStart(4, '0')}`, BLOCK_QTY);
    if (!blockResp.ok) {
      throw new Error(blockResp.error || 'odczyt bloku MON nieudany');
    }
    for (const code of BLOCK_CODES) {
      const entry = Catalog.get(code);
      if (!entry) continue;
      const idx = blockOffset(entry);
      if (idx < 0 || idx >= blockResp.values.length) continue; // np. MON-I2 poza aktualnie zamiecionym zakresem
      const raw = blockResp.values[idx];
      const display = Scaling.rawToDisplay(entry, raw);
      if (code === 'MON-FREQ') result.freqSet = display;
      if (code === 'MON-FREQ-ACT') result.freqAct = display;
      if (code === 'MON-CUR') result.cur = display;
      if (code === 'MON-VOLT') result.volt = display;
      if (code === 'MON-DCLINK') result.dclink = display;
      if (code === 'MON-POWER') result.power = display;
      if (code === 'MON-STATUS') result.statusRaw = raw;
      if (code === 'MON-V1') result.v1pct = display;
      if (code === 'MON-V0') result.v0pct = display;
      if (code === 'MON-I2') result.i2pct = display;
    }

    for (const code of PRECISE_CODES) {
      const entry = Catalog.get(code);
      if (!entry) continue;
      try {
        const r = await ModbusClient.readEntry(inv.modbusAddress, entry);
        if (code === 'In-05') result.v1V = r.display;
        if (code === 'In-35') result.v0V = r.display;
        if (code === 'In-50') result.i2mA = r.display;
      } catch (e) {
        // Precyzyjne odczyty V/mA są opcjonalne — brak nie blokuje reszty panelu.
      }
    }

    return result;
  }

  async function pollLoop() {
    // Zabezpieczenie: cokolwiek nieoczekiwanego rzuci wyjątek w tej pętli
    // (np. błąd w render()), `running` MUSI wrócić do false w finally,
    // inaczej przycisk zostałby trwale zablokowany na "Zatrzymaj podgląd"
    // mimo że pętla faktycznie by umarła (martwy stan bez odzyskania).
    try {
      while (!stopRequested) {
        const cfg = ConfigStore.getState();
        for (const inv of cfg.inverters) {
          if (stopRequested) break;
          if (!bleClient.connected) {
            stop();
            break;
          }
          let result;
          try {
            result = await readInverter(inv);
          } catch (e) {
            result = { lastUpdate: Date.now(), error: e.message || String(e) };
          }
          values[inv.id] = result;
          try {
            render();
          } catch (renderErr) {
            console.error('Monitor.render() błąd:', renderErr);
          }
        }
        if (stopRequested) break;
        await sleep(POLL_PAUSE_MS);
      }
    } catch (fatalErr) {
      console.error('Monitor.pollLoop() nieoczekiwany błąd, zatrzymuję podgląd:', fatalErr);
    } finally {
      running = false;
      stopRequested = false;
      try {
        render();
      } catch (renderErr) {
        console.error('Monitor.render() błąd:', renderErr);
      }
    }
  }

  return { init, render, start, stop };
})();
