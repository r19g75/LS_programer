// Buduje transakcje Modbus (przez ble-client) na podstawie katalogu parametrów
// i stosuje skalowanie z scaling.js.
//
// Adresowanie PDU (sekcja 4.3 spec) — KONWENCJA NIE JEST JEDNOLITA MIĘDZY GRUPAMI
// (potwierdzone empirycznie na tym sprzęcie, sweep 0x1207-0x120D vs klawiatura
// falownika, 2026-09-04):
//   - grupa "dr": PDU = register BEZ offsetu (potwierdzone: dr.14 -> 0x110E,
//     zrodlo: poprzedni projekt Cloner, G100Registers.h)
//   - grupa "SYS" (SYS-ACC/SYS-DEC/SYS-FREQ, rejestry Operation group poza PAR):
//     PDU = register BEZ offsetu (potwierdzone: SYS-ACC dalo poprawne 4.9)
//   - WSZYSTKIE POZOSTAŁE grupy PAR (bA, Ad, Cn, In, OU, CM, AP, Pr, M2):
//     PDU = register - 1, czyli pole `pdu_address` (potwierdzone empirycznie
//     na grupie bA: sweep pokazal ze bA.10/bA.11 z klawiatury odpowiadaja
//     adresom o 1 nizszym niz `register` w katalogu). Zgadza sie z ostrzezeniem
//     w PROJECT_STATE.md starego projektu: "wzor NIE jest jednolity - w grupie
//     DRV adres = 0x1100+Code, w innych grupach adres = base+(Code-1)".
const NO_OFFSET_GROUPS = new Set(['dr', 'SYS']);

const ModbusClient = (() => {
  let seqCounter = 1;
  function nextSeq() {
    seqCounter = (seqCounter % 65535) + 1;
    return seqCounter;
  }

  function pduHex(entry) {
    return String(NO_OFFSET_GROUPS.has(entry.group) ? entry.register : entry.pdu_address);
  }

  // Odczyt pojedynczo po parametrze (prostsze i bezpieczniejsze niż batchowanie
  // przez ewentualne dziury w mapie rejestrów; wystarczające dla zestawu
  // wybranych w konfiguracji parametrów, nie wszystkich 375 na raz).
  async function readEntry(slave, entry) {
    // PAR-area w G100 czyta się przez FC03 (Holding Register), nie FC04
    // (Input Register) — patrz sekcja 4.2 spec.
    const req = { seq: nextSeq(), op: 'read', slave, fc: 3, addr: pduHex(entry), qty: 1 };
    const resp = await bleClient.sendRequest(req);
    if (!resp.ok) throw new ModbusError(entry, resp.error, resp.exception_code, resp.raw);
    const raw = resp.values[0];
    return { raw, display: Scaling.rawToDisplay(entry, raw) };
  }

  async function readEntries(slave, entries, onProgress) {
    const results = {};
    for (const entry of entries) {
      try {
        results[entry.code] = { ok: true, ...(await readEntry(slave, entry)) };
      } catch (err) {
        results[entry.code] = { ok: false, error: err.message || String(err) };
      }
      if (onProgress) onProgress(entry, results[entry.code]);
    }
    return results;
  }

  async function writeEntry(slave, entry, displayValue) {
    const raw = Scaling.displayToRaw(entry, displayValue);
    const req = { seq: nextSeq(), op: 'write', slave, fc: 6, addr: pduHex(entry), values: [raw] };
    const resp = await bleClient.sendRequest(req);
    if (!resp.ok) throw new ModbusError(entry, resp.error, resp.exception_code, resp.raw);
    return raw;
  }

  async function writeEntries(slave, entriesWithValues, onProgress) {
    // entriesWithValues: [{entry, displayValue}]
    const results = {};
    for (const { entry, displayValue } of entriesWithValues) {
      try {
        const raw = await writeEntry(slave, entry, displayValue);
        results[entry.code] = { ok: true, raw };
      } catch (err) {
        results[entry.code] = { ok: false, error: err.message || String(err) };
      }
      if (onProgress) onProgress(entry, results[entry.code]);
    }
    return results;
  }

  async function writeRawRegister(slave, fc, pduAddrHex, values) {
    // Panel Debug/Raw Modbus — surowy zapis pod dowolny adres (Testy 1-4, sekcja 4.3 spec)
    const req = { seq: nextSeq(), op: 'write', slave, fc, addr: pduAddrHex, values };
    return bleClient.sendRequest(req);
  }

  async function readRawRegister(slave, fc, pduAddrHex, qty) {
    const req = { seq: nextSeq(), op: 'read', slave, fc, addr: pduAddrHex, qty };
    return bleClient.sendRequest(req);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // SAVE do Memory Control area (0h03E0) — sekcja 4.4 spec.
  // G100 wymaga sekwencji 0 -> 1, samo ustawienie 1 nie wystarcza (potwierdzone
  // empirycznie w poprzednim projekcie Cloner G100 v2, cytat z manuala G100
  // rozdz. 7.2.6 w kodzie: "Setting address 0h03E0 to 0 and then setting it
  // again to 1 via communication allows the existing parameter settings to be
  // saved. However, setting address 0h03E0 to 1 and then setting it to 0 does
  // not carry out the same function.").
  async function saveToMemory(slave) {
    const zeroResp = await writeRawRegister(slave, 6, '0h03E0', [0]);
    if (!zeroResp.ok) return zeroResp;
    await sleep(50);
    const oneResp = await writeRawRegister(slave, 6, '0h03E0', [1]);
    if (oneResp.ok) await sleep(300); // daj falownikowi czas na fizyczny zapis do EEPROM
    return oneResp;
  }

  return { readEntry, readEntries, writeEntry, writeEntries, writeRawRegister, readRawRegister, saveToMemory };
})();

class ModbusError extends Error {
  constructor(entry, error, exceptionCode, raw) {
    super(`${entry.code}: ${error}${exceptionCode != null ? ' (kod ' + exceptionCode + ')' : ''}${raw ? ' | raw: ' + raw : ''}`);
    this.entry = entry;
    this.error = error;
    this.exceptionCode = exceptionCode;
    this.raw = raw;
  }
}
