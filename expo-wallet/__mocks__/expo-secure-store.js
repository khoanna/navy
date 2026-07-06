const store = new Map();
module.exports = {
  getItemAsync: async (k) => (store.has(k) ? store.get(k) : null),
  setItemAsync: async (k, v) => { store.set(k, v); },
  deleteItemAsync: async (k) => { store.delete(k); },
};
