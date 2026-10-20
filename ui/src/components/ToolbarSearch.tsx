import type { Ref } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useInterfaceLabel } from "@/i18n/interface-labels";

/** Shared collection search field: one surface, focus ring and clear affordance. */
export function ToolbarSearch({ query, onQueryChange, label, placeholder, clearLabel = "Clear search", inputRef, inputType = "text" }: {
  query: string;
  onQueryChange: (value: string) => void;
  label: string;
  placeholder: string;
  clearLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  inputType?: "text" | "search";
}) {
  const tr = useInterfaceLabel();
  return <div className="design-task-search" data-toolbar-search>
    <Search aria-hidden />
    <Input ref={inputRef} type={inputType} aria-label={tr(label)} placeholder={tr(placeholder)} value={query} onChange={event => onQueryChange(event.target.value)} />
    {query && <Button variant="ghost" size="icon-xs" data-toolbar-clear aria-label={tr(clearLabel)} onClick={() => onQueryChange("")}><X aria-hidden /></Button>}
  </div>;
}
