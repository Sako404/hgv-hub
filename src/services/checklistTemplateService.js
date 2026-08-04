import { newId } from "../domain/ids.js";

/** @param {string} workspaceId */
export async function listChecklistTemplatesForWorkspace(workspaceId, db) {
  return db.checklistTemplates.query({ where: { workspaceId } });
}

/**
 * The template a new VehicleCheck against this workspace's vehicles
 * snapshots its items from (Stage VC-2). Null if the workspace has no
 * active default (e.g. its only default was archived) — callers must
 * handle that, not assume one always exists.
 * @param {string} workspaceId
 */
export async function resolveDefaultChecklistTemplateForWorkspace(workspaceId, db) {
  const matches = await db.checklistTemplates.query({ where: { workspaceId, isDefault: true, archivedAt: null } });
  return matches[0] ?? null;
}

function validateItems(items) {
  if (!items || items.length === 0) {
    throw new Error("A checklist must have at least one item");
  }
  for (const item of items) {
    if (!item.code || !item.label || !item.category) {
      throw new Error("Every checklist item needs a category and a label");
    }
  }
}

/**
 * @param {{workspaceId: string, name: string, items: {code: string, label: string, category: string}[]}} input
 */
export async function createChecklistTemplate(input, db) {
  if (!input.name) {
    throw new Error("Checklist must have a name");
  }
  validateItems(input.items);
  return db.checklistTemplates.insert({
    id: newId("checklisttemplate"),
    workspaceId: input.workspaceId,
    name: input.name,
    items: input.items,
    isDefault: false,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
}

/** name/items only — workspaceId is immutable, isDefault is managed separately (see setDefaultChecklistTemplate). */
export async function updateChecklistTemplate(id, patch, db) {
  if ("name" in patch && !patch.name) {
    throw new Error("Checklist must have a name");
  }
  if ("items" in patch) validateItems(patch.items);
  return db.checklistTemplates.update(id, patch);
}

export async function archiveChecklistTemplate(id, db) {
  return db.checklistTemplates.update(id, { archivedAt: new Date().toISOString() });
}

export async function restoreChecklistTemplate(id, db) {
  return db.checklistTemplates.update(id, { archivedAt: null });
}

/**
 * Exactly one ChecklistTemplate per workspace has isDefault: true at a
 * time — the one a VehicleCheck's item snapshot will resolve from
 * (VC-2). Sets the chosen template's flag and unsets every sibling's in
 * the same workspace; sequential updates over a small per-workspace
 * collection, same non-atomic-but-fine tradeoff already accepted by
 * this app's other management CRUD (e.g. archive/restore).
 */
export async function setDefaultChecklistTemplate(id, workspaceId, db) {
  const siblings = await db.checklistTemplates.query({ where: { workspaceId } });
  for (const template of siblings) {
    if (template.id === id && !template.isDefault) {
      await db.checklistTemplates.update(template.id, { isDefault: true });
    } else if (template.id !== id && template.isDefault) {
      await db.checklistTemplates.update(template.id, { isDefault: false });
    }
  }
}
