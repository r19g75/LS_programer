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

  // Grupa MON = rejestry tylko-do-odczytu używane wyłącznie przez zakładkę
  // Podgląd (monitor.js) — nie parametry do programowania, nie pokazywać
  // jako checkboxy na ekranie konfiguracji.
  function isMonitorOnly(entry) {
    return entry.group === 'MON';
  }

  // Lista do ekranu konfiguracji: bez keypad-only, wpisów specjalnych i monitoringu.
  function selectableEntries() {
    return allEntries.filter((e) => !isKeypadOnly(e) && !isSpecial(e) && !isMonitorOnly(e));
  }

  function getSysFreqEntry() {
    return allEntries.find((e) => e.code === 'SYS-FREQ');
  }

  // SYS (rejestry poza tabelami PAR: ACC/dEC/drv/Frq/FREQ) i dr (m.in. Jog
  // Freq/Acc/Dec) na górze listy — najczęściej potrzebne przy pierwszym
  // uruchomieniu falownika, reszta grup alfabetycznie za nimi.
  const GROUP_ORDER = ['SYS', 'dr'];
  function groupSortKey(group) {
    const idx = GROUP_ORDER.indexOf(group);
    return idx === -1 ? GROUP_ORDER.length : idx;
  }

  function groupBy(entries) {
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.group)) groups.set(e.group, { group: e.group, groupName: e.group_name, entries: [] });
      groups.get(e.group).entries.push(e);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const keyDiff = groupSortKey(a.group) - groupSortKey(b.group);
      return keyDiff !== 0 ? keyDiff : a.group.localeCompare(b.group);
    });
  }

  // Grupa CM = ryzykowna (zapis może zerwać połączenie Modbus z falownikiem, sekcja 2/5.3 spec).
  function isRiskyGroup(group) {
    return group === 'CM';
  }

  // Parsuje listę opcji "N Etykieta | N Etykieta | ..." (albo "N: Etykieta")
  // z setting_range_pdf/setting_range — używane m.in. do podpowiedzi nazwy
  // funkcji przypisanej do wejścia/wyjścia cyfrowego (np. "6 JOG").
  // Uwaga: dane manuala bywają niekompletne/zaszumione dla niektórych wpisów
  // (znane ograniczenie ekstrakcji z PDF) — podpowiedź jest pomocą, nie
  // gwarancją kompletności.
  function parseEnumOptions(entry) {
    const src = entry.setting_range_pdf || entry.setting_range || '';
    const options = new Map();
    for (const segment of String(src).split('|')) {
      const m = segment.trim().match(/^(-?\d+)\s*:?\s+(.+)$/);
      if (m) options.set(parseInt(m[1], 10), m[2].trim());
    }
    return options;
  }

  // Zwraca etykietę dla aktualnej (całkowitej) wartości, albo null jeśli
  // parametr nie jest rozpoznany jako enum albo wartość nie ma odpowiednika.
  function enumLabel(entry, value) {
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) > 1e-9) return null;
    const options = parseEnumOptions(entry);
    return options.has(rounded) ? options.get(rounded) : null;
  }

  return {
    load,
    all,
    get,
    isKeypadOnly,
    isSpecial,
    isMonitorOnly,
    selectableEntries,
    getSysFreqEntry,
    groupBy,
    isRiskyGroup,
    parseEnumOptions,
    enumLabel,
  };
})();
