import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Search, SlidersHorizontal, RotateCw, Star, Check } from "lucide-react";
import { cn } from "../../lib/utils";

export interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  filterStarred?: boolean;
  onToggleFilterStarred?: () => void;
  placeholder?: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  searchQuery,
  onSearchChange,
  onRefresh,
  isRefreshing = false,
  filterStarred = false,
  onToggleFilterStarred,
  placeholder = "Search"
}) => {
  return (
    <div className="flex items-center gap-3 py-3 w-full">
      {/* Search Input */}
      <div className="relative flex-1">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-10 bg-[#F4F5F6] hover:bg-[#EEF0F1] focus:bg-white text-sm text-[#111827] placeholder:text-[#9CA3AF] rounded-full pl-10 pr-4 outline-none border border-transparent focus:border-[#00A63E] focus:ring-1 focus:ring-[#00A63E] transition-all"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#9CA3AF] hover:text-[#4B5563]"
          >
            Clear
          </button>
        )}
      </div>

      {/* Filter Button with Popover */}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            title="Filter emails"
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-colors focus:outline-none",
              filterStarred
                ? "bg-[#EAF6EE] text-[#00A63E] border border-[#00A63E]/40"
                : "bg-[#F4F5F6] text-[#6B7280] hover:text-[#111827] hover:bg-[#E5E7EB]"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            className="z-50 w-52 bg-white rounded-xl shadow-lg border border-[#E5E7EB] p-2 animate-in fade-in-50 zoom-in-95 text-xs select-none"
          >
            <p className="px-2 py-1 font-semibold text-[#6B7280] uppercase tracking-wider text-[10px]">
              Filters
            </p>
            <button
              type="button"
              onClick={onToggleFilterStarred}
              className="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg hover:bg-[#F4F5F6] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Star className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span className="text-[#111827] font-medium">Starred only</span>
              </div>
              {filterStarred && <Check className="w-3.5 h-3.5 text-[#00A63E]" />}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Refresh Button */}
      <button
        type="button"
        title="Refresh list"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="w-10 h-10 rounded-full bg-[#F4F5F6] text-[#6B7280] hover:text-[#111827] hover:bg-[#E5E7EB] flex items-center justify-center transition-colors focus:outline-none active:scale-95"
      >
        <RotateCw className={cn("w-4 h-4", isRefreshing && "animate-spin text-[#00A63E]")} />
      </button>
    </div>
  );
};
