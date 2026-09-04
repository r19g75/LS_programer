#include "protocol.h"
#include <ArduinoJson.h>

namespace {
uint16_t parseHexAddr(const char *s) {
    if (!s) return 0;
    if ((s[0] == '0') && (s[1] == 'h' || s[1] == 'H')) s += 2;
    return (uint16_t)strtoul(s, nullptr, 16);
}

const char *statusToError(ModbusStatus status) {
    switch (status) {
        case ModbusStatus::ERR_TIMEOUT: return "timeout";
        case ModbusStatus::ERR_CRC: return "crc_error";
        case ModbusStatus::ERR_EXCEPTION: return "modbus_exception";
        case ModbusStatus::ERR_BAD_RESPONSE: return "bad_response";
        case ModbusStatus::ERR_TOO_LONG: return "qty_out_of_range";
        default: return "unknown_error";
    }
}

String errorResponse(long seq, const char *error) {
    JsonDocument doc;
    doc["seq"] = seq;
    doc["ok"] = false;
    doc["error"] = error;
    String out;
    serializeJson(doc, out);
    return out;
}
} // namespace

String ProtocolHandler::handleRequest(const String &requestJson) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, requestJson);
    if (err) {
        return errorResponse(-1, "invalid_json");
    }

    long seq = doc["seq"] | -1;
    const char *op = doc["op"] | "";
    int slave = doc["slave"] | -1;
    int fc = doc["fc"] | -1;
    const char *addrStr = doc["addr"] | nullptr;

    if (slave < 1 || slave > 250) return errorResponse(seq, "invalid_slave");
    if (!addrStr) return errorResponse(seq, "missing_addr");
    uint16_t pduAddr = parseHexAddr(addrStr);

    if (strcmp(op, "read") == 0) {
        if (fc != 3 && fc != 4) return errorResponse(seq, "invalid_fc_for_read");
        int qty = doc["qty"] | 1;
        if (qty < 1 || qty > 125) return errorResponse(seq, "invalid_qty");

        ModbusResult res = _modbus.readRegisters((uint8_t)slave, (uint8_t)fc, pduAddr, (uint16_t)qty);
        if (res.status != ModbusStatus::OK) {
            if (res.status == ModbusStatus::ERR_EXCEPTION) {
                JsonDocument d;
                d["seq"] = seq;
                d["ok"] = false;
                d["error"] = "modbus_exception";
                d["exception_code"] = res.exceptionCode;
                String out;
                serializeJson(d, out);
                return out;
            }
            return errorResponse(seq, statusToError(res.status));
        }

        JsonDocument d;
        d["seq"] = seq;
        d["ok"] = true;
        JsonArray values = d["values"].to<JsonArray>();
        for (uint8_t i = 0; i < res.valueCount; i++) values.add(res.values[i]);
        String out;
        serializeJson(d, out);
        return out;

    } else if (strcmp(op, "write") == 0) {
        if (fc != 6 && fc != 16) return errorResponse(seq, "invalid_fc_for_write");
        JsonArray valuesArr = doc["values"];
        if (valuesArr.isNull() || valuesArr.size() == 0) return errorResponse(seq, "missing_values");

        ModbusResult res;
        if (fc == 6) {
            uint16_t value = valuesArr[0].as<uint16_t>();
            res = _modbus.writeSingleRegister((uint8_t)slave, pduAddr, value);
        } else {
            uint8_t qty = (uint8_t)valuesArr.size();
            if (qty > 123) return errorResponse(seq, "invalid_qty");
            uint16_t values[123];
            for (uint8_t i = 0; i < qty; i++) values[i] = valuesArr[i].as<uint16_t>();
            res = _modbus.writeMultipleRegisters((uint8_t)slave, pduAddr, values, qty);
        }

        if (res.status != ModbusStatus::OK) {
            if (res.status == ModbusStatus::ERR_EXCEPTION) {
                JsonDocument d;
                d["seq"] = seq;
                d["ok"] = false;
                d["error"] = "modbus_exception";
                d["exception_code"] = res.exceptionCode;
                String out;
                serializeJson(d, out);
                return out;
            }
            return errorResponse(seq, statusToError(res.status));
        }

        JsonDocument d;
        d["seq"] = seq;
        d["ok"] = true;
        String out;
        serializeJson(d, out);
        return out;
    }

    return errorResponse(seq, "unknown_op");
}
