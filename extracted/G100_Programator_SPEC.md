# G100 Programator — Specyfikacja projektu

**Status:** Dokument planistyczny do realizacji przez Claude Code.
**Data:** 2026-09-04
**Poprzedni projekt (porzucony, punkt odniesienia):** "Cloner G100 v2" — WiFi AP + WebServer + BT Classic, problemy ze stabilnością połączenia z telefonem.

---

## 1. Cel

Przenośne narzędzie sprzętowo-programowe do odczytu i zapisu parametrów falowników **LS Electric G100** przez Modbus RTU (RS-485), obsługiwane z telefonu/tabletu z Androidem przez przeglądarkę (Chrome), bez instalowania natywnej aplikacji.

Docelowo (poza MVP): rozszerzenie na inne serie LS (iG5A, S100, iS7) — architektura ma to umożliwiać, ale **nie jest częścią tego etapu**.

## 2. Sprzęt

| Element | Wybór | Uwagi |
|---|---|---|
| MCU | ESP32-WROOM-32 | Dual-mode Bluetooth (Classic + **BLE**), WiFi nieużywane do komunikacji roboczej (BLE only) — zarezerwowane wyłącznie jako opcjonalny kanał OTA, patrz 6.2 |
| Konwerter RS-485 | MAX485, half-duplex, DE/RE na GPIO | Jak w poprzednim projekcie |
| Zasilanie | USB / bateria | Bez zmian |
| Magistrala | RS-485 multi-drop, **wiele falowników G100 na jednej szynie**, różne adresy Modbus (1–250) | ESP32 = gateway/master, stoi podłączony na stałe do szyny |
| Port falownika | RJ45 Modbus, 9600 8N1 domyślnie, stacja domyślna 1 | Do potwierdzenia per instalacja (może być zmieniane przez CM group) |

**Uwaga krytyczna:** zapis do CM-01 (Station ID), CM-03/04 (Baudrate/Frame) **przez tę samą sesję Modbus, którą się to zapisuje, zrywa łączność z tym urządzeniem** (self-DoS). UI musi to wyraźnie ostrzegać/blokować przed przypadkowym zapisem grupy CM.

## 3. Łączność: BLE + Web Bluetooth

**Decyzja i uzasadnienie:** WiFi AP (jak w Cloner) generuje na Androidzie problem z "brak internetu, rozłączyć?" i wymaga ręcznej ingerencji w ustawienia telefonu przy każdym połączeniu. Bluetooth Classic SPP nie jest dostępny z poziomu przeglądarki (Web Bluetooth API obsługuje wyłącznie **BLE GATT**, nie BT Classic).

→ **BLE (GATT) + Web Bluetooth API** jako jedyny kanał w MVP. Działa naturalnie w Chrome na Androidzie i desktopie, bez instalacji dodatkowej aplikacji, stabilniejsze parowanie niż WiFi AP.

**Wymóg techniczny Web Bluetooth:** wymaga *secure context* (HTTPS lub `localhost`) — spełnione przez hosting PWA na GitHub Pages (patrz sekcja 5).

**Do ustalenia w implementacji (niepewne, wymaga prototypu):**
- Rzeczywisty negocjowany MTU BLE między ESP32 a Chrome na konkretnych telefonach Androida (zwykle 185–247B po negocjacji, ale nie gwarantowane) — wpływa na rozmiar pojedynczej transakcji odczytu/zapisu.
- Konieczność fragmentacji/reassemblacji wiadomości JSON większych niż jeden pakiet BLE (protokół request/response z numerem sekwencji i długością całkowitą).

## 4. Protokół Modbus — G100

### 4.1 Warstwa fizyczna
RS-485, RTU, domyślnie 9600 8N1, adres stacji 1–250 (adresowalne przez CM-01).

### 4.2 Kody funkcji
- FC03 / FC04 — odczyt rejestrów
- FC06 — zapis pojedynczego rejestru
- FC16 — zapis wielu rejestrów
- Timeout ≥200ms, odstęp międzyramkowy T3.5 ≈4ms przy 9600bps

### 4.3 ⚠️ Adresowanie — NIEROZSTRZYGNIĘTE, WYMAGA TESTÓW EMPIRYCZNYCH

