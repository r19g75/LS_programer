// Web Bluetooth klient dla G100 gateway (sekcja 3 spec).
// Fragmentacja lustrzana do firmware/src/ble_gateway.cpp:
// pakiet = [msgSeq:1B][totalLen:2B LE][offset:2B LE][chunk...]
//
// UWAGA: Web Bluetooth (Chrome) NIE udostępnia JS-owi negocjowanego MTU —
// to jedno z ryzyk z sekcji 3/8 spec ("nieprzetestowane na docelowym sprzęcie").
// Rozmiar chunku jest więc konserwatywną stałą, podkręcaną ręcznie w Debug Panelu
// jeśli na konkretnym telefonie/ESP32 uda się bezpiecznie zwiększyć.

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const CHAR_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // phone -> ESP32
const CHAR_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // ESP32 -> phone (notify)
const FRAGMENT_HEADER_LEN = 5;
const DEFAULT_CHUNK_SIZE = 100; // bajtów payloadu na fragment — patrz uwaga wyżej

class BleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.rxChar = null;
    this.txChar = null;
    this.connected = false;
    this.chunkSize = DEFAULT_CHUNK_SIZE;
    this.txMsgSeq = 0;

    this._rxState = null; // reassemblacja odpowiedzi z ESP32
    this._pending = new Map(); // seq (protokołu JSON) -> {resolve, reject, timer}
    this.onDisconnected = null;
  }

  isSupported() {
    return !!navigator.bluetooth;
  }

  async connect() {
    if (!this.isSupported()) throw new Error('Web Bluetooth niedostępny w tej przeglądarce');

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._handleDisconnect());

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.rxChar = await service.getCharacteristic(CHAR_RX_UUID);
    this.txChar = await service.getCharacteristic(CHAR_TX_UUID);

    await this.txChar.startNotifications();
    this.txChar.addEventListener('characteristicvaluechanged', (ev) => this._handleNotify(ev));

    this.connected = true;
    return true;
  }

  async disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this._handleDisconnect();
  }

  _handleDisconnect() {
    this.connected = false;
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Rozłączono BLE'));
    }
    this._pending.clear();
    if (this.onDisconnected) this.onDisconnected();
  }

  _handleNotify(event) {
    const data = new Uint8Array(event.target.value.buffer);
    if (data.length < FRAGMENT_HEADER_LEN) return;

    const msgSeq = data[0];
    const totalLen = data[1] | (data[2] << 8);
    const offset = data[3] | (data[4] << 8);
    const chunk = data.slice(FRAGMENT_HEADER_LEN);

    if (offset === 0) {
      this._rxState = { msgSeq, totalLen, received: 0, buffer: new Uint8Array(totalLen) };
    }
    if (!this._rxState || this._rxState.msgSeq !== msgSeq || this._rxState.received !== offset) {
      this._rxState = null; // fragment spoza sekwencji — porzuć wiadomość
      return;
    }

    this._rxState.buffer.set(chunk, offset);
    this._rxState.received += chunk.length;

    if (this._rxState.received === totalLen) {
      const text = new TextDecoder().decode(this._rxState.buffer);
      this._rxState = null;
      this._deliverResponse(text);
    }
  }

  _deliverResponse(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      console.error('Nieprawidłowy JSON od ESP32:', text);
      return;
    }
    const pending = this._pending.get(msg.seq);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pending.delete(msg.seq);
    pending.resolve(msg);
  }

  async _sendFragmented(bytes) {
    const totalLen = bytes.length;
    const msgSeq = this.txMsgSeq++ & 0xff;
    let offset = 0;
    while (offset < totalLen || totalLen === 0) {
      const chunk = bytes.slice(offset, offset + this.chunkSize);
      const packet = new Uint8Array(FRAGMENT_HEADER_LEN + chunk.length);
      packet[0] = msgSeq;
      packet[1] = totalLen & 0xff;
      packet[2] = (totalLen >> 8) & 0xff;
      packet[3] = offset & 0xff;
      packet[4] = (offset >> 8) & 0xff;
      packet.set(chunk, FRAGMENT_HEADER_LEN);

      await this.rxChar.writeValueWithoutResponse(packet);

      offset += chunk.length;
      if (totalLen === 0) break;
    }
  }

  // Wysyła request JSON, zwraca Promise rozwiązywany odpowiedzią o pasującym seq.
  sendRequest(requestObj, timeoutMs = 3000) {
    if (!this.connected) return Promise.reject(new Error('BLE niepołączone'));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestObj.seq);
        reject(new Error('Timeout odpowiedzi z ESP32'));
      }, timeoutMs);

      this._pending.set(requestObj.seq, { resolve, reject, timer });

      const json = JSON.stringify(requestObj);
      const bytes = new TextEncoder().encode(json);
      this._sendFragmented(bytes).catch((err) => {
        clearTimeout(timer);
        this._pending.delete(requestObj.seq);
        reject(err);
      });
    });
  }
}

const bleClient = new BleClient();
