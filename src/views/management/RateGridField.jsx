import React from "react";
import { useTranslation } from "react-i18next";

const DAY_CATEGORIES = ["MonThu", "Fri", "Sat", "Sun"];
const WINDOWS = ["Days", "Lates", "Nights"];

const cellStyle = { padding: "6px 4px", textAlign: "center", borderBottom: "1px solid #2A2E35" };
const headerCellStyle = { ...cellStyle, color: "#8B909A", fontWeight: 400, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 };
const numberInputStyle = {
  width: 64,
  background: "#14161A",
  border: "1px solid #2A2E35",
  borderRadius: 6,
  padding: "6px 4px",
  color: "#EDEEF0",
  fontSize: 13,
  textAlign: "center",
  fontFamily: "'Barlow', sans-serif",
};

/**
 * The fixed rate grid this app actually supports: 4 day categories x 3
 * time windows x [base, +holiday] — exactly payEngine.js's rates shape,
 * nothing more. Deliberately not a generic dynamic-form builder; the
 * shape is known and fixed, shared identically by Create and Revise
 * (Revise just starts pre-filled with the current version's values).
 */
export default function RateGridField({ rates, onChange, readOnly = false }) {
  const { t } = useTranslation(["rateCards", "pay"]);

  function setCell(category, window, index, value) {
    const next = {
      ...rates,
      [category]: { ...rates[category], [window]: [...rates[category][window]] },
    };
    next[category][window][index] = Number(value) || 0;
    onChange(next);
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={headerCellStyle}></th>
            {WINDOWS.map((window) => (
              <th key={window} colSpan={2} style={headerCellStyle}>
                {t(`pay:window.${window}`)}
              </th>
            ))}
          </tr>
          <tr>
            <th style={headerCellStyle}></th>
            {WINDOWS.map((window) => (
              <React.Fragment key={window}>
                <th style={headerCellStyle}>{t("rateCards:form.baseRate")}</th>
                <th style={headerCellStyle}>{t("rateCards:form.holidayRate")}</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_CATEGORIES.map((category) => (
            <tr key={category}>
              <td style={{ ...cellStyle, textAlign: "left", color: "#B8BCC4" }}>{t(`pay:dayCategory.${category}`)}</td>
              {WINDOWS.map((window) => (
                <React.Fragment key={window}>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={readOnly}
                      style={{ ...numberInputStyle, opacity: readOnly ? 0.7 : 1 }}
                      value={rates[category][window][0]}
                      onChange={(e) => setCell(category, window, 0, e.target.value)}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={readOnly}
                      style={{ ...numberInputStyle, opacity: readOnly ? 0.7 : 1 }}
                      value={rates[category][window][1]}
                      onChange={(e) => setCell(category, window, 1, e.target.value)}
                    />
                  </td>
                </React.Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function emptyRates() {
  const rates = {};
  for (const category of DAY_CATEGORIES) {
    rates[category] = {};
    for (const window of WINDOWS) {
      rates[category][window] = [0, 0];
    }
  }
  return rates;
}
