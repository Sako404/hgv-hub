/**
 * Every method is Promise-returning across all implementations
 * (LocalStorageRepository, IndexedDbRepository, and a future
 * ApiRepository) — one consistent async contract, not a synchronous
 * facade over an inherently async backend. See docs/ARCHITECTURE.md.
 * @template T
 * @typedef {Object} Repository
 * @property {(id: string) => Promise<T|undefined>} getById
 * @property {() => Promise<T[]>} getAll
 * @property {(criteria?: QueryCriteria) => Promise<T[]>} query
 * @property {(item: T) => Promise<T>} insert
 * @property {(id: string, patch: Partial<T>) => Promise<T>} update
 * @property {(id: string) => Promise<void>} remove
 * @property {(items: T[]) => Promise<void>} replaceAll
 */

/**
 * Deliberately minimal, serialisable query language — not a general
 * query DSL. Every current call site needs only equality (including
 * `null`) and "field is one of these values"; nothing here should grow
 * beyond what's actually used. A future `ApiRepository` (HTTP → remote
 * DB) can turn this directly into a SQL WHERE clause; a predicate
 * *function* could never cross that boundary (can't serialize a JS
 * closure into a request).
 *
 * @typedef {Object} QueryCriteria
 * @property {Object<string, any|{in: any[]}>} [where] - AND across keys;
 *   a plain value means equality, `{in: [...]}` means "field is one of
 *   these values". Anything not expressible this way (e.g. "does this
 *   array *field* contain X") is intentionally NOT supported here —
 *   narrow with `where` first, then `.filter()` the (already small)
 *   result in the calling service, per docs/ARCHITECTURE.md.
 */

/**
 * @param {any} item
 * @param {QueryCriteria} [criteria]
 */
export function matchesCriteria(item, criteria) {
  const where = criteria?.where;
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === "object" && !Array.isArray(condition) && "in" in condition) {
      return condition.in.includes(item[key]);
    }
    return item[key] === condition;
  });
}

/**
 * Generic CRUD repository over a single JSON-array key in a storage
 * backend. The backend is injectable (defaults to window.localStorage) so
 * tests can use an in-memory double and a future backend swap only needs
 * to implement the same 6-method shape (e.g. HttpRepository).
 * @implements {Repository<any>}
 */
export class LocalStorageRepository {
  constructor(key, storage = globalThis.localStorage) {
    this.key = key;
    this.storage = storage;
  }

  _readAll() {
    try {
      const raw = this.storage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeAll(items) {
    this.storage.setItem(this.key, JSON.stringify(items));
  }

  async getById(id) {
    return this._readAll().find((x) => x.id === id);
  }

  async getAll() {
    return this._readAll();
  }

  /** @param {QueryCriteria} [criteria] */
  async query(criteria) {
    return this._readAll().filter((item) => matchesCriteria(item, criteria));
  }

  async insert(item) {
    const all = this._readAll();
    all.push(item);
    this._writeAll(all);
    return item;
  }

  async update(id, patch) {
    const all = this._readAll();
    const i = all.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(`LocalStorageRepository(${this.key}): not found: ${id}`);
    all[i] = { ...all[i], ...patch };
    this._writeAll(all);
    return all[i];
  }

  async remove(id) {
    this._writeAll(this._readAll().filter((x) => x.id !== id));
  }

  async replaceAll(items) {
    this._writeAll(items);
  }
}
