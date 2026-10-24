import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock, Send, Plus } from "lucide-react";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";
import { User, EmailCounts } from "../../types";
import { cn } from "../../lib/utils";

export interface SidebarProps {
  user: User | null;
  counts: EmailCounts;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, counts, onLogout }) => {
  const location = useLocation();
  const currentPath = location.pathname;

  const isScheduled = currentPath === "/" || currentPath === "/scheduled";
  const isSent = currentPath === "/sent";

  return (
    <aside className="w-[200px] shrink-0 min-h-screen bg-white p-4 flex flex-col justify-between select-none">
      <div className="flex flex-col gap-5">
        {/* Top Logo */}
        <div className="pt-1 px-1">
          <Link to="/">
            <Logo />
          </Link>
        </div>

        {/* User Card Pill */}
        <UserMenu user={user} onLogout={onLogout} />

        {/* Compose Button Pill */}
        <Link to="/compose" className="w-full">
          <button
            type="button"
            className="w-full h-10 px-4 rounded-full border border-[#00A63E] text-[#00A63E] font-medium text-sm flex items-center justify-center gap-1.5 hover:bg-[#EAF6EE] active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Compose</span>
          </button>
        </Link>

        {/* Nav Group */}
        <div className="mt-2">
          <p className="px-3 text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase mb-1.5">
            CORE
          </p>
          <nav className="flex flex-col gap-1">
            <Link
              to="/scheduled"
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors",
                isScheduled
                  ? "bg-[#EAF6EE] text-[#00A63E] font-semibold"
                  : "text-[#4B5563] hover:bg-[#F4F5F6] hover:text-[#111827] font-medium"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Clock className={cn("w-4 h-4", isScheduled ? "text-[#00A63E]" : "text-[#6B7280]")} />
                <span>Scheduled</span>
              </div>
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                  isScheduled ? "text-[#00A63E]" : "text-[#6B7280]"
                )}
              >
                {counts.scheduled}
              </span>
            </Link>

            <Link
              to="/sent"
              className={cn(
                "flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors",
                isSent
                  ? "bg-[#EAF6EE] text-[#00A63E] font-semibold"
                  : "text-[#4B5563] hover:bg-[#F4F5F6] hover:text-[#111827] font-medium"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Send className={cn("w-4 h-4", isSent ? "text-[#00A63E]" : "text-[#6B7280]")} />
                <span>Sent</span>
              </div>
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-full",
                  isSent ? "text-[#00A63E]" : "text-[#6B7280]"
                )}
              >
                {counts.sent}
              </span>
            </Link>
          </nav>
        </div>
      </div>
    </aside>
  );
};
