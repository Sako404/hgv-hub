import { eq, inArray, and, isNull } from "drizzle-orm";

/**
 * One generic class implementing the same 7-method Repository contract
 * as the client's IndexedDbRepository/LocalStorageRepository
 * (src/storage/LocalStorageRepository.js), over any Drizzle table.
 * Query criteria shape is identical: {where: {field: value |
 * {in: [...]}}}, AND across keys — translated directly into a SQL
 * WHERE clause here instead of client-side filtering.
 */
export class DrizzleRepository {
  constructor(db, table) {
    this.db = db;
    this.table = table;
  }

  async getById(id) {
    const rows = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return rows[0];
  }

  async getAll() {
    return this.db.select().from(this.table);
  }

  async query(criteria) {
    const where = criteria?.where;
    if (!where || Object.keys(where).length === 0) {
      return this.getAll();
    }
    const conditions = Object.entries(where).map(([key, condition]) => {
      const column = this.table[key];
      if (condition && typeof condition === "object" && !Array.isArray(condition) && "in" in condition) {
        return inArray(column, condition.in);
      }
      // SQL `= NULL` is never true — matchesCriteria's client-side
      // semantics are strict-equality (item[key] === condition),
      // which for null must translate to IS NULL instead of eq().
      if (condition === null) {
        return isNull(column);
      }
      return eq(column, condition);
    });
    return this.db
      .select()
      .from(this.table)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));
  }

  async insert(item) {
    await this.db.insert(this.table).values(item);
    return item;
  }

  async update(id, patch) {
    const rows = await this.db
      .update(this.table)
      .set(patch)
      .where(eq(this.table.id, id))
      .returning();
    if (!rows[0]) throw new Error(`DrizzleRepository: not found: ${id}`);
    return rows[0];
  }

  async remove(id) {
    await this.db.delete(this.table).where(eq(this.table.id, id));
  }

  async replaceAll(items) {
    await this.db.transaction(async (tx) => {
      await tx.delete(this.table);
      if (items.length > 0) {
        await tx.insert(this.table).values(items);
      }
    });
  }
}
