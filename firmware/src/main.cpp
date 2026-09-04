#include <Arduino.h>
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

void onBleMessage(const String &requestJson) {
    String response = protocol->handleRequest(requestJson);
    ble.sendResponse(response);
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("G100 Programator gateway starting...");

    modbus.begin(Serial2, PIN_RS485_DE_RE, MODBUS_DEFAULT_BAUD, MODBUS_SERIAL_CONFIG);
    protocol = new ProtocolHandler(modbus);

    ble.setOnMessage(onBleMessage);
    ble.begin();

    Serial.println("BLE advertising jako " BLE_DEVICE_NAME);

    // OTA: poza MVP, celowo nie zaimplementowane — patrz include/config.h i sekcja 6.2 spec.
}

void loop() {
    // Cała logika event-driven (callbacki BLE) — loop() celowo pusty.
    delay(10);
}
