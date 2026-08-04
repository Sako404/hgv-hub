/**
 * Same 7-method Repository contract as IndexedDbRepository/
 * LocalStorageRepository (src/storage/LocalStorageRepository.js), over
 * the server's generic /api/:collection routes. Query criteria are
 * sent as-is (JSON-encoded) via a `where` query param — the server
 * translates the identical {where: {field: value | {in: [...]}}}
 * shape into a SQL WHERE clause (server/src/repository/
 * drizzleRepository.js), so no shape translation happens here.
 *
 * `credentials: "include"` on every request so the httpOnly session
 * cookie travels with it — required for the server's session
 * middleware to authenticate the request at all.
 * @implements {import('./LocalStorageRepository.js').Repository<any>}
 */
export class ApiRepository {
  constructor(baseUrl, collectionName) {
    this.baseUrl = baseUrl;
    this.collectionName = collectionName;
  }

  async _fetch(path, options) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      if (res.status === 404) return undefined;
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `ApiRepository(${this.collectionName}): request failed (${res.status})`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  async getById(id) {
    return this._fetch(`/api/${this.collectionName}/${id}`);
  }

  async getAll() {
    return (await this._fetch(`/api/${this.collectionName}`)) ?? [];
  }

  /** @param {import('./LocalStorageRepository.js').QueryCriteria} [criteria] */
  async query(criteria) {
    if (!criteria?.where) return this.getAll();
    const where = encodeURIComponent(JSON.stringify(criteria.where));
    return (await this._fetch(`/api/${this.collectionName}?where=${where}`)) ?? [];
  }

  async insert(item) {
    return this._fetch(`/api/${this.collectionName}`, {
      method: "POST",
      body: JSON.stringify(item),
    });
  }

  async update(id, patch) {
    const updated = await this._fetch(`/api/${this.collectionName}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!updated) throw new Error(`ApiRepository(${this.collectionName}): not found: ${id}`);
    return updated;
  }

  async remove(id) {
    await this._fetch(`/api/${this.collectionName}/${id}`, { method: "DELETE" });
  }

  async replaceAll(items) {
    await this._fetch(`/api/${this.collectionName}`, {
      method: "PUT",
      body: JSON.stringify(items),
    });
  }
}
