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
