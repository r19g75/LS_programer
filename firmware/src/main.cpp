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

    // OTA: poza MVP, celowo nie zaimplementowane — patrz include/config.h i sekcja 6.2 spec.
}

void loop() {
    // Cała logika event-driven (callbacki BLE) — loop() celowo pusty.
    delay(10);
}
