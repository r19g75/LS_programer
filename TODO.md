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

## Nowa funkcja: zakładka podglądu/monitoringu wielu falowników (2026-09-07)

**WAŻNE: ma być czysto dodatkowa** — nowa zakładka/moduł obok istniejących, bez
modyfikowania działającego dziś kodu READ/PROGRAMOWANIE/WERYFIKACJA, adresowania,
katalogu itp. Użytkownik wprost zastrzegł żeby nie ruszać tego co już działa.

Pomysł użytkownika po pierwszych testach na sprzęcie — osobna zakładka, optymalizowana
pod telefon w **poziomie**, pokazująca **jednocześnie kilka falowników** (np. 5) w formie
tabeli/kafelków zamiast pojedynczej zakładki na raz jak dziś w "Falowniki". Dla każdego:

- Częstotliwość (Hz) — odczyt live
- Prędkość liniowa (m/min) — przeliczona z Hz przez współczynnik **konfigurowalny
  per-falownik** (potwierdzone przez użytkownika: nie jest stały, różne mechanizmy mają
  różne przełożenia/średnice rolek). Do dodania w ekranie Konfiguracji przy danym
  falowniku, obok adresu Modbus.
- Prąd, napięcie
- Prąd wejścia analogowego (I2) — jeśli dotyczy danej instalacji

Wymagania funkcjonalne:
- **Włącz/wyłącz** tryb podglądu osobnym przełącznikiem — używany PO zaprogramowaniu,
  jako monitor pracy procesu, nie podczas konfiguracji
- Cykliczne odpytywanie (polling) wybranych rejestrów dla wszystkich skonfigurowanych
  falowników w pętli — częstotliwość odświeżania do ustalenia (Modbus przez BLE ma
  ograniczoną przepustowość, przy 5 falownikach × kilka rejestrów każdy trzeba uważać
  na czas pełnego cyklu)
- Układ dostosowany do landscape na telefonie/tablecie (czytelna tabela/siatka, nie
  pojedyncza kolumna jak w obecnym widoku pionowym)

Do ustalenia przed implementacją: źródło rejestrów "prąd/napięcie/prąd analogowy" (czy
z Monitoring area 0h0300+, czy z konkretnych PAR-owych parametrów już w katalogu),
dokładna lista falowników do podglądu (wszystkie skonfigurowane, czy wybór), oraz
wspomniany współczynnik Hz→m/min.
