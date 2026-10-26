import { List, Network, Plus } from "lucide-react";
import { ToolbarSearch } from "./ToolbarSearch";
import { Button } from "./ui/button";
import { useInterfaceLabel } from "@/i18n/interface-labels";

export interface AgentsToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  view: "list" | "org";
  onViewChange: (value: "list" | "org") => void;
  hideViewToggle?: boolean;
  onNewAgent: () => void;
}

/** Shared roster search, view controls and actions for the page and stories. */
export function AgentsToolbar({ query, onQueryChange, view, onViewChange, hideViewToggle, onNewAgent }: AgentsToolbarProps) {
  const tr = useInterfaceLabel();
  return <div data-canonical-toolbar="agents" role="toolbar" aria-label={tr("Agents controls")} className="flex flex-wrap items-center gap-3">
    <div className="design-toolbar-controls flex w-full flex-wrap items-center gap-4">
      <ToolbarSearch query={query} onQueryChange={onQueryChange} label="Search agents" placeholder="Search agents…" />
      {!hideViewToggle && <div className="design-view-toggle" role="group" aria-label={tr("Agent view")}>
          <Button type="button" size="icon-sm" variant={view === "list" ? "secondary" : "ghost"} className="design-toolbar-icon" onClick={() => onViewChange("list")} title={tr("List view")} aria-label={tr("List view")} aria-pressed={view === "list"}><List aria-hidden /></Button>
          <Button type="button" size="icon-sm" variant={view === "org" ? "secondary" : "ghost"} className="design-toolbar-icon" onClick={() => onViewChange("org")} title={tr("Org chart view")} aria-label={tr("Org chart view")} aria-pressed={view === "org"}><Network aria-hidden /></Button>
      </div>}
      <div className="design-toolbar-actions">
        <Button size="sm" variant="outline" data-toolbar-primary onClick={onNewAgent}><Plus aria-hidden />{tr("New Agent")}</Button>
      </div>
    </div>
  </div>;
}
