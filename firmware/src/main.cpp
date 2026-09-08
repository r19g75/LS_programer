#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoOTA.h>
#include "../include/config.h"
#include "modbus_rtu.h"
#include "ble_gateway.h"
#include "protocol.h"

// G100 Programator — ESP32 gateway BLE GATT <-> Modbus RTU.
// ESP32 jest bezstanowym gatewayem (sekcja 6.3 spec): nie przechowuje
// konfiguracji falowników ani katalogu parametrów — tylko wykonuje
// pojedyncze transakcje Modbus na żądanie z PWA.

ModbusRtu modbus;
BleGateway ble;
ProtocolHandler *protocol = nullptr;

bool otaStarted = false; // ArduinoOTA.begin() wywoływane leniwie, dopiero po faktycznym połączeniu WiFi

void onBleMessage(const String &requestJson) {
    String response = protocol->handleRequest(requestJson);
    ble.sendResponse(response);
}

// WiFi/OTA są best-effort i asynchroniczne — brak sieci (albo jej zanik) NIE
// blokuje ani nie spowalnia BLE/Modbus, które działają całkowicie niezależnie.
void wifiOtaTick() {
    if (strlen(WIFI_SSID) == 0) return; // WiFi nieskonfigurowane (brak wifi_secrets.h) — nic do zrobienia

    if (!otaStarted && WiFi.status() == WL_CONNECTED) {
        ArduinoOTA.setHostname(OTA_HOSTNAME);
        if (strlen(OTA_PASSWORD) > 0) ArduinoOTA.setPassword(OTA_PASSWORD);
        ArduinoOTA.begin();
        otaStarted = true;
    }
    if (otaStarted) ArduinoOTA.handle();
}

void setup() {
    // UWAGA: RS-485 (MAX485 na nakładce) jest fizycznie podpięty do UART0
    // (GPIO1 TX0 / GPIO3 RX0) — tych samych pinów co USB/programator/monitor.
    // Przełącznik na nakładce wybiera, do czego są aktualnie podłączone.
    // Dlatego Serial NIE jest tu używany do logów debug — te same bajty
    // poszłyby na szynę RS-485 i zepsuły ramki Modbus. Modbus przejmuje
    // Serial na wyłączność od razu przy starcie.
    delay(200);

    modbus.begin(Serial, PIN_RS485_DE_RE, MODBUS_DEFAULT_BAUD, MODBUS_SERIAL_CONFIG);
    protocol = new ProtocolHandler(modbus);

    ble.setOnMessage(onBleMessage);
    ble.begin();

    // WiFi (opcjonalne, tylko do OTA — patrz config.h/wifi_secrets.h.example).
    // WiFi.begin() NIE blokuje — łączenie w tle, ArduinoOTA.begin() startuje
    // dopiero gdy faktycznie połączy (wifiOtaTick() w loop()). Jeśli WIFI_SSID
    // jest puste (brak wifi_secrets.h), nic się tu nie dzieje.
    if (strlen(WIFI_SSID) > 0) {
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
}

void loop() {
    // Cała logika Modbus/BLE jest event-driven (callbacki) — loop() tylko
    // dogląda WiFi/OTA, co jest tanie (kilka sprawdzeń stanu) gdy nic się nie dzieje.
    wifiOtaTick();
    delay(10);
}
