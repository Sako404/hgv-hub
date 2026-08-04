import React from "react";

export default function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`shell-nav-item${active ? " shell-nav-item--active" : ""}`}
    >
      <span className="shell-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="shell-nav-label">{label}</span>
    </button>
  );
}
