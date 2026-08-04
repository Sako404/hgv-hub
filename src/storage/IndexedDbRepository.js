import { matchesCriteria } from "./LocalStorageRepository.js";

/**
 * IndexedDB-backed Repository over a single object store (keyPath
 * "id"). idb's shorthand write methods (add/put/delete/clear) already
 * wait on the underlying transaction's `.done` promise, not just the
 * individual request — so a write here never resolves before it's
 * actually durable. `update` uses an explicit read-modify-write
 * transaction for the same reason (atomic get+put).
 * @implements {import('./LocalStorageRepository.js').Repository<any>}
 */
export class IndexedDbRepository {
  constructor(idbHandle, storeName) {
    this.idbHandle = idbHandle;
    this.storeName = storeName;
  }

  async getById(id) {
    return this.idbHandle.get(this.storeName, id);
  }

  async getAll() {
    return this.idbHandle.getAll(this.storeName);
  }

  /** @param {import('./LocalStorageRepository.js').QueryCriteria} [criteria] */
  async query(criteria) {
    const all = await this.getAll();
    return all.filter((item) => matchesCriteria(item, criteria));
  }

  async insert(item) {
    await this.idbHandle.add(this.storeName, item);
    return item;
  }

  async update(id, patch) {
    const tx = this.idbHandle.transaction(this.storeName, "readwrite");
    const existing = await tx.store.get(id);
    if (!existing) throw new Error(`IndexedDbRepository(${this.storeName}): not found: ${id}`);
    const updated = { ...existing, ...patch };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async remove(id) {
    await this.idbHandle.delete(this.storeName, id);
  }

  async replaceAll(items) {
    const tx = this.idbHandle.transaction(this.storeName, "readwrite");
    await tx.store.clear();
    await Promise.all(items.map((item) => tx.store.put(item)));
    await tx.done;
  }
}
