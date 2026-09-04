#pragma once
#include <Arduino.h>

// Minimalny Modbus RTU master dla G100 — tylko FC03/FC04/FC06/FC16.
// Napisany ręcznie (bez zewnętrznej biblioteki), żeby mieć pełną kontrolę
// nad surowym adresem PDU (patrz sekcja 4.3 spec — adresowanie NIEROZSTRZYGNIĘTE,
// PWA decyduje o offsetach, firmware tylko wykonuje transakcję na podanym adresie).

enum class ModbusStatus : uint8_t {
    OK = 0,
    ERR_TIMEOUT,
    ERR_CRC,
    ERR_EXCEPTION,      // falownik odpowiedział kodem wyjątku Modbus
    ERR_BAD_RESPONSE,   // odpowiedź niespójna z żądaniem (zła funkcja/slave/długość)
    ERR_TOO_LONG,       // qty przekracza bufor
};

struct ModbusResult {
    ModbusStatus status;
    uint8_t exceptionCode;      // ważne tylko gdy status == ERR_EXCEPTION
    uint16_t values[125];       // max rejestrów w jednej odpowiedzi FC03/04 (Modbus spec)
    uint8_t valueCount;
};

class ModbusRtu {
public:
    void begin(HardwareSerial &serial, int dePin, uint32_t baud, uint32_t config);

    // FC03/FC04 — odczyt rejestrów (holding/input)
    ModbusResult readRegisters(uint8_t slave, uint8_t functionCode, uint16_t pduAddress, uint16_t qty);

    // FC06 — zapis pojedynczego rejestru
    ModbusResult writeSingleRegister(uint8_t slave, uint16_t pduAddress, uint16_t value);

    // FC16 — zapis wielu rejestrów
    ModbusResult writeMultipleRegisters(uint8_t slave, uint16_t pduAddress, const uint16_t *values, uint8_t qty);

private:
    HardwareSerial *_serial = nullptr;
    int _dePin = -1;

    void setDriverEnable(bool enable);
    uint16_t crc16(const uint8_t *buf, size_t len);
    void sendFrame(uint8_t *frame, size_t len);
    // Czyta ramkę odpowiedzi do bufora, zwraca liczbę odebranych bajtów (0 = timeout)
    size_t receiveFrame(uint8_t *buf, size_t maxLen, uint32_t timeoutMs);
};
