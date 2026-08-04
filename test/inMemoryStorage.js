// Minimal Storage double (getItem/setItem/removeItem over a Map) so tests
// exercise LocalStorageRepository's injectable-backend design without a
// DOM/localStorage environment.
export function createInMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}
