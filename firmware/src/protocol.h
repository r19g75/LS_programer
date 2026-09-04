#pragma once
#include <Arduino.h>
#include "modbus_rtu.h"

// Warstwa JSON request/response (sekcja 3 spec).
// PWA wysyła już wyliczony adres PDU (na podstawie katalogu) — ESP32 nie zna
// katalogu parametrów i nie liczy offsetów, tylko wykonuje transakcję Modbus.
//
// Request:  {"seq":N,"op":"read"|"write","slave":1-250,"fc":3|4|6|16,"addr":"0hXXXX","qty":N,"values":[...]}
// Response: {"seq":N,"ok":true,"values":[...]}
//        or {"seq":N,"ok":false,"error":"..."}

class ProtocolHandler {
public:
    ProtocolHandler(ModbusRtu &modbus) : _modbus(modbus) {}
    String handleRequest(const String &requestJson);

private:
    ModbusRtu &_modbus;
};
