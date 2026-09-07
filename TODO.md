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

## Zakładka podglądu/monitoringu wielu falowników — ZAIMPLEMENTOWANE (2026-09-07)

Nowa zakładka **"Podgląd"** (`pwa/js/monitor.js`), czysto dodatkowa — nie modyfikuje
READ/PROGRAMOWANIE/WERYFIKACJA. Tabela wszystkich skonfigurowanych falowników naraz:
Hz, m/min (przeliczone przez współczynnik **konfigurowalny per-falownik**, pole w
Konfiguracji obok adresu Modbus), Prąd, Napięcie. Start/Stop podglądu osobnym
przyciskiem, polling sekwencyjny co ~1s przerwy między pełnymi cyklami (BLE jest
jednym kanałem, nie da się równolegle). Zatrzymuje się automatycznie przy rozłączeniu BLE.

**DO ZROBIENIA PRZED UŻYCIEM PRODUKCYJNYM — adresy pomiarowe NIEPOTWIERDZONE:**
`MON-FREQ` (0h0312), `MON-CUR` (0h0311), `MON-VOLT` (0h0316) w katalogu (grupa "MON")
odczytane z sekcji 7.6.1 manuala ("Monitoring Area Parameter"), ale ta tabela w PDF
jest silnie połamana przez zawijanie kolumn (adresy/nazwy/bity statusu przemieszane) —
**nie zweryfikowane sweepem na sprzęcie** jak reszta adresów w tym projekcie. Skala
(x100 dla Hz, x10 dla prądu/napięcia) to też założenie, nie potwierdzone. W UI jest
widoczny baner ostrzegawczy dopóki to się nie zmieni.

Test do zrobienia: uruchom falownik na znanej częstotliwości/obciążeniu, porównaj
`Podgląd` z klawiaturą/DriveView. Jeśli adresy złe — sweep okolicy `0h0300-0h031D`
(jak przy `bA-10/11` i `SYS-FREQ`), potem poprawić 3 wpisy w katalogu.

Prąd wejścia analogowego (I2) — pominięty na razie, nie dodany do tabeli (nie było
w pierwszej wersji adresów Monitoring Area, do rozważenia osobno jeśli potrzebny).
