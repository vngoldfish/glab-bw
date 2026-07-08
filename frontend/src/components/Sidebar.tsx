import { NavLink } from "react-router-dom";
import { NAV_ROUTES } from "../routes";
import type { NavPage } from "../types";

interface NavItem {
  id: NavPage;
  label: string;
  icon: string;
  enabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "flow-image", label: "Flow Ảnh", icon: "◈" },
  { id: "references", label: "Ảnh tham chiếu", icon: "▣" },
  { id: "flow-video", label: "Flow Video", icon: "▶", enabled: false },
  { id: "grok", label: "Media Grok", icon: "✦", enabled: false },
  { id: "webhook", label: "Webhook", icon: "⬡" },
  { id: "extension", label: "Auth Helper", icon: "◎" },
  { id: "settings", label: "Cài Đặt", icon: "⚙" },
];

interface SidebarProps {
  extensionConnected: boolean;
}

export default function Sidebar({ extensionConnected }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">G</span>
        <div>
          <strong>G-Labs BW</strong>
          <small>Automation</small>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={NAV_ROUTES[item.id]}
            className={({ isActive }) =>
              [
                "sidebar-link",
                isActive ? "active" : "",
                item.enabled === false ? "disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")
            }
          >
            <span className={`nav-icon nav-icon-${item.id}`}>{item.icon}</span>
            <span>{item.label}</span>
            {item.enabled === false && <span className="sidebar-soon">Soon</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`sidebar-status ${extensionConnected ? "online" : "offline"}`}>
          <span className="status-dot" />
          {extensionConnected ? "Auth Helper OK" : "Chưa kết nối"}
        </div>
        <span className="sidebar-badge">BASIC</span>
      </div>
    </aside>
  );
}