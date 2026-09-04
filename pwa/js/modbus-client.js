// Buduje transakcje Modbus (przez ble-client) na podstawie katalogu parametrów
// i stosuje skalowanie z scaling.js. Adres PDU = pdu_address z katalogu
// (rekomendacja sekcji 4.3 spec: PDU = register-1, DO ZWERYFIKOWANIA na sprzęcie).

const ModbusClient = (() => {
  let seqCounter = 1;
  function nextSeq() {
    seqCounter = (seqCounter % 65535) + 1;
    return seqCounter;
  }

  function pduHex(entry) {
    return String(entry.pdu_address); // już w formacie "0hXXXX", firmware parsuje bezpośrednio
  }

  // Odczyt pojedynczo po parametrze (prostsze i bezpieczniejsze niż batchowanie
  // przez ewentualne dziury w mapie rejestrów; wystarczające dla zestawu
  // wybranych w konfiguracji parametrów, nie wszystkich 375 na raz).
  async function readEntry(slave, entry) {
    const req = { seq: nextSeq(), op: 'read', slave, fc: 4, addr: pduHex(entry), qty: 1 };
    // FC04 (Input Register) jest bezpiecznym wyborem do odczytu monitoringu,
    // ale PAR-area w G100 czyta się przez FC03 (Holding Register) — patrz sekcja 4.2 spec.
    req.fc = 3;
    const resp = await bleClient.sendRequest(req);
    if (!resp.ok) throw new ModbusError(entry, resp.error, resp.exception_code);
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
    if (!resp.ok) throw new ModbusError(entry, resp.error, resp.exception_code);
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

  // SAVE do Memory Control area (0h03E0=1) — sekcja 4.4 spec.
  async function saveToMemory(slave) {
    return writeRawRegister(slave, 6, '0h03E0', [1]);
  }

  return { readEntry, readEntries, writeEntry, writeEntries, writeRawRegister, readRawRegister, saveToMemory };
})();

class ModbusError extends Error {
  constructor(entry, error, exceptionCode) {
    super(`${entry.code}: ${error}${exceptionCode != null ? ' (kod ' + exceptionCode + ')' : ''}`);
    this.entry = entry;
    this.error = error;
    this.exceptionCode = exceptionCode;
  }
}