Manual (rozdz. 7.3.2, przykład FC16 dla bA-70): `Starting Address = 0x1245 (0x1246 − 1)`, czyli **PDU = Register − 1** (standardowa konwencja Modbus, rejestry 1-indexed → PDU 0-indexed).

Empiria z poprzedniego projektu (niepotwierdzona, sprzeczna):
- SAVE na `0x03E0` **bez offsetu** rzekomo działało
- Odczyt PAR area **wymagał** offsetu −1 (dump `0x1200` zwrócił wartość bA.01, nie bA.00)

**Trzy hipotezy do rozstrzygnięcia:**
1. Firmware G100 akceptuje oba schematy w różnych obszarach pamięci
2. Konwencja różni się między obszarami (Memory Control bez offsetu, PAR area z offsetem)
3. Wcześniejszy "działający" zapis SAVE był artefaktem (zmiana poszła przez DriveView, nie Modbus)

**Testy obowiązkowe przed jakąkolwiek produkcyjną implementacją zapisu (do wykonania przez użytkownika na sprzęcie, NIE zgadywać w kodzie):**

| # | Test | Cel |
|---|---|---|
| 1 | Zapis parametru wyłącznie przez Modbus (nie keypad, nie DriveView) → SAVE przez Modbus → odłączenie zasilania 30s → weryfikacja w DriveView | Czy SAVE przez Modbus faktycznie utrwala zmianę |
| 2 | Odczyt bA-01 dwukrotnie: PDU `0x1200` i PDU `0x1201`, porównanie z DriveView | Rozstrzygnięcie konwencji adresowania dla PAR area |
| 3 | FC06 vs FC16 do tego samego rejestru | Czy dają identyczny efekt |
| 4 | Powtórzenie testów 1–3 na różnych egzemplarzach G100 (różne wersje firmware, rejestr `0h0303`) | Czy konwencja jest stała między egzemplarzami |

**Rekomendacja implementacyjna:** zacząć od `PDU = Register − 1` dla całości (zgodnie z oficjalną dokumentacją, dot. Testu 1). Jeśli SAVE+power-cycle nie potwierdzi trwałości zmiany — dopiero wtedy testować konwencję alternatywną. **Nie kopiować adresów z projektu Cloner bez ponownej weryfikacji** — tam już raz wykryto niekonsystencję.

### 4.4 Mapa pamięci — obszary systemowe (pewne, źródło: `G100_Programmer_Reference.md`)

| Obszar | Zakres | Zawartość |
|---|---|---|
| Common Area | `0h0000+` | Target frequency, run/stop, status bits |
| Monitoring (R-only) | `0h0300+` | Prąd, napięcie, temperatura, trip flags, wersja firmware (`0h0303`) |
| Control (volatile) | `0h0380+` | Komendy runtime |
| Memory Control | `0h03E0+` | SAVE (`0h03E0=1`), INIT |

### 4.5 Katalog parametrów (grupy PAR)

Załącznik: **`g100_catalog_full.json`** — 375 parametrów w 10 grupach (dr, bA, Ad, Cn, In, OU, CM, AP, Pr, M2) + 1 wpis specjalny `SYS-FREQ` (patrz niżej). Każdy rekord: `code`, `group`, `register` (adres manuala), `pdu_address` (wyliczony jako register−1, **do zweryfikowania Testem 2**), `name_approx`, `name_confidence`, `setting_range`, `initial_value`, `write_during_op`, `manual_page`.

**Status jakości danych (finalny, po pełnej weryfikacji względem oryginalnego PDF manuala):**

**375/375 parametrów PAR w pełni rozwiązanych:**
- **367 — `high_pdf_verified`**: Code, adres i nazwa wyciągnięte bezpośrednio ze strukturalnej ekstrakcji tabel PDF (`Table of Functions`, str. 252–291 manuala, metoda: pdfplumber `extract_tables()` z agregacją wieloliniowych komórek).
- **6 — `high_manual_verified`** (`Ad-26, Ad-83, CM-94, AP-26, AP-33, M2-20`): nie złapane automatycznie (m.in. przez artefakt PDF — spacja wewnątrz adresu, np. `"0h131 A"` zamiast `"0h131A"`), ale zlokalizowane i potwierdzone ręcznie wprost w tekście PDF. `Ad-83`, `CM-94`, `M2-20` okazały się parametrami keypad-only (`register="-"`, brak adresu Modbus — to poprawna, potwierdzona wartość, nie brak danych).
- **2 — `medium_manual_fix`** (`bA-24`, `bA-83`): jw., pierwotny CSV miał uszkodzony adres, naprawione względem PDF.

