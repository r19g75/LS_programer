// Konfiguracja w localStorage — lokalna, efemeryczna, nieprzenoszona (sekcja 5.3 spec).

const ConfigStore = (() => {
  const KEY = 'g100_config_v1';

  function defaultState() {
    return {
      inverters: [], // {id, name, modbusAddress}
      selectedParams: {}, // inverterId -> [code, ...]
      debugMode: false,
      bleChunkSize: 100,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch (e) {
      console.error('Nieprawidłowa konfiguracja w localStorage, reset', e);
      return defaultState();
    }
  }

  let state = load();

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function getState() {
    return state;
  }

  function addInverter(name, modbusAddress) {
    const id = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    state.inverters.push({ id, name, modbusAddress });
    state.selectedParams[id] = [];
    save();
    return id;
  }

  function removeInverter(id) {
    state.inverters = state.inverters.filter((i) => i.id !== id);
    delete state.selectedParams[id];
    save();
  }

  function updateInverter(id, patch) {
    const inv = state.inverters.find((i) => i.id === id);
    if (inv) Object.assign(inv, patch);
    save();
  }

  function setSelectedParams(inverterId, codes) {
    state.selectedParams[inverterId] = codes;
    save();
  }

  function getSelectedParams(inverterId) {
    return state.selectedParams[inverterId] || [];
  }

  function setDebugMode(on) {
    state.debugMode = on;
    save();
  }

  function setBleChunkSize(n) {
    state.bleChunkSize = n;
    save();
  }

  return {
    getState,
    addInverter,
    removeInverter,
    updateInverter,
    setSelectedParams,
    getSelectedParams,
    setDebugMode,
    setBleChunkSize,
  };
})();
