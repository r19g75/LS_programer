#pragma once

// Piny RS-485 (MAX485) — dostosować do realnego okablowania płytki.
// DE i RE MAX485 spięte razem na jeden GPIO (typowe dla half-duplex modułów).
#define PIN_RS485_DE_RE   4
#define PIN_RS485_RX      16   // ESP32 Serial2 RX2 (do TX modułu MAX485)
#define PIN_RS485_TX      17   // ESP32 Serial2 TX2 (do RX modułu MAX485)

// Domyślne parametry portu falownika (sekcja 4.1 spec, do zmiany per instalacja)
#define MODBUS_DEFAULT_BAUD    9600
#define MODBUS_SERIAL_CONFIG   SERIAL_8N1

// Modbus timing (sekcja 4.2 spec)
#define MODBUS_RESPONSE_TIMEOUT_MS   200
#define MODBUS_T35_GAP_US            4000   // odstęp międzyramkowy T3.5 @9600bps

// BLE — UUID-y serwisu gateway. To standardowe UUID-y Nordic UART Service (NUS),
// NIE losowe — użyte celowo, bo część generycznych aplikacji-terminali BLE
// rozpoznaje je automatycznie jako UART (RX/TX), co ułatwia debugowanie surowego
// strumienia bez własnej apki. Protokół ramek (patrz ble_gateway.h) jest mimo to
// własny, więc taka apka pokaże tylko surowe bajty, nie sparsuje JSON-a.
#define BLE_DEVICE_NAME        "G100-Gateway"
#define BLE_SERVICE_UUID        "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_CHAR_RX_UUID         "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // phone -> ESP32 (write / write-no-response)
#define BLE_CHAR_TX_UUID         "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // ESP32 -> phone (notify)

// Fragmentacja BLE — patrz sekcja 3 spec ("MTU negocjowany, konieczność fragmentacji")
#define BLE_FRAGMENT_FALLBACK_MTU   20     // gdy negocjacja MTU nie powiedzie się / peer nie wspiera
#define BLE_FRAGMENT_HEADER_LEN     5      // seq(1) + total_len(2) + offset(2)
#define BLE_MAX_MESSAGE_LEN         4096   // bezpieczny górny limit pojedynczego JSON-a request/response

// OTA — poza MVP. Miejsce zarezerwowane w architekturze na przyszły kanał
// aktualizacji (BLE DFU lub WiFi tylko do celów update, patrz sekcja 6.2 spec).
// Celowo NIE zaimplementowane w tym etapie.