**Plus 1 wpis specjalny poza tabelami PAR:** `SYS-FREQ` (`0h1D04`, Operation Group Freq) — wymagany przez obowiązkową procedurę trwałego zapisu częstotliwości (sekcja 4.6). Nie jest to zwykły parametr do checkboxa — patrz `usage_note` w rekordzie, wymaga dedykowanej logiki w UI (przełączenie źródła na Keypad-1 → zapis → SAVE).

**Uwaga metodologiczna dla implementacji:** przy adresowaniu z tego katalogu zdarzają się w PDF sporadyczne błędy spacji wewnątrz hex-adresu (np. `"0h131 A"`) — jeśli w przyszłości ktoś będzie ręcznie doczytywał coś z PDF, warto o tym pamiętać. W samym katalogu JSON wszystkie adresy są już znormalizowane i czyste.

Źródło: `g100_catalog_full.json` — pole `name_confidence` na każdym rekordzie wskazuje metodę/pewność pozyskania danych.

### 4.6 Pułapki skalowania i logiki (obowiązkowe do zaimplementowania)

- Prąd silnika: skala ×10 (raw 34 = 3.4A)
- Częstotliwość: skala ×100 (raw 6000 = 60.00 Hz)
- Czasy Acc/Dec: skala ×10 (raw 50 = 5.0s)
- bA-03 (Aux Ref Gain): zakres −200%..+200%, skala ×10, **wartość ze znakiem — interpretować jako int16, nie uint16**
- Częstotliwość zadana przez RS-485 **NIE zapisuje się przez standardowy SAVE** (`0h03E0`) — inny mechanizm (rejestr `0h1D04` + SAVE), do zweryfikowania empirycznie
- bA-16 (Motor efficiency): minimum 64%, nie 0 — walidacja przed wysłaniem zapisu
- Pr.91–96 (Trip history): nie mają sensu do klonowania między jednostkami; jedyna sensowna operacja to czyszczenie (Pr.96=1)
- Parametry "keypad-only" (Jump codes, Auto-tuning) **nie mają adresu Modbus** — nie próbować zapisu, UI nie powinno ich w ogóle proponować do wyboru w konfiguracji

## 5. Aplikacja (PWA)

### 5.1 Hosting
Statyczna strona (HTML/CSS/JS), hostowana na **GitHub Pages** (HTTPS z automatu — wymóg Web Bluetooth). Service Worker cache'uje zasoby po pierwszym załadowaniu → działanie offline (BLE i tak działa lokalnie, strona nie potrzebuje sieci do komunikacji z ESP32, tylko do pierwszego pobrania/aktualizacji).

Instalacja: "Dodaj do ekranu głównego" w Chrome na Androidzie — działa jak natywna aplikacja, bez sklepu/instalatora. Wiele telefonów = wielokrotna instalacja z tego samego URL, bez limitu. Aktualizacje trafiają na telefon automatycznie przy najbliższym uruchomieniu z dostępem do internetu.

### 5.2 Responsywność — WYMAGANIE
Aplikacja musi poprawnie działać na:
- Telefon Android, orientacja pionowa (portrait) — szerokość ~360–430px
- Telefon Android, orientacja pozioma (landscape)
- Tablet Android — szerokość ~768–1200px, oba układy

Layout adaptacyjny (media queries): na wąskim ekranie (telefon, portrait) zakładki falowników w formie poziomego paska przewijanego lub rozwijanego menu, panel parametrów w pełnej szerokości. Na szerszym ekranie (tablet, landscape) możliwy układ dwupanelowy: lista zakładek falowników po lewej + panel parametrów po prawej, jednocześnie widoczne.

### 5.3 Ekrany

