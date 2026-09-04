#include "ble_gateway.h"
#include "../include/config.h"

namespace {
BleGateway *g_instance = nullptr;

class ServerCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer *pServer, ble_gap_conn_desc *desc) override {
        if (g_instance) g_instance->_handleConnect(desc->conn_handle);
    }
    void onDisconnect(NimBLEServer *pServer) override {
        if (g_instance) g_instance->_handleDisconnect();
        NimBLEDevice::startAdvertising(); // wznów advertising po rozłączeniu
    }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic *pCharacteristic) override {
        if (!g_instance) return;
        std::string v = pCharacteristic->getValue();
        g_instance->_handleRxFragment(reinterpret_cast<const uint8_t *>(v.data()), v.size());
    }
};
} // namespace

void BleGateway::begin() {
    g_instance = this;

    NimBLEDevice::init(BLE_DEVICE_NAME);
    NimBLEDevice::setMTU(247); // żądany MTU; rzeczywisty negocjowany może być niższy (sekcja 3 spec)

    _server = NimBLEDevice::createServer();
    _server->setCallbacks(new ServerCallbacks());

    NimBLEService *service = _server->createService(BLE_SERVICE_UUID);

    _rxChar = service->createCharacteristic(
        BLE_CHAR_RX_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    _rxChar->setCallbacks(new RxCallbacks());

    _txChar = service->createCharacteristic(
        BLE_CHAR_TX_UUID,
        NIMBLE_PROPERTY::NOTIFY);

    service->start();

    NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(BLE_SERVICE_UUID);
    advertising->setScanResponse(true);
    NimBLEDevice::startAdvertising();
}

void BleGateway::_handleConnect(uint16_t connHandle) {
    _connected = true;
    _connHandle = connHandle;
    _rxInProgress = false;
}

void BleGateway::_handleDisconnect() {
    _connected = false;
    _rxInProgress = false;
}

uint16_t BleGateway::currentChunkSize() const {
    uint16_t peerMtu = (_server && _connected) ? _server->getPeerMTU(_connHandle) : 0;

    if (peerMtu > 0) {
        // MTU negocjowany — trzeba jeszcze odjąć narzut ATT notify (3B).
        if (peerMtu <= 3 + BLE_FRAGMENT_HEADER_LEN) return 1; // skrajny fallback, nie powinno wystąpić
        return peerMtu - 3 - BLE_FRAGMENT_HEADER_LEN;
    }

    // Brak negocjacji — BLE_FRAGMENT_FALLBACK_MTU to już użyteczny payload
    // (niewynegocjowane MTU=23 minus narzut ATT=3), więc odejmujemy tylko nagłówek.
    if (BLE_FRAGMENT_FALLBACK_MTU <= BLE_FRAGMENT_HEADER_LEN) return 1;
    return BLE_FRAGMENT_FALLBACK_MTU - BLE_FRAGMENT_HEADER_LEN;
}

void BleGateway::_handleRxFragment(const uint8_t *data, size_t len) {
    if (len < BLE_FRAGMENT_HEADER_LEN) return; // uszkodzony/za krótki fragment, ignoruj

    uint8_t msgSeq = data[0];
    uint16_t totalLen = data[1] | (data[2] << 8);
    uint16_t offset = data[3] | (data[4] << 8);
    const uint8_t *chunk = data + BLE_FRAGMENT_HEADER_LEN;
    size_t chunkLen = len - BLE_FRAGMENT_HEADER_LEN;

    if (totalLen > BLE_MAX_MESSAGE_LEN) return; // odrzuć nierealistyczne żądanie

    if (offset == 0) {
        // Nowa wiadomość — resetuj stan, nawet jeśli poprzednia była niedokończona.
        _rxMsgSeq = msgSeq;
        _rxInProgress = true;
        _rxTotalLen = totalLen;
        _rxReceivedLen = 0;
        _rxBuffer.assign(totalLen, 0);
    }

    if (!_rxInProgress || msgSeq != _rxMsgSeq || offset != _rxReceivedLen) {
        // Fragment nie pasuje do trwającej reassemblacji (spóźniony/zgubiony pakiet) — porzuć wiadomość.
        _rxInProgress = false;
        return;
    }

    if (offset + chunkLen > _rxTotalLen) {
        _rxInProgress = false; // niespójna długość, porzuć
        return;
    }

    memcpy(_rxBuffer.data() + offset, chunk, chunkLen);
    _rxReceivedLen += chunkLen;

    if (_rxReceivedLen == _rxTotalLen) {
        _rxInProgress = false;
        String json;
        json.reserve(_rxTotalLen + 1);
        for (uint16_t i = 0; i < _rxTotalLen; i++) json += (char)_rxBuffer[i];
        if (_onMessage) _onMessage(json);
    }
}

void BleGateway::sendResponse(const String &json) {
    if (!_connected || !_txChar) return;

    uint16_t totalLen = json.length();
    uint16_t chunkSize = currentChunkSize();
    uint8_t msgSeq = _txMsgSeq++;

    uint8_t packet[BLE_FRAGMENT_HEADER_LEN + 512];
    uint16_t offset = 0;
    while (offset < totalLen) {
        uint16_t n = min((uint16_t)(totalLen - offset), chunkSize);
        if (n > sizeof(packet) - BLE_FRAGMENT_HEADER_LEN) n = sizeof(packet) - BLE_FRAGMENT_HEADER_LEN;

        packet[0] = msgSeq;
        packet[1] = totalLen & 0xFF;
        packet[2] = (totalLen >> 8) & 0xFF;
        packet[3] = offset & 0xFF;
        packet[4] = (offset >> 8) & 0xFF;
        memcpy(packet + BLE_FRAGMENT_HEADER_LEN, json.c_str() + offset, n);

        _txChar->setValue(packet, BLE_FRAGMENT_HEADER_LEN + n);
        _txChar->notify();

        offset += n;
    }

    if (totalLen == 0) {
        // Pusta odpowiedź (nie powinna się zdarzyć) — wyślij samą ramkę nagłówkową.
        packet[0] = msgSeq;
        packet[1] = 0; packet[2] = 0;
        packet[3] = 0; packet[4] = 0;
        _txChar->setValue(packet, BLE_FRAGMENT_HEADER_LEN);
        _txChar->notify();
    }
}
