#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <ArduinoJson.h>
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

// OTA WiFi AP jest domyślnie WYŁĄCZONY (patrz config.h) — nie startuje przy
// boocie, tylko na żądanie z telefonu (komenda BLE "ota_enable"), i gaśnie
// sam po OTA_WINDOW_MS bez aktywnego transferu. To minimalizuje czas, przez
// jaki ESP32 w ogóle ma otwartą sieć WiFi (powierzchnia ataku/obciążenie
// radia) — normalna praca (BLE + Modbus) w ogóle jej nie potrzebuje.
bool otaActive = false;
bool otaInProgress = false; // true w trakcie faktycznego transferu firmware — nigdy nie gasić WiFi w tym czasie
uint32_t otaActiveUntilMs = 0;

void startOtaWindow() {
    if (!otaActive) {
        WiFi.mode(WIFI_AP);
        WiFi.softAP(OTA_AP_SSID, OTA_AP_PASSWORD);
        ArduinoOTA.setHostname(OTA_HOSTNAME);
        if (strlen(OTA_PASSWORD) > 0) ArduinoOTA.setPassword(OTA_PASSWORD);
        ArduinoOTA.onStart([]() { otaInProgress = true; });
        ArduinoOTA.onEnd([]() { otaInProgress = false; });
        ArduinoOTA.onError([](ota_error_t) { otaInProgress = false; });
        ArduinoOTA.begin();
        otaActive = true;
    }
    otaActiveUntilMs = millis() + OTA_WINDOW_MS;
}

void stopOtaWindow() {
    if (!otaActive || otaInProgress) return; // nigdy nie gasić WiFi w trakcie faktycznego zapisu firmware
    ArduinoOTA.end();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    otaActive = false;
}

void onBleMessage(const String &requestJson) {
    // "ota_enable"/"ota_disable" to komendy poza zwykłym Modbus (nie mają
    // slave/addr/fc) — obsłużone tutaj, nie w protocol.cpp, żeby nie mieszać
    // WiFi do logiki czysto-Modbusowej. Reszta requestów idzie do protocol
    // jak dotychczas, bez zmian.
    JsonDocument doc;
    if (deserializeJson(doc, requestJson) == DeserializationError::Ok) {
        const char *op = doc["op"] | "";
        long seq = doc["seq"] | -1;
        if (strcmp(op, "ota_enable") == 0 || strcmp(op, "ota_disable") == 0) {
            JsonDocument resp;
            resp["seq"] = seq;
            resp["ok"] = true;
            if (strcmp(op, "ota_enable") == 0) {
                startOtaWindow();
                resp["ap_ssid"] = OTA_AP_SSID;
                resp["window_s"] = OTA_WINDOW_MS / 1000;
            } else {
                stopOtaWindow();
                resp["ota_active"] = otaActive; // false chyba ze transfer wlasnie trwa (patrz stopOtaWindow)
            }
            String out;
            serializeJson(resp, out);
            ble.sendResponse(out);
            return;
        }
    }
    String response = protocol->handleRequest(requestJson);
    ble.sendResponse(response);
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

    // WiFi/OTA celowo NIE startuje tutaj — patrz startOtaWindow()/komentarz
    // przy otaActive wyżej. Domyślny stan po boocie: WiFi całkowicie wyłączone.
}

void loop() {
    // Cała logika Modbus/BLE jest event-driven (callbacki) — loop() tylko
    // dogląda OTA, gdy jest aktywne (poza tym nic nie robi, WiFi wyłączone).
    if (otaActive) {
        ArduinoOTA.handle();
        if (!otaInProgress && (int32_t)(millis() - otaActiveUntilMs) > 0) {
            stopOtaWindow();
        }
    }
    delay(10);
}
