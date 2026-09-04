// Ładowanie i filtrowanie katalogu parametrów G100 (sekcja 4.5 / 5.4 spec).
// Katalog statyczny, wbudowany w PWA (data/g100_catalog_full.json) — nie pobierany z ESP32.

const Catalog = (() => {
  let allEntries = [];
  let byCode = new Map();

  async function load() {
    const res = await fetch('data/g100_catalog_full.json');
    if (!res.ok) throw new Error('Nie udało się wczytać katalogu parametrów: ' + res.status);
    allEntries = await res.json();
    byCode = new Map(allEntries.map((e) => [e.code, e]));
    return allEntries;
  }

  function all() {
    return allEntries;
  }

  function get(code) {
    return byCode.get(code);
  }

  // Parametry keypad-only (register == "-") nie mają adresu Modbus — nie proponować do wyboru.
  function isKeypadOnly(entry) {
    return entry.register === '-' || entry.register == null;
  }

  // SYS-FREQ to wpis specjalny obsługiwany dedykowaną akcją UI, nie zwykłym checkboxem (sekcja 4.5/5.3).
  function isSpecial(entry) {
    return entry.code === 'SYS-FREQ';
  }

  // Lista do ekranu konfiguracji: bez keypad-only i bez wpisów specjalnych.
  function selectableEntries() {
    return allEntries.filter((e) => !isKeypadOnly(e) && !isSpecial(e));
  }

  function getSysFreqEntry() {
    return allEntries.find((e) => e.code === 'SYS-FREQ');
  }

  function groupBy(entries) {
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.group)) groups.set(e.group, { group: e.group, groupName: e.group_name, entries: [] });
      groups.get(e.group).entries.push(e);
    }
    return Array.from(groups.values()).sort((a, b) => a.group.localeCompare(b.group));
  }

  // Grupa CM = ryzykowna (zapis może zerwać połączenie Modbus z falownikiem, sekcja 2/5.3 spec).
  function isRiskyGroup(group) {
    return group === 'CM';
  }

  return {
    load,
    all,
    get,
    isKeypadOnly,
    isSpecial,
    selectableEntries,
    getSysFreqEntry,
    groupBy,
    isRiskyGroup,
  };
})();
