import React from "react";
import NavItem from "./NavItem.jsx";

/**
 * A labeled group of NavItems — e.g. "Driver" or "Company". Groups are
 * plain data (see AppShell.jsx), so adding a future item/group to either
 * role is a data change, not a structural one. Items that don't exist
 * yet are simply not included here — never rendered as disabled/dead
 * links.
 */
export default function NavGroup({ label, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="shell-nav-group">
      <div className="shell-nav-group-label">{label}</div>
      {items.map((item) => (
        <NavItem
          key={item.key}
          icon={item.icon}
          label={item.label}
          active={item.active}
          onClick={item.onClick}
        />
      ))}
    </div>
  );
}
