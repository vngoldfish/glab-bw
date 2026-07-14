import type { NavPage } from "./types";

export const NAV_ROUTES: Record<NavPage, string> = {
  dashboard: "/dashboard",
  "flow-image": "/flow-image",
  references: "/references",
  "flow-video": "/flow-video",
  "prompt-hub": "/prompt-hub",
  workflow: "/workflow",
  "workflow-templates": "/workflow-templates",
  "video-editor": "/video-editor",
  projects: "/projects",
  "project-media": "/project-media",
  docs: "/docs",
  "api-docs": "/api-docs",
  grok: "/grok",
  webhook: "/webhook",
  extension: "/extension",
  settings: "/settings",
  credits: "/credits",
};

export const DEFAULT_ROUTE = NAV_ROUTES["flow-image"];

export function navPageFromPath(pathname: string): NavPage | null {
  const entry = Object.entries(NAV_ROUTES).find(([, path]) => path === pathname);
  return entry ? (entry[0] as NavPage) : null;
}