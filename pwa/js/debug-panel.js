// Panel Debug "Raw Modbus" — narzędzie do wykonania Testów 1-4 z sekcji 4.3 spec
// (rozstrzygnięcie konwencji adresowania PDU) bezpośrednio na sprzęcie, bez
// osobnego testera. Widoczny tylko gdy włączony tryb Debug w Konfiguracji.

const DebugPanel = (() => {
  function log(container, line) {
    const time = new Date().toLocaleTimeString();
    container.textContent = `[${time}] ${line}\n` + container.textContent;
  }

  function init(root) {
    root.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'debug-form';

    const slaveInput = document.createElement('label');
    slaveInput.innerHTML = 'Slave (1-250)<input type="number" id="dbgSlave" min="1" max="250" value="1" />';

    const fcSelect = document.createElement('label');
    fcSelect.innerHTML = `Function Code
      <select id="dbgFc">
        <option value="3">FC03 - Read Holding</option>
        <option value="4">FC04 - Read Input</option>
        <option value="6">FC06 - Write Single</option>
        <option value="16">FC16 - Write Multiple</option>
      </select>`;

    const addrInput = document.createElement('label');
    addrInput.innerHTML = 'Adres PDU (hex, np. 0h1200)<input type="text" id="dbgAddr" value="0h1200" />';

    const qtyValuesInput = document.createElement('label');
    qtyValuesInput.innerHTML = 'Qty (read) / Values CSV (write)<input type="text" id="dbgQtyValues" value="1" />';

    form.appendChild(slaveInput);
    form.appendChild(fcSelect);
    form.appendChild(addrInput);
    form.appendChild(qtyValuesInput);
    root.appendChild(form);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn btn-primary';
    sendBtn.textContent = 'Wyślij';
    root.appendChild(sendBtn);

    const logEl = document.createElement('div');
    logEl.id = 'debugResultLog';
    logEl.style.marginTop = '10px';
    root.appendChild(logEl);

    sendBtn.addEventListener('click', async () => {
      if (!bleClient.connected) {
        log(logEl, 'BŁĄD: brak połączenia BLE. Użyj CONNECT w górnym pasku.');
        return;
      }
      const slave = parseInt(document.getElementById('dbgSlave').value, 10);
      const fc = parseInt(document.getElementById('dbgFc').value, 10);
      const addr = document.getElementById('dbgAddr').value.trim();
      const qtyValuesRaw = document.getElementById('dbgQtyValues').value.trim();

      try {
        if (fc === 3 || fc === 4) {
          const qty = parseInt(qtyValuesRaw, 10) || 1;
          log(logEl, `-> READ fc=${fc} slave=${slave} addr=${addr} qty=${qty}`);
          const resp = await ModbusClient.readRawRegister(slave, fc, addr, qty);
          log(logEl, resp.ok ? `<- OK values=[${resp.values.join(', ')}]` : `<- BŁĄD: ${resp.error}${resp.exception_code != null ? ' (exc ' + resp.exception_code + ')' : ''}`);
        } else {
          const values = qtyValuesRaw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
          log(logEl, `-> WRITE fc=${fc} slave=${slave} addr=${addr} values=[${values.join(', ')}]`);
          const resp = await ModbusClient.writeRawRegister(slave, fc, addr, values);
          log(logEl, resp.ok ? '<- OK' : `<- BŁĄD: ${resp.error}${resp.exception_code != null ? ' (exc ' + resp.exception_code + ')' : ''}`);
        }
      } catch (e) {
        log(logEl, 'WYJĄTEK: ' + e.message);
      }
    });
  }

  return { init };
})();
