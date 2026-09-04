// Skalowanie i walidacja wartości parametrów (sekcja 4.6 spec — "pułapki skalowania i logiki").
//
// Katalog nie ma jawnego pola "scale" per parametr, więc mnożnik wykrywamy
// generycznie z liczby miejsc dziesiętnych podanych w setting_range/initial_value
// z manuala (np. "0.00" -> x100 częstotliwość, "0.0" -> x10 prąd/czas Acc-Dec).
// To pokrywa ogólną regułę z sekcji 4.6 bez twardego kodowania 375 wpisów z osobna.
// Udokumentowane wyjątki (bA-03 signed, bA-16 min 64%) są jawnymi specjalnymi przypadkami.

const Scaling = (() => {
  const SIGNED_CODES = new Set(['bA-03']); // Aux Ref Gain, -200%..+200%, interpretować jako int16

  const MIN_OVERRIDES = {
    'bA-16': 64, // Motor efficiency: minimum 64%, nie 0 (sekcja 4.6)
  };

  function maxDecimals(...strings) {
    let max = 0;
    for (const s of strings) {
      if (!s) continue;
      const matches = String(s).matchAll(/\d+\.(\d+)/g);
      for (const m of matches) {
        max = Math.max(max, m[1].length);
      }
    }
    return Math.min(max, 2); // spec dokumentuje tylko x10/x100
  }

  function getScale(entry) {
    const decimals = maxDecimals(entry.setting_range_pdf, entry.setting_range, entry.initial_value);
    return Math.pow(10, decimals);
  }

  function isSigned(entry) {
    return SIGNED_CODES.has(entry.code);
  }

  // raw (uint16 z rejestru Modbus) -> wartość do wyświetlenia w UI
  function rawToDisplay(entry, raw) {
    let value = raw;
    if (isSigned(entry) && raw > 0x7fff) {
      value = raw - 0x10000; // interpretacja jako int16
    }
    const scale = getScale(entry);
    return value / scale;
  }

  // wartość z UI -> raw uint16 do wysłania Modbus
  function displayToRaw(entry, display) {
    const scale = getScale(entry);
    let raw = Math.round(display * scale);
    if (isSigned(entry) && raw < 0) {
      raw = raw + 0x10000; // dwójkowe dopełnienie do uint16
    }
    return raw & 0xffff;
  }

  function extractRange(entry) {
    const src = entry.setting_range_pdf || entry.setting_range || '';
    // np. "0.0–600.0 (s)" albo "0.0-600.0"
    const m = String(src).match(/(-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2])];
  }

  // Zwraca {valid: bool, message: string|null}. Walidacja "best effort" —
  // parsowanie zakresu z wolnotekstowego pola manuala nie zawsze się uda,
  // wtedy przepuszczamy wartość (walidacja jest pomocą, nie twardą blokadą
  // poza jawnie udokumentowanymi wyjątkami typu bA-16).
  function validate(entry, display) {
    if (entry.code in MIN_OVERRIDES && display < MIN_OVERRIDES[entry.code]) {
      return { valid: false, message: `Minimalna wartość dla ${entry.code} to ${MIN_OVERRIDES[entry.code]} (sekcja 4.6 spec)` };
    }
    const range = extractRange(entry);
    if (range) {
      const [min, max] = range;
      if (display < min || display > max) {
        return { valid: false, message: `Poza zakresem ${min}–${max}` };
      }
    }
    return { valid: true, message: null };
  }

  return { getScale, isSigned, rawToDisplay, displayToRaw, extractRange, validate };
})();
