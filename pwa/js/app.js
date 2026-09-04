// Główna logika aplikacji: stan, wiązanie zdarzeń, orkiestracja workflow
// CONNECT -> READ -> EDYCJA -> PROGRAMOWANIE -> WERYFIKACJA (sekcja 5.3 spec).

// Numer wersji widoczny w UI (górny pasek) — bump razem z CACHE_NAME w
// service-worker.js przy każdym deployu, żeby dało się na oko sprawdzić
// czy telefon faktycznie pobrał nową wersję.
const APP_VERSION = 'v5';

(async function () {
  document.getElementById('appVersion').textContent = APP_VERSION;

  const state = {
    activeInverterId: null,
    perInverter: {}, // id -> {lastRead:{}, edited:{}, status:{}, sysFreqStatus:''}
  };

  function invState(id) {
    if (!state.perInverter[id]) {
      state.perInverter[id] = { lastRead: {}, edited: {}, status: {}, sysFreqStatus: '' };
    }
    return state.perInverter[id];
  }

  // --- Ładowanie katalogu ---
  try {
    await Catalog.load();
  } catch (e) {
    document.getElementById('app').innerHTML = `<p class="hint-text warn-text">Błąd ładowania katalogu parametrów: ${UI.escapeHtml(e.message)}</p>`;
    return;
  }

  // --- Nawigacja między widokami ---
  const navButtons = document.querySelectorAll('.navbtn');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'config') renderConfigScreen();
      if (btn.dataset.view === 'main') renderMainScreen();
    });
  });

  // --- Status BLE w topbarze ---
  function updateBleStatusUI() {
    const dot = document.getElementById('bleStatusDot');
    const text = document.getElementById('bleStatusText');
    const btn = document.getElementById('connectBtn');
    if (bleClient.connected) {
      dot.className = 'dot dot-on';
      text.textContent = 'Połączono';
      btn.textContent = 'POŁĄCZONO';
      btn.disabled = true;
    } else {
      dot.className = 'dot dot-off';
      text.textContent = 'Niepołączono';
      btn.textContent = 'CONNECT';
      btn.disabled = false;
    }
  }

  bleClient.onDisconnected = () => {
    updateBleStatusUI();
    renderMainScreen();
  };

  async function doConnect() {
    if (!bleClient.isSupported()) {
      alert('Web Bluetooth niedostępny w tej przeglądarce. Użyj Chrome na Androidzie lub desktopie.');
      return;
    }
    try {
      bleClient.chunkSize = ConfigStore.getState().bleChunkSize;
      await bleClient.connect();
      updateBleStatusUI();
      renderMainScreen();
    } catch (e) {
      if (e.name !== 'NotFoundError') alert('Błąd połączenia BLE: ' + e.message);
    }
  }
  document.getElementById('connectBtn').addEventListener('click', doConnect);

  // === EKRAN B: GŁÓWNY ===

  function selectableGroupedForInverter(inverterId) {
    const selectedCodes = new Set(ConfigStore.getSelectedParams(inverterId));
    const entries = Catalog.selectableEntries().filter((e) => selectedCodes.has(e.code));
    return Catalog.groupBy(entries);
  }

  function renderMainScreen() {
    const cfg = ConfigStore.getState();
    const tabsEl = document.getElementById('inverterTabs');
    const panelEl = document.getElementById('inverterPanel');

    if (cfg.inverters.length === 0) {
      state.activeInverterId = null;
      tabsEl.innerHTML = '';
      UI.renderInverterPanel(panelEl, { inverter: null, groupedEntries: [], sysFreqEntry: null, invState: invState('_none'), connected: bleClient.connected, handlers: {} });
      return;
    }

    if (!state.activeInverterId || !cfg.inverters.find((i) => i.id === state.activeInverterId)) {
      state.activeInverterId = cfg.inverters[0].id;
    }

    UI.renderInverterTabs(tabsEl, cfg.inverters, state.activeInverterId, (id) => {
      state.activeInverterId = id;
      renderMainScreen();
    });

    const inverter = cfg.inverters.find((i) => i.id === state.activeInverterId);
    const grouped = selectableGroupedForInverter(inverter.id);
    const ist = invState(inverter.id);

    UI.renderInverterPanel(panelEl, {
      inverter,
      groupedEntries: grouped,
      sysFreqEntry: Catalog.getSysFreqEntry(),
      invState: ist,
      connected: bleClient.connected,
      handlers: {
        onConnect: doConnect,
        onRead: () => doRead(inverter, grouped),
        onProgram: () => doProgram(inverter, grouped),
        onFieldChange: (code, value) => {
          const num = value === '' ? undefined : parseFloat(value);
          ist.edited[code] = num;
        },
        onSysFreqWrite: (freqValue, sourceConfirmed) => doSysFreqWrite(inverter, freqValue, sourceConfirmed),
      },
    });
  }

  async function doRead(inverter, grouped) {
    const ist = invState(inverter.id);
    const entries = grouped.flatMap((g) => g.entries);
    if (entries.length === 0) return;
    for (const e of entries) ist.status[e.code] = { pending: true };
    renderMainScreen();

    await ModbusClient.readEntries(inverter.modbusAddress, entries, (entry, result) => {
      if (result.ok) {
        ist.lastRead[entry.code] = { raw: result.raw, display: result.display };
        delete ist.edited[entry.code];
        ist.status[entry.code] = { read: true };
      } else {
        ist.status[entry.code] = { error: result.error };
      }
      renderMainScreen();
    });
  }

  async function doProgram(inverter, grouped) {
    const ist = invState(inverter.id);
    const entries = grouped.flatMap((g) => g.entries);
    const diff = [];
    for (const entry of entries) {
      const edited = ist.edited[entry.code];
      const read = ist.lastRead[entry.code];
      if (edited === undefined) continue;
      if (read && edited === read.display) continue;
      diff.push(entry);
    }
    if (diff.length === 0) {
      alert('Brak zmian do zaprogramowania — najpierw zmień wartości w polach.');
      return;
    }

    const hasRisky = diff.some((e) => Catalog.isRiskyGroup(e.group));
    if (hasRisky) {
      const ok = await UI.showModal({
        title: '⚠ Zapis do grupy CM',
        bodyHtml: `Wybrane zmiany zawierają parametry grupy <b>CM</b> (Station ID / Baudrate / Frame). Zapis tych parametrów <b>przez tę samą sesję Modbus może natychmiast zerwać łączność</b> z tym falownikiem (self-DoS, sekcja 2 spec). Kontynuować?`,
        confirmLabel: 'Tak, zapisz mimo to',
        danger: true,
      });
      if (!ok) return;
    }

    // Walidacja (sekcja 4.6 spec — np. bA-16 min 64%) przed wysyłką
    const toWrite = [];
    for (const entry of diff) {
      const displayValue = ist.edited[entry.code];
      const validation = Scaling.validate(entry, displayValue);
      if (!validation.valid) {
        ist.status[entry.code] = { error: validation.message };
        continue;
      }
      toWrite.push({ entry, displayValue });
      ist.status[entry.code] = { pending: true };
    }
    renderMainScreen();
    if (toWrite.length === 0) return;

    await ModbusClient.writeEntries(inverter.modbusAddress, toWrite, (entry, result) => {
      ist.status[entry.code] = result.ok ? { written: true } : { error: result.error };
      renderMainScreen();
    });

    // WERYFIKACJA — automatyczny ponowny odczyt i porównanie (sekcja 5.3 krok 5)
    const writtenOk = toWrite.filter(({ entry }) => ist.status[entry.code] && ist.status[entry.code].written);
    if (writtenOk.length === 0) return;

    for (const { entry } of writtenOk) ist.status[entry.code] = { pending: true };
    renderMainScreen();

    await ModbusClient.readEntries(inverter.modbusAddress, writtenOk.map((w) => w.entry), (entry, result) => {
      const intended = toWrite.find((w) => w.entry.code === entry.code).displayValue;
      if (!result.ok) {
        ist.status[entry.code] = { error: result.error };
        return;
      }
      ist.lastRead[entry.code] = { raw: result.raw, display: result.display };
      delete ist.edited[entry.code];
      const match = Math.abs(result.display - intended) < 1e-6;
      ist.status[entry.code] = { verify: { match, expected: intended, actual: result.display } };
      renderMainScreen();
    });
  }

  async function doSysFreqWrite(inverter, freqValue, sourceConfirmed) {
    const ist = invState(inverter.id);
    const statusEl = () => document.getElementById('sysFreqStatus');
    if (!sourceConfirmed) {
      ist.sysFreqStatus = '⚠ Najpierw potwierdź, że źródło Frq jest ustawione na Keypad-1 (na klawiaturze falownika lub w DriveView).';
      if (statusEl()) statusEl().textContent = ist.sysFreqStatus;
      return;
    }
    if (isNaN(freqValue)) {
      ist.sysFreqStatus = '⚠ Podaj poprawną wartość częstotliwości.';
      if (statusEl()) statusEl().textContent = ist.sysFreqStatus;
      return;
    }
    const sysFreqEntry = Catalog.getSysFreqEntry();
    ist.sysFreqStatus = 'Zapisywanie częstotliwości...';
    if (statusEl()) statusEl().textContent = ist.sysFreqStatus;
    try {
      await ModbusClient.writeEntry(inverter.modbusAddress, sysFreqEntry, freqValue);
      ist.sysFreqStatus = 'Częstotliwość zapisana, zapisuję SAVE (0h03E0=1)...';
      if (statusEl()) statusEl().textContent = ist.sysFreqStatus;
      const saveResp = await ModbusClient.saveToMemory(inverter.modbusAddress);
      if (saveResp.ok) {
        ist.sysFreqStatus = `✓ Zapisano ${freqValue} Hz i wykonano SAVE. Zweryfikuj trwałość po power-cycle (Test 1, sekcja 4.3 spec).`;
      } else {
        ist.sysFreqStatus = `Częstotliwość zapisana, ale SAVE nie powiodło się: ${saveResp.error}`;
      }
    } catch (e) {
      ist.sysFreqStatus = 'Błąd zapisu: ' + e.message;
    }
    if (statusEl()) statusEl().textContent = ist.sysFreqStatus;
  }

  // === EKRAN A: KONFIGURACJA ===

  function renderConfigScreen() {
    const cfg = ConfigStore.getState();

    UI.renderInverterList(document.getElementById('inverterList'), cfg.inverters, {
      onRemove: async (id) => {
        const ok = await UI.showModal({ title: 'Usuń falownik', bodyHtml: 'Na pewno usunąć ten falownik z konfiguracji? Wybrane parametry i lokalny odczyt zostaną utracone.', confirmLabel: 'Usuń', danger: true });
        if (!ok) return;
        ConfigStore.removeInverter(id);
        delete state.perInverter[id];
        if (state.activeInverterId === id) state.activeInverterId = null;
        renderConfigScreen();
        renderMainScreen();
      },
    });

    const select = document.getElementById('configInverterSelect');
    const prevSelected = select.value;
    UI.renderConfigInverterSelect(select, cfg.inverters, prevSelected || (cfg.inverters[0] && cfg.inverters[0].id));
    renderParamCatalogForSelectedInverter();

    document.getElementById('debugModeToggle').checked = cfg.debugMode;
    document.getElementById('navDebugBtn').hidden = !cfg.debugMode;
    document.getElementById('bleChunkSizeInput').value = cfg.bleChunkSize;
  }

  function renderParamCatalogForSelectedInverter() {
    const select = document.getElementById('configInverterSelect');
    const container = document.getElementById('paramCatalog');
    const inverterId = select.value;
    if (!inverterId) {
      container.innerHTML = '<p class="empty-hint">Dodaj najpierw falownik.</p>';
      return;
    }
    const grouped = Catalog.groupBy(Catalog.selectableEntries());
    const selected = ConfigStore.getSelectedParams(inverterId);
    UI.renderParamCatalogCheckboxes(container, grouped, selected, (code, checked) => {
      const current = new Set(ConfigStore.getSelectedParams(inverterId));
      if (checked) current.add(code); else current.delete(code);
      ConfigStore.setSelectedParams(inverterId, Array.from(current));
    });
  }

  document.getElementById('configInverterSelect').addEventListener('change', renderParamCatalogForSelectedInverter);

  document.getElementById('addInverterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('newInverterName');
    const addrInput = document.getElementById('newInverterAddress');
    const name = nameInput.value.trim();
    const addr = parseInt(addrInput.value, 10);
    if (!name || !addr || addr < 1 || addr > 250) {
      alert('Podaj nazwę i adres Modbus w zakresie 1-250.');
      return;
    }
    ConfigStore.addInverter(name, addr);
    nameInput.value = '';
    addrInput.value = '';
    renderConfigScreen();
    renderMainScreen();
  });

  document.getElementById('debugModeToggle').addEventListener('change', (e) => {
    ConfigStore.setDebugMode(e.target.checked);
    document.getElementById('navDebugBtn').hidden = !e.target.checked;
  });

  document.getElementById('bleChunkSizeInput').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (n >= 16 && n <= 500) {
      ConfigStore.setBleChunkSize(n);
      bleClient.chunkSize = n;
    }
  });

  // === Inicjalizacja ===
  bleClient.chunkSize = ConfigStore.getState().bleChunkSize;
  document.getElementById('navDebugBtn').hidden = !ConfigStore.getState().debugMode;
  DebugPanel.init(document.getElementById('debugPanelRoot'));

  updateBleStatusUI();
  renderMainScreen();
  renderConfigScreen();

  // Rejestracja Service Workera (offline, sekcja 5.1 spec)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW registration failed', e));
  }
})();
