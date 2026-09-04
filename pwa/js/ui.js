// Renderowanie DOM. Funkcje "głupie" — biorą dane i handlery, nie trzymają stanu same.

const UI = (() => {
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  // --- Modal generyczny (używany m.in. do ostrzeżenia grupy CM) ---
  function showModal({ title, bodyHtml, confirmLabel = 'OK', cancelLabel = 'Anuluj', danger = false }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      const overlay = el('div', { class: 'modal-overlay' });
      const box = el('div', { class: 'modal-box' });
      box.innerHTML = `<h3>${escapeHtml(title)}</h3><div>${bodyHtml}</div>`;
      const actions = el('div', { class: 'modal-actions' });
      const cancelBtn = el('button', { class: 'btn', onclick: () => { cleanup(); resolve(false); } }, cancelLabel);
      const confirmBtn = el('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', onclick: () => { cleanup(); resolve(true); } }, confirmLabel);
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      box.appendChild(actions);
      overlay.appendChild(box);
      function cleanup() { root.removeChild(overlay); }
      root.appendChild(overlay);
    });
  }

  // --- Ekran B: zakładki falowników ---
  function renderInverterTabs(container, inverters, activeId, onSelect) {
    container.innerHTML = '';
    for (const inv of inverters) {
      const tab = el('div', {
        class: 'inverter-tab' + (inv.id === activeId ? ' active' : ''),
        onclick: () => onSelect(inv.id),
      }, `${inv.name} (#${inv.modbusAddress})`);
      container.appendChild(tab);
    }
  }

  function statusBadge(status) {
    if (!status) return '';
    if (status.pending) return '<span class="param-status">...</span>';
    if (status.error) return `<span class="param-status status-err">błąd: ${escapeHtml(status.error)}</span>`;
    if (status.verify) {
      return status.verify.match
        ? '<span class="param-status status-ok">✓ zweryfikowano</span>'
        : `<span class="param-status status-mismatch">✗ oczekiwano ${status.verify.expected}, jest ${status.verify.actual}</span>`;
    }
    if (status.written) return '<span class="param-status status-ok">✓ zapisano</span>';
    if (status.read) return '<span class="param-status">odczytano</span>';
    return '';
  }

  // --- Ekran B: panel parametrów aktywnego falownika ---
  function renderInverterPanel(container, { inverter, groupedEntries, sysFreqEntry, invState, connected, handlers }) {
    container.innerHTML = '';
    if (!inverter) {
      container.appendChild(el('p', { class: 'empty-hint' }, 'Brak skonfigurowanych falowników. Przejdź do zakładki „Konfiguracja”, aby dodać falownik.'));
      return;
    }

    const workflowBar = el('div', { class: 'workflow-bar' }, [
      el('button', { class: 'btn btn-primary', onclick: handlers.onConnect, disabled: connected }, connected ? 'POŁĄCZONO' : 'CONNECT'),
      el('button', { class: 'btn', onclick: handlers.onRead, disabled: !connected }, 'READ'),
      el('button', { class: 'btn btn-primary', onclick: handlers.onProgram, disabled: !connected }, 'PROGRAMOWANIE (zapisz zmiany)'),
    ]);
    container.appendChild(workflowBar);

    if (groupedEntries.length === 0) {
      container.appendChild(el('p', { class: 'empty-hint' }, 'Ten falownik nie ma jeszcze wybranych parametrów — dodaj je w zakładce „Konfiguracja”.'));
    }

    // SYS-FREQ — dedykowana akcja, nie checkbox (sekcja 4.5/4.6 spec)
    if (sysFreqEntry) {
      const box = el('div', { class: 'sysfreq-box' });
      box.innerHTML = `<h4>Trwały zapis częstotliwości (${sysFreqEntry.register})</h4>
        <p class="hint-text">Sekwencja: potwierdzenie źródła Keypad-1 → zapis częstotliwości → SAVE. Patrz sekcja 4.6 spec.</p>`;
      const row = el('div', { class: 'sysfreq-row' });
      const freqInput = el('input', { type: 'number', step: '0.01', placeholder: 'Hz', id: 'sysFreqValueInput' });
      const sourceConfirm = el('label', {}, [
        el('input', { type: 'checkbox', id: 'sysFreqSourceConfirm' }),
        document.createTextNode(' Potwierdzam, że źródło częstotliwości (Frq) jest ustawione na Keypad-1'),
      ]);
      const writeBtn = el('button', {
        class: 'btn btn-primary',
        disabled: !connected,
        onclick: () => handlers.onSysFreqWrite(parseFloat(freqInput.value), document.getElementById('sysFreqSourceConfirm').checked),
      }, 'Zapisz częstotliwość + SAVE');
      row.appendChild(freqInput);
      row.appendChild(writeBtn);
      box.appendChild(row);
      box.appendChild(sourceConfirm);
      const statusEl = el('div', { class: 'hint-text', id: 'sysFreqStatus' }, invState.sysFreqStatus || '');
      box.appendChild(statusEl);
      container.appendChild(box);
    }

    for (const grp of groupedEntries) {
      const risky = Catalog.isRiskyGroup(grp.group);
      const groupEl = el('div', { class: 'param-group' + (risky ? ' risky' : '') });
      groupEl.appendChild(el('div', { class: 'param-group-title' }, `${grp.group} — ${grp.groupName}${risky ? ' ⚠ ryzyko utraty połączenia przy zapisie' : ''}`));

      for (const entry of grp.entries) {
        const read = invState.lastRead[entry.code];
        const editedVal = invState.edited[entry.code];
        const currentVal = editedVal !== undefined ? editedVal : (read ? read.display : '');
        const isDirty = read && editedVal !== undefined && editedVal !== read.display;

        const row = el('div', { class: 'param-row' });
        row.appendChild(el('div', {}, [
          el('div', { class: 'param-name' }, entry.name_approx),
          el('div', { class: 'param-code' }, `${entry.code} · ${entry.register}`),
        ]));
        const input = el('input', {
          type: 'number',
          step: 'any',
          value: currentVal,
          class: isDirty ? 'dirty' : '',
          oninput: (e) => handlers.onFieldChange(entry.code, e.target.value),
        });
        row.appendChild(input);
        const statusWrap = el('div', {});
        statusWrap.innerHTML = statusBadge(invState.status[entry.code]);
        row.appendChild(statusWrap);
        groupEl.appendChild(row);
      }
      container.appendChild(groupEl);
    }
  }

  // --- Ekran A: lista falowników ---
  function renderInverterList(container, inverters, handlers) {
    container.innerHTML = '';
    if (inverters.length === 0) {
      container.appendChild(el('p', { class: 'empty-hint' }, 'Brak dodanych falowników.'));
      return;
    }
    for (const inv of inverters) {
      const item = el('div', { class: 'inverter-list-item' });
      item.appendChild(el('div', { class: 'grow' }, `${inv.name} — adres Modbus ${inv.modbusAddress}`));
      item.appendChild(el('button', { class: 'btn btn-small btn-danger', onclick: () => handlers.onRemove(inv.id) }, 'Usuń'));
      container.appendChild(item);
    }
  }

  function renderConfigInverterSelect(selectEl, inverters, selectedId) {
    selectEl.innerHTML = '';
    for (const inv of inverters) {
      const opt = el('option', { value: inv.id, selected: inv.id === selectedId ? 'selected' : false }, `${inv.name} (#${inv.modbusAddress})`);
      selectEl.appendChild(opt);
    }
  }

  // --- Ekran A: katalog parametrów z checkboxami ---
  function renderParamCatalogCheckboxes(container, groupedEntries, selectedCodes, onToggle) {
    container.innerHTML = '';
    const selectedSet = new Set(selectedCodes);
    for (const grp of groupedEntries) {
      const risky = Catalog.isRiskyGroup(grp.group);
      const groupEl = el('div', { class: 'param-group' + (risky ? ' risky' : '') });
      groupEl.appendChild(el('div', { class: 'param-group-title' }, `${grp.group} — ${grp.groupName}${risky ? ' ⚠ RYZYKOWNA' : ''}`));
      for (const entry of grp.entries) {
        const row = el('div', { class: 'checkbox-row' });
        const checkbox = el('input', {
          type: 'checkbox',
          checked: selectedSet.has(entry.code) ? 'checked' : false,
          onchange: (e) => onToggle(entry.code, e.target.checked, risky),
        });
        row.appendChild(checkbox);
        row.appendChild(el('label', {}, `${entry.code} — ${entry.name_approx} (${entry.register})`));
        groupEl.appendChild(row);
      }
      container.appendChild(groupEl);
    }
  }

  return {
    escapeHtml,
    el,
    showModal,
    renderInverterTabs,
    renderInverterPanel,
    renderInverterList,
    renderConfigInverterSelect,
    renderParamCatalogCheckboxes,
  };
})();
