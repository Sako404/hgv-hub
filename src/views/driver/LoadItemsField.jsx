import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { newId } from "../../domain/ids.js";
import { inputStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";

const rowInputStyle = { ...inputStyle, fontSize: 13.5, padding: "8px 10px" };

/**
 * Editor for a per-load Shift's Load rows — one row per paid trip
 * (reference, description, amount, optional mileage). `id` here is a
 * client-side-only key (mirrors ChecklistItemsField's `code` pattern)
 * so React can track rows across add/remove before any of them have a
 * real Load.id; loadService assigns the real id at save time, since a
 * Load is plain CRUD with no need for a stable id before that.
 */
export default function LoadItemsField({ loads, onChange }) {
  const { t } = useTranslation(["driver", "common"]);

  function updateRow(index, field, value) {
    const next = [...loads];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  }

  function removeRow(index) {
    onChange(loads.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...loads, { id: newId("load"), reference: "", description: "", amount: "", distanceMiles: "" }]);
  }

  return (
    <div>
      {loads.map((load, index) => (
        <div key={load.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...rowInputStyle, flex: "1 1 120px" }}
            placeholder={t("driver:addShift.loads.referencePlaceholder")}
            value={load.reference}
            onChange={(e) => updateRow(index, "reference", e.target.value)}
          />
          <input
            style={{ ...rowInputStyle, flex: "2 1 160px" }}
            placeholder={t("driver:addShift.loads.descriptionPlaceholder")}
            value={load.description}
            onChange={(e) => updateRow(index, "description", e.target.value)}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            style={{ ...rowInputStyle, flex: "1 1 100px" }}
            placeholder={t("driver:addShift.loads.amount")}
            value={load.amount}
            onChange={(e) => updateRow(index, "amount", e.target.value)}
          />
          <input
            type="number"
            step="1"
            min="0"
            style={{ ...rowInputStyle, flex: "1 1 90px" }}
            placeholder={t("driver:addShift.loads.distanceMiles")}
            value={load.distanceMiles}
            onChange={(e) => updateRow(index, "distanceMiles", e.target.value)}
          />
          <button
            onClick={() => removeRow(index)}
            style={{ ...iconBtnStyle, flexShrink: 0 }}
            aria-label={t("driver:addShift.loads.removeLoad")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        style={{ ...secondaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13, width: "auto" }}
      >
        <Plus size={14} /> {t("driver:addShift.loads.addLoad")}
      </button>
    </div>
  );
}
