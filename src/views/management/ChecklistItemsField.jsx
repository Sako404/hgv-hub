import React from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Plus } from "lucide-react";
import { newId } from "../../domain/ids.js";
import { inputStyle, secondaryBtnStyle, iconBtnStyle } from "../shared/styles.js";

const rowInputStyle = { ...inputStyle, fontSize: 13.5, padding: "8px 10px" };

/**
 * Editor for ChecklistTemplate.items — an ordered list of {code, label,
 * category}. `code` is assigned ONCE, here, the moment a row is added
 * (an opaque id, not derived from the label) and never changes again,
 * even as label/category are edited — this is what keeps a future
 * historical reference (e.g. a Defect naming "which item") stable
 * across template edits. Deliberately no reordering UI in v1 (append/
 * remove only) — order rarely matters for a checklist walk-through.
 */
export default function ChecklistItemsField({ items, onChange }) {
  const { t } = useTranslation(["management", "common"]);

  function updateRow(index, field, value) {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    onChange(next);
  }

  function removeRow(index) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...items, { code: newId("item"), label: "", category: "" }]);
  }

  return (
    <div>
      {items.map((item, index) => (
        <div key={item.code} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            style={{ ...rowInputStyle, width: "35%" }}
            placeholder={t("management:checklistTemplates.itemCategory")}
            value={item.category}
            onChange={(e) => updateRow(index, "category", e.target.value)}
          />
          <input
            style={{ ...rowInputStyle, flex: 1 }}
            placeholder={t("management:checklistTemplates.itemLabel")}
            value={item.label}
            onChange={(e) => updateRow(index, "label", e.target.value)}
          />
          <button
            onClick={() => removeRow(index)}
            style={{ ...iconBtnStyle, flexShrink: 0 }}
            aria-label={t("management:checklistTemplates.removeItem")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        style={{ ...secondaryBtnStyle, display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13, width: "auto" }}
      >
        <Plus size={14} /> {t("management:checklistTemplates.addItem")}
      </button>
    </div>
  );
}
