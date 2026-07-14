import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { NAV_ROUTES } from "../routes";
import type { NavPage } from "../types";
import { useUiDialog } from "./UiDialog";
import {
  LayoutDashboard,
  Image,
  Images,
  Video,
  Wand2,
  Workflow,
  Film,
  FolderKanban,
  BookOpen,
  Code2,
  Webhook,
  Puzzle,
  Settings,
  Coins,
  ChevronLeft,
  ChevronRight,
  type LucideIcon
} from "lucide-react";

interface NavItem {
  id: NavPage;
  label: string;
  icon: LucideIcon;
  enabled?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Hệ thống",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "projects", label: "Dự án", icon: FolderKanban },
      { id: "project-media", label: "Media Tổng Hợp", icon: Images },
      { id: "credits", label: "Tín Dụng & Hoạt Động", icon: Coins },
    ]
  },
  {
    title: "Automation & AI",
    items: [
      { id: "flow-image", label: "Flow Tạo Ảnh", icon: Image },
      { id: "references", label: "Ảnh Tham Chiếu", icon: Images },
      { id: "flow-video", label: "Flow Tạo Video", icon: Video },
      { id: "prompt-hub", label: "Prompt Hub", icon: Wand2 },
      { id: "workflow", label: "Workflow Editor", icon: Workflow },
      { id: "video-editor", label: "Trình Dựng Video", icon: Film },
    ]
  },
  {
    title: "Kết nối & Thiết lập",
    items: [
      { id: "extension", label: "Auth Helper", icon: Puzzle },
      { id: "webhook", label: "Webhook API", icon: Webhook },
      { id: "settings", label: "Cài Đặt", icon: Settings },
      { id: "docs", label: "Tài Liệu Hướng Dẫn", icon: BookOpen },
      { id: "api-docs", label: "Tài Liệu API", icon: Code2 },
    ]
  }
];

interface SidebarProps {
  extensionConnected: boolean;
  grokTab?: string;
  flowTab?: string;
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({
  extensionConnected,
  grokTab = "…",
  flowTab = "…",
  collapsed,
  onToggle,
}: SidebarProps) {
  const dialog = useUiDialog();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Floating Toggle Handle */}
      <button
        type="button"
        className="sidebar-toggle-handle"
        onClick={onToggle}
        title={collapsed ? "Mở rộng menu chính" : "Thu gọn menu chính"}
        aria-label={collapsed ? "Mở rộng menu chính" : "Thu gọn menu chính"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
      <div className="sidebar-brand">
        <span className="sidebar-logo">B</span>
        <div>
          <strong>Bawui APP 1</strong>
          <small>Automation</small>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group, groupIdx) => (
          <div key={groupIdx} className="sidebar-group">
            <h3 className="sidebar-group-title">{group.title}</h3>
            {group.items.map((item) => (
              <NavLink
                key={item.id}
                to={NAV_ROUTES[item.id]}
                data-tooltip={item.label}
                onClick={(e) => {
                  const isLeavingProject = item.id !== "workflow" || location.pathname !== NAV_ROUTES.workflow;
                  if ((window as any).workflowDirty && isLeavingProject) {
                    e.preventDefault();
                    void (async () => {
                      const leave = await dialog.confirm({
                         title: "Rời workflow?",
                         message:
                           "Bạn có thay đổi chưa lưu trên workflow. Rời trang sẽ mất thay đổi nếu chưa lưu.",
                         confirmLabel: "Rời đi",
                         cancelLabel: "Ở lại",
                         tone: "danger",
                       });
                       if (leave) navigate(NAV_ROUTES[item.id]);
                     })();
                   }
                 }}
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
                <span className={`nav-icon nav-icon-${item.id}`}>
                  <item.icon size={15} strokeWidth={2} />
                </span>
                <span>{item.label}</span>
                {item.enabled === false && <span className="sidebar-soon">Soon</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`sidebar-status ${extensionConnected ? "online" : "offline"}`}>
          <span className="status-dot" />
          <span>{extensionConnected ? "Auth Helper OK" : "Chưa kết nối"}</span>
        </div>
        {extensionConnected && (
          <div className="sidebar-ext-meta">
            Flow {flowTab} · Grok {grokTab}
          </div>
        )}
        <span className="sidebar-badge">BASIC</span>
      </div>
    </aside>
  );
}