**A. Konfiguracja**
- Dodawanie falowników: adres Modbus (1–250) + krótka nazwa
- Lista parametrów pogrupowana wg grup (dr/bA/Ad/Cn/In/OU/CM/AP/Pr/M2) z checkboxami — katalog statyczny wbudowany w PWA (`g100_catalog_full.json`)
- **Wykluczone z listy wyboru:** parametry keypad-only (`register == "-"`, brak adresu Modbus) oraz wpis specjalny `SYS-FREQ` (`0h1D04`) — ten ostatni obsługiwany osobną, dedykowaną akcją UI, nie zwykłym checkboxem (patrz 4.5)
- Grupa CM oznaczona wizualnie jako ryzykowna (możliwość zerwania połączenia przy zapisie)
- Konfiguracja zapisywana w `localStorage` telefonu — **lokalna, efemeryczna, nieprzenoszona automatycznie między telefonami/instalacjami**. Nowy telefon lub nowy zestaw falowników = konfiguracja od nowa.

**B. Ekran główny**
- Zakładka per falownik (nazwa z konfiguracji)
- Duży, czytelny widok tylko zaznaczonych w konfiguracji parametrów (nie wszystkie 375 na raz)
- Przepływ pracy w zakładce:
  1. **CONNECT** — nawiązanie BLE do ESP32 (jeśli jeszcze nie połączono)
  2. **READ** — odczyt z falownika wyłącznie zaznaczonych parametrów, wypełnienie UI realnymi wartościami
  3. **EDYCJA** — zmiany lokalnie w UI, offline od falownika, można modyfikować dowolnie bez wysyłania
  4. **PROGRAMOWANIE** — zapis zmienionych wartości do falownika (diff względem ostatniego odczytu)
  5. **WERYFIKACJA** — automatyczny ponowny odczyt po zapisie i porównanie z wysłaną wartością, wizualne potwierdzenie zgodności/niezgodności per parametr

### 5.4 Katalog parametrów w PWA
Plik `g100_catalog_full.json` dołączony do paczki aplikacji (nie pobierany z ESP32, nie wpisywany ręcznie) — źródło nazw, skal, zakresów i adresów dla ekranu konfiguracji.

## 6. Firmware ESP32

### 6.1 Stack
- PlatformIO / Arduino-ESP32
- BLE GATT server (zamiast WebServer+WiFi AP jak w Cloner)
- Modbus RTU master (biblioteka jak eModbus, do potwierdzenia w implementacji)
- **Brak potrzeby hostowania HTML/CSS/JS w PROGMEM** — UI żyje w PWA na GitHub Pages, ESP32 obsługuje wyłącznie BLE GATT + Modbus. Odciąża to flash/RAM względem architektury Cloner.

### 6.2 OTA (Over-The-Air)
Aktualizacja firmware bezprzewodowo — kanał do ustalenia w implementacji (BLE DFU lub WiFi jako dodatkowy, rzadko używany tryb tylko do celów aktualizacji, nie do bieżącej pracy). Wymaganie: brak konieczności podłączania USB przy każdej zmianie firmware.

### 6.3 Rola ESP32 w architekturze
ESP32 = "głupi" gateway protokołu: BLE GATT ↔ Modbus RTU. Nie przechowuje konfiguracji instancji (ta żyje w telefonie), nie przechowuje katalogu parametrów (ten żyje w PWA) — wyłącznie wykonuje polecenia READ/WRITE na wskazanych adresach/rejestrach przekazane przez BLE.

## 7. Poza zakresem MVP (do rozważenia później)
- Obsługa innych serii LS (iG5A, S100, iS7)
- Zapis identycznych parametrów do wielu falowników jednocześnie (broadcast/sekwencyjnie)
- Eksport/import konfiguracji między telefonami (plik JSON)
- Ekran SKAN (wykrywanie adresów/baudrate na magistrali)

## 8. Otwarte ryzyka do świadomego zaakceptowania
1. Adresowanie PDU — patrz sekcja 4.3, blokuje bezpieczną implementację zapisu do czasu wykonania Testów 1–4
2. Rzeczywisty MTU BLE i konieczność fragmentacji — nieprzetestowane na docelowym sprzęcie
3. Grupa CM — ryzyko zerwania połączenia przy niezamierzonym zapisie
4. Katalog parametrów jest już kompletny (375/375 + `SYS-FREQ`) i wysokiej jakości, ale pochodzi z automatycznej ekstrakcji PDF — przy pierwszym realnym użyciu każdego konkretnego parametru w UI warto zerknąć na `manual_page` z rekordu, zwłaszcza dla pozycji `medium_manual_fix`/`high_manual_verified` (8 pozycji: `bA-24, bA-83, Ad-26, Ad-83, CM-94, AP-26, AP-33, M2-20`)
