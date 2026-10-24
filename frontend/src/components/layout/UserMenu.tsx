import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { User } from "../../types";
import { Avatar } from "../ui/Avatar";

export interface UserMenuProps {
  user: User | null;
  onLogout: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, onLogout }) => {
  const displayName = user?.name || "Oliver Brown";
  const displayEmail = user?.email || "oliver.brown@domain.io";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 w-full p-1.5 pr-2.5 rounded-full bg-[#F4F5F6] hover:bg-[#ECEEED] transition-colors text-left focus:outline-none focus:ring-2 focus:ring-[#00A63E]/30 select-none"
        >
          <Avatar src={user?.avatarUrl} name={displayName} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#111827] truncate leading-tight">
              {displayName}
            </p>
            <p className="text-[10px] text-[#6B7280] truncate leading-tight">
              {displayEmail}
            </p>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[200px] bg-white rounded-xl shadow-lg border border-[#E5E7EB] p-1.5 animate-in fade-in-50 zoom-in-95"
        >
          <div className="px-3 py-2 border-b border-[#F3F4F6] mb-1">
            <p className="text-xs font-semibold text-[#111827]">{displayName}</p>
            <p className="text-[11px] text-[#6B7280] truncate">{displayEmail}</p>
          </div>

          <DropdownMenu.Item
            disabled
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6B7280] rounded-lg select-none outline-none opacity-50 cursor-not-allowed"
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Profile Settings</span>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="h-px bg-[#F3F4F6] my-1" />

          <DropdownMenu.Item
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#DC2626] rounded-lg cursor-pointer select-none outline-none hover:bg-[#FEE2E2]/50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
