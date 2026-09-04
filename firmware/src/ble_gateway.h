#pragma once
#include <Arduino.h>
#include <functional>
#include <vector>
#include <NimBLEDevice.h>

// Serwer BLE GATT — 1 serwis, RX (write z telefonu) + TX (notify do telefonu).
// Fragmentacja wiadomości JSON większych niż MTU (sekcja 3 spec):
// każdy pakiet BLE = [msgSeq:1B][totalLen:2B LE][offset:2B LE][chunk...]

class BleGateway {
public:
    using MessageHandler = std::function<void(const String &json)>;

    void begin();
    void setOnMessage(MessageHandler handler) { _onMessage = handler; }

    // Fragmentuje i wysyła kompletną wiadomość JSON przez notify na TX.
    void sendResponse(const String &json);

    bool isConnected() const { return _connected; }

    // Wywoływane wewnętrznie przez callbacki NimBLE — publiczne z konieczności API.
    void _handleConnect(uint16_t connHandle);
    void _handleDisconnect();
    void _handleRxFragment(const uint8_t *data, size_t len);

private:
    NimBLEServer *_server = nullptr;
    NimBLECharacteristic *_txChar = nullptr;
    NimBLECharacteristic *_rxChar = nullptr;
    MessageHandler _onMessage;

    bool _connected = false;
    uint16_t _connHandle = 0;

    // Stan reassemblacji RX
    uint8_t _rxMsgSeq = 0;
    bool _rxInProgress = false;
    uint16_t _rxTotalLen = 0;
    uint16_t _rxReceivedLen = 0;
    std::vector<uint8_t> _rxBuffer;

    uint8_t _txMsgSeq = 0;

    uint16_t currentChunkSize() const;
};
