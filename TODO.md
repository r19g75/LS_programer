# TODO — poprawki kosmetyczne / do zrobienia później

Nieblokujące usprawnienia UX, zebrane po pierwszych testach na sprzęcie (2026-09-04).

## Ekran konfiguracji — dodawanie falownika

- Przy dodawaniu falownika (obok wyboru adresu Modbus/ID) pokazać podpowiedź o
  **prędkości transmisji i numerze protokołu** (baudrate, parzystość/format ramki —
  CM-03/04), żeby było od razu widać gdy falownik nie ma domyślnych 9600 8N1.
  Dziś PWA zakłada domyślne parametry portu bez ostrzeżenia, jeśli ktoś je zmienił
  na konkretnej instalacji.

## Klonowanie konfiguracji między falownikami

- Nowa zakładka: klonowanie zestawu parametrów z jednego skonfigurowanego falownika
  na inny, **z pominięciem pól tożsamościowych** (adres Modbus/ID i innych parametrów
  specyficznych per-jednostka typu CM group) — żeby nie nadpisać przypadkiem adresu
  sieciowego drugiego urządzenia. Poza zakresem MVP (sekcja 7 spec też to wymieniała:
  "zapis identycznych parametrów do wielu falowników" jako punkt poza MVP), ale
  przydatne przy wymianie/serwisie wielu jednostek na raz.

## Z audytu zewnętrznego (2026-09-07) — nienaprawione jeszcze

- **Dodatkowe podejrzane wpisy katalogu** (możliwe sklejone nazwy z sąsiednich
  wierszy PDF, jak naprawione już bA-19/Ad-25/Cn-54/AP-31): `Ad-82`, `OU-54`,
  `Pr-25`, `M2-16`, `Cn-57`, `CM-93`. Wymaga tego samego ręcznego sprawdzenia
  w PDF manuala co już naprawione wpisy — nie zgadywać poprawek na sucho.
- **`write_during_op=X` nie jest egzekwowane w UI** — 132 parametry oznaczone
  jako niezmienialne podczas pracy falownika, ale `doProgram()` nie sprawdza
  stanu RUN/STOP przed zapisem. Wymagałoby dodania odczytu rejestru statusu
  pracy do workflow przed zapisem.
- **Firmware ma na sztywno 9600 8N1** i `MODBUS_RESPONSE_TIMEOUT_MS=200` —
  CM-03 pozwala na 1200–115200, CM-05 (Resp Delay) na opóźnienie do 1000ms.
  Falownik z nie-domyślnymi ustawieniami portu odetnie komunikację. Trzeba
  zrobić konfigurowalne z poziomu PWA (przekazywane przez BLE do firmware).
- **Brak retry/ACK na poziomie fragmentacji BLE** — pojedynczy zgubiony
  fragment psuje całą transakcję (timeout), bez automatycznej retransmisji.
- **Rozważyć handshake wersji firmware/modelu po CONNECT** (odczyt `0h0303`
  Inverter S/W version) — różne wersje G100 (V1.x vs V4.x) mogą mieć różne
  adresy dla tych samych kodów (potwierdzony przykład: AP-31/AP-33 w grupie
  AP różni się między wersjami manuala). Katalog dziś zakłada jedną mapę dla
  wszystkich egzemplarzy.
- **Sporna kwestia — NIE zaimplementowane bez nowego testu sprzętowego**:
  zewnętrzny audyt twierdzi (na podstawie niezweryfikowanych przeze mnie
  materiałów V4.03), że `0h1D00` to Target Frequency (trwały zapis), nie ACC,
  i że SYS-ACC/DEC/DRV/FRQSRC powinny się przesunąć o jedną pozycję w dół
  (kandydat na surowy PDU dla target frequency: `0x1CFF`). To **koliduje**
  z bezpośrednim testem sprzętowym w tej sesji (SYS-ACC pod `0h1D00` dało
  potwierdzone `4.9`, zgodne z wyświetlaczem ACC). Przed jakąkolwiek zmianą
  wymagany nowy sweep na sprzęcie w okolicy `0x1CFF-0x1D04` przy zatrzymanym
  falowniku, z bezpośrednim porównaniem do klawiatury — nie ufać samej
  dokumentacji po tym jak V1.1 już raz okazała się wewnętrznie sprzeczna.

## Zakładka podglądu/monitoringu wielu falowników — ZAIMPLEMENTOWANE (2026-09-07, adresy poprawione 2026-09-07)

Nowa zakładka **"Podgląd"** (`pwa/js/monitor.js`), czysto dodatkowa — nie modyfikuje
READ/PROGRAMOWANIE/WERYFIKACJA. Tabela wszystkich skonfigurowanych falowników naraz:
Hz zadane/rzeczywiste, m/min (przeliczone przez współczynnik **konfigurowalny per-falownik**),
Prąd, Napięcie, DC link, Moc, status (raw), V1/V0/I2. Start/Stop podglądu osobnym
przyciskiem, polling sekwencyjny co ~1s przerwy między pełnymi cyklami (BLE jest
jednym kanałem, nie da się równolegle). Zatrzymuje się automatycznie przy rozłączeniu BLE.
Odczyt zoptymalizowany: jeden batch FC03 (`0h0004` qty=16) pokrywa cały blok MON-* zamiast
osobnego requestu na parametr.

**Pierwotne adresy (`0h0312/0h0311/0h0316`, z połamanej tabeli PDF sekcji 7.6.1) były
BŁĘDNE** — potwierdzone sweepem na sprzęcie 2026-09-07 (falownik z ustawionymi na
klawiaturze 12 Hz pokazywał w Podglądzie ~3 Hz). Zastąpione blokiem Common Area
`0h0004-0h0013`. **`MON-FREQ` (0h0004) POTWIERDZONE** (sweep dał 1205 = 12.05 Hz, zgodne
z klawiaturą; to ten sam rejestr co już wcześniej potwierdzony `SYS-FREQ`). **`MON-DCLINK`
(0h000B) wiarygodne** (564V, fizycznie spójne z wyprostowanym ~400V AC 3-fazowym).

**DO ZROBIENIA PRZED UŻYCIEM PRODUKCYJNYM:** reszta bloku (`MON-FREQ-ACT`, `MON-CUR`,
`MON-VOLT`, `MON-POWER`, `MON-STATUS`, `MON-V1`, `MON-V0`) była sweepowana tylko w stanie
**STOP** (silnik nieuruchomiony) — zerowe odczyty są spójne zarówno z poprawnym adresem
(brak pracy = brak prądu/napięcia/mocy) jak i (mniej prawdopodobnie) błędnym adresem.
Test do zrobienia: uruchom falownik na znanej częstotliwości/obciążeniu, porównaj
`Podgląd` z klawiaturą/DriveView przy pracującym silniku. `MON-I2` (0h0013) w ogóle
jeszcze nie zamieciony sweepem (poprzedni sweep qty=16 zwrócił tylko 15 wartości) —
powtórzyć z qty≥17. Status (`MON-STATUS`, 0h000D) to surowy bitfield, niezdekodowany —
sweep w STOP dał `0x4001`, znaczenie bitów do ustalenia porównaniem STOP/RUN FWD/RUN REV/TRIP.
Dokładne wartości V1/V0/I2 w natywnych jednostkach (V/V/mA) czytane osobno przez już
zweryfikowane wpisy `In-05`/`In-35`/`In-50` (offset -1 standardowy, grupa "In").
