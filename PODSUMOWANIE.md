# G100 Programator — podsumowanie projektu

Stan na 2026-09-07. Zobacz też `TODO.md` (otwarte sprawy) i `extracted/G100_Programator_SPEC.md` (specyfikacja wyjściowa).

## Cel

Programator falowników LS Electric G100 przez RS-485/Modbus RTU, obsługiwany z telefonu przez przeglądarkę (PWA + Web Bluetooth), bez natywnej aplikacji.

## Sprzęt

- **Wemos D1 R32** (ESP32) + shield **DFR0259** (RS-485, MAX485, auto-direction)
- Dwa przełączniki DPDT na nakładce: **USB/programowanie** vs **RS-485/praca**, oraz **auto/manual** kierunku transmisji
- **Zasilanie z baterii** — USB z komputera powoduje szum na RS-485 (różnica masy), potwierdzone empirycznie
- Falownik **LS G100**, testowany adres Modbus 12, port 9600 8N1

## Firmware (`firmware/`, PlatformIO / Arduino-ESP32)

- Bezstanowy gateway BLE ↔ Modbus RTU — nie przechowuje katalogu parametrów ani konfiguracji falowników, tylko wykonuje pojedyncze transakcje na żądanie z PWA
- **NimBLE** (BLE GATT) do komunikacji z telefonem, JSON request/response z fragmentacją dopasowaną do MTU
- Własny Modbus RTU master: CRC16, FC03/FC04 (odczyt), FC06/FC16 (zapis, z weryfikacją echa adresu/wartości)
- RS-485 na **UART0** (dzielone z USB — przełącznik wybiera tryb), DE/RE na **GPIO2**
- **OTA przez własny WiFi AP, na żądanie** (2026-09-08): po jednorazowym wgraniu tej wersji przez USB, kolejne aktualizacje idą przez WiFi (`ArduinoOTA`) — bez kabla i bez przełącznika. WiFi AP jest **domyślnie wyłączone** (nie startuje przy boocie) — uruchamia je dopiero komenda BLE `ota_enable` (przycisk w PWA, panel Debug), aktywne ~10 min albo do końca trwającego transferu, potem gaśnie samo (albo ręcznie przez `ota_disable`) — minimalizuje czas ekspozycji sieci. SSID/hasło AP mają bezpieczne domyślne wartości w `config.h`, nadpisywalne lokalnie przez `firmware/include/wifi_secrets.h` (**gitignored**, NIE trafia do publicznego repo). BLE/Modbus działają całkowicie niezależnie od WiFi. **Uwaga na zapas pamięci Flash**: włączenie WiFi AP podniosło zużycie Flash z 57% do **94.5%** (partycja OTA, ~71KB wolnego miejsca) — niewiele przestrzeni na dalszy rozrost firmware

## PWA (`pwa/`, hostowana na GitHub Pages)

**https://r19g75.github.io/LS_programer/**

- Katalog **379 parametrów** G100 (`data/g100_catalog_full.json`) z adresowaniem PDU potwierdzonym empirycznie na sprzęcie:
  - grupy `dr`, `bA` i pozostałe grupy PAR (`Ad`, `Cn`, `In`, `OU`, `CM`, `AP`, `Pr`, `M2`) → offset **-1** względem adresu z manuala
  - grupa `SYS` (rejestry Operation Group poza tabelami PAR: `SYS-ACC`, `SYS-DEC`, `SYS-DRV`, `SYS-FRQSRC`, `SYS-FREQ`) → **bez offsetu**
- Workflow: CONNECT → READ → edycja → PROGRAMOWANIE → WERYFIKACJA → **SAVE** (automatyczny, tylko gdy wszystkie zapisy przejdą weryfikację)
- Żywy zapis częstotliwości (`0h0004`) — wymaga ustawienia źródła `Frq` na **Int 485** (`6`), nie Keypad-1; robione automatycznie
- Listy rozwijane z nazwami funkcji dla parametrów typu enum (np. P1-P5 terminal function) zamiast wpisywania numerów na pamięć
- Panel **Debug/Raw Modbus** do ręcznych testów adresowania
- Web Bluetooth, działanie offline (Service Worker)

## Status

Działające end-to-end na realnym sprzęcie: odczyt, zapis, weryfikacja, żywa zmiana częstotliwości. Repo publiczne: **github.com/r19g75/LS_programer**, wszystko zsynchronizowane z GitHub Pages.

Otwarte kwestie — patrz `TODO.md`: kilka podejrzanych wpisów katalogu do ręcznej weryfikacji względem PDF, `write_during_op` nieegzekwowane w UI, firmware ze sztywnym baudrate 9600 8N1, brak retry/ACK we fragmentacji BLE, sporny (nierozstrzygnięty sprzętowo) adres trwałego zapisu częstotliwości.
