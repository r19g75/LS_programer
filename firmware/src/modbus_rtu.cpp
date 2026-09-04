#include "modbus_rtu.h"
#include "../include/config.h"

void ModbusRtu::begin(HardwareSerial &serial, int dePin, uint32_t baud, uint32_t config) {
    _serial = &serial;
    _dePin = dePin;
    pinMode(_dePin, OUTPUT);
    setDriverEnable(false); // start w trybie odbioru
    _serial->begin(baud, config, PIN_RS485_RX, PIN_RS485_TX);
}

void ModbusRtu::setDriverEnable(bool enable) {
    digitalWrite(_dePin, enable ? HIGH : LOW);
}

// CRC16 Modbus (poly 0xA001, init 0xFFFF) — standardowy algorytm z dokumentacji Modbus.
uint16_t ModbusRtu::crc16(const uint8_t *buf, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= buf[i];
        for (int b = 0; b < 8; b++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc;
}

void ModbusRtu::sendFrame(uint8_t *frame, size_t len) {
    uint16_t crc = crc16(frame, len);
    frame[len] = crc & 0xFF;
    frame[len + 1] = (crc >> 8) & 0xFF;

    while (_serial->available()) _serial->read(); // wyczyść ewentualne śmieci przed transakcją

    setDriverEnable(true);
    delayMicroseconds(MODBUS_T35_GAP_US); // T3.5 przed ramką
    _serial->write(frame, len + 2);
    _serial->flush(); // czekaj aż fizycznie wyjdzie z UART przed przełączeniem na odbiór
    setDriverEnable(false);
}

size_t ModbusRtu::receiveFrame(uint8_t *buf, size_t maxLen, uint32_t timeoutMs) {
    size_t count = 0;
    uint32_t startWait = millis();

    // Czekaj na pierwszy bajt do timeoutMs
    while (!_serial->available()) {
        if (millis() - startWait > timeoutMs) return 0;
    }

    // Zbieraj bajty dopóki nie ma przerwy międzyramkowej (T3.5, tu z zapasem)
    // lub nie zapełni się bufor.
    uint32_t lastByteMs = millis();
    while (count < maxLen) {
        if (_serial->available()) {
            buf[count++] = _serial->read();
            lastByteMs = millis();
        } else if (millis() - lastByteMs > 10) {
            break; // cisza > 10ms = koniec ramki przy 9600bps
        }
    }
    return count;
}

ModbusResult ModbusRtu::readRegisters(uint8_t slave, uint8_t functionCode, uint16_t pduAddress, uint16_t qty) {
    ModbusResult result{};
    result.status = ModbusStatus::ERR_TIMEOUT;
    result.valueCount = 0;

    if (qty == 0 || qty > 125) {
        result.status = ModbusStatus::ERR_TOO_LONG;
        return result;
    }

    uint8_t frame[8];
    frame[0] = slave;
    frame[1] = functionCode; // 3 lub 4
    frame[2] = (pduAddress >> 8) & 0xFF;
    frame[3] = pduAddress & 0xFF;
    frame[4] = (qty >> 8) & 0xFF;
    frame[5] = qty & 0xFF;
    sendFrame(frame, 6);

    uint8_t resp[5 + 250];
    size_t n = receiveFrame(resp, sizeof(resp), MODBUS_RESPONSE_TIMEOUT_MS);
    if (n == 0) {
        result.status = ModbusStatus::ERR_TIMEOUT;
        return result;
    }
    if (n < 5) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    uint16_t crc = crc16(resp, n - 2);
    uint16_t recvCrc = resp[n - 2] | (resp[n - 1] << 8);
    if (crc != recvCrc) {
        result.status = ModbusStatus::ERR_CRC;
        return result;
    }
    if (resp[0] != slave) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    if (resp[1] == (functionCode | 0x80)) {
        result.status = ModbusStatus::ERR_EXCEPTION;
        result.exceptionCode = resp[2];
        return result;
    }
    if (resp[1] != functionCode) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    uint8_t byteCount = resp[2];
    if (byteCount != qty * 2 || n != (size_t)(3 + byteCount + 2)) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    for (uint16_t i = 0; i < qty; i++) {
        result.values[i] = (resp[3 + i * 2] << 8) | resp[3 + i * 2 + 1];
    }
    result.valueCount = qty;
    result.status = ModbusStatus::OK;
    return result;
}

ModbusResult ModbusRtu::writeSingleRegister(uint8_t slave, uint16_t pduAddress, uint16_t value) {
    ModbusResult result{};
    result.valueCount = 0;

    uint8_t frame[8];
    frame[0] = slave;
    frame[1] = 0x06;
    frame[2] = (pduAddress >> 8) & 0xFF;
    frame[3] = pduAddress & 0xFF;
    frame[4] = (value >> 8) & 0xFF;
    frame[5] = value & 0xFF;
    sendFrame(frame, 6);

    uint8_t resp[8];
    size_t n = receiveFrame(resp, sizeof(resp), MODBUS_RESPONSE_TIMEOUT_MS);
    if (n == 0) {
        result.status = ModbusStatus::ERR_TIMEOUT;
        return result;
    }
    if (n < 5) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    uint16_t crc = crc16(resp, n - 2);
    uint16_t recvCrc = resp[n - 2] | (resp[n - 1] << 8);
    if (crc != recvCrc) {
        result.status = ModbusStatus::ERR_CRC;
        return result;
    }
    if (resp[0] != slave) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    if (resp[1] == (0x06 | 0x80)) {
        result.status = ModbusStatus::ERR_EXCEPTION;
        result.exceptionCode = resp[2];
        return result;
    }
    if (resp[1] != 0x06 || n != 8) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    // Echo: falownik odsyła zapisany adres+wartość — traktujemy jako potwierdzenie.
    result.values[0] = (resp[4] << 8) | resp[5];
    result.valueCount = 1;
    result.status = ModbusStatus::OK;
    return result;
}

ModbusResult ModbusRtu::writeMultipleRegisters(uint8_t slave, uint16_t pduAddress, const uint16_t *values, uint8_t qty) {
    ModbusResult result{};
    result.valueCount = 0;

    if (qty == 0 || qty > 123) {
        result.status = ModbusStatus::ERR_TOO_LONG;
        return result;
    }

    uint8_t byteCount = qty * 2;
    uint8_t frame[7 + 250];
    frame[0] = slave;
    frame[1] = 0x10;
    frame[2] = (pduAddress >> 8) & 0xFF;
    frame[3] = pduAddress & 0xFF;
    frame[4] = (qty >> 8) & 0xFF;
    frame[5] = qty & 0xFF;
    frame[6] = byteCount;
    for (uint8_t i = 0; i < qty; i++) {
        frame[7 + i * 2] = (values[i] >> 8) & 0xFF;
        frame[7 + i * 2 + 1] = values[i] & 0xFF;
    }
    size_t payloadLen = 7 + byteCount;
    sendFrame(frame, payloadLen);

    uint8_t resp[8];
    size_t n = receiveFrame(resp, sizeof(resp), MODBUS_RESPONSE_TIMEOUT_MS);
    if (n == 0) {
        result.status = ModbusStatus::ERR_TIMEOUT;
        return result;
    }
    if (n < 5) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    uint16_t crc = crc16(resp, n - 2);
    uint16_t recvCrc = resp[n - 2] | (resp[n - 1] << 8);
    if (crc != recvCrc) {
        result.status = ModbusStatus::ERR_CRC;
        return result;
    }
    if (resp[0] != slave) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    if (resp[1] == (0x10 | 0x80)) {
        result.status = ModbusStatus::ERR_EXCEPTION;
        result.exceptionCode = resp[2];
        return result;
    }
    if (resp[1] != 0x10 || n != 8) {
        result.status = ModbusStatus::ERR_BAD_RESPONSE;
        return result;
    }
    result.status = ModbusStatus::OK;
    return result;
}
