import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock, Send, Plus, Hash, Bell, Check, Loader2 } from "lucide-react";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";
import { User, EmailCounts } from "../../types";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";

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

  const [slackState, setSlackState] = useState<{
    loading: boolean;
    connected: boolean;
    channel?: string;
    teamName?: string;
    testing: boolean;
    testSuccess?: boolean;
    error?: string;
  }>({
    loading: true,
    connected: false,
    testing: false
  });

  const loadSlackStatus = async () => {
    if (!user) return;
    try {
      const data = await api.slack.status();
      setSlackState((prev) => ({
        ...prev,
        loading: false,
        connected: data.connected,
        channel: data.integration?.channel,
        teamName: data.integration?.teamName
      }));
    } catch {
      setSlackState((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    loadSlackStatus();
  }, [user]);

  const handleConnectSlack = async () => {
    try {
      const res = await api.slack.getConnectUrl();
      if (res.authorizeUrl) {
        window.location.href = res.authorizeUrl;
      }
    } catch (err: any) {
      alert(err.message || "Failed to initiate Slack connect");
    }
  };

  const handleTestAlert = async () => {
    setSlackState((prev) => ({ ...prev, testing: true, testSuccess: false, error: undefined }));
    try {
      await api.slack.testAlert();
      setSlackState((prev) => ({ ...prev, testing: false, testSuccess: true }));
      setTimeout(() => {
        setSlackState((prev) => ({ ...prev, testSuccess: false }));
      }, 3500);
    } catch (err: any) {
      setSlackState((prev) => ({
        ...prev,
        testing: false,
        error: err.message || "Failed to trigger test alert"
      }));
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Slack integration?")) return;
    try {
      await api.slack.disconnect();
      setSlackState((prev) => ({
        ...prev,
        connected: false,
        channel: undefined,
        teamName: undefined
      }));
    } catch (err: any) {
      alert(err.message || "Failed to disconnect Slack");
    }
  };

  return (
    <aside className="w-[200px] shrink-0 min-h-screen bg-white p-4 flex flex-col justify-between select-none border-r border-[#F0F0F0]">
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

        {/* Integrations Section (Placed directly under Core for high visibility) */}
        <div className="mt-2 pt-3 border-t border-[#F0F1F2] flex flex-col gap-2">
          <p className="px-3 text-[11px] font-bold text-[#9CA3AF] tracking-wider uppercase mb-1">
            INTEGRATIONS
          </p>

          {slackState.connected ? (
            <div className="p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <span className="text-xs font-semibold text-[#0F172A] truncate flex items-center">
                    <Hash className="w-3 h-3 text-[#64748B] mr-0.5 shrink-0" />
                    {slackState.channel || "slack"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="text-[10px] text-[#94A3B8] hover:text-red-500 transition-colors"
                  title="Disconnect"
                >
                  Disconnect
                </button>
              </div>

              <button
                type="button"
                onClick={handleTestAlert}
                disabled={slackState.testing}
                className="w-full py-1.5 px-2 bg-white hover:bg-emerald-50 border border-[#CBD5E1] hover:border-emerald-500 rounded-lg text-xs font-medium text-[#334155] hover:text-emerald-700 flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-95 disabled:opacity-60"
              >
                {slackState.testing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                    <span>Sending...</span>
                  </>
                ) : slackState.testSuccess ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700">Alert Sent!</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-3 h-3 text-amber-500" />
                    <span>Send Test Alert</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnectSlack}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-[#CBD5E1] hover:border-[#4A154B] bg-[#FAFAFA] hover:bg-[#F4EDE4] text-xs font-medium text-[#475569] hover:text-[#4A154B] flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 15a2 2 0 1 1-2-2h2v2zm1 0a2 2 0 1 1 2 2v-2H7zm0-1a2 2 0 1 1-2-2 2 2 0 0 1 2 2zm1-7a2 2 0 1 1 2-2v2H8zm-1 1a2 2 0 1 1-2-2h2v2zm0 1a2 2 0 1 1 2 2 2 2 0 0 1-2-2zm7-1a2 2 0 1 1 2 2h-2V8zm-1 0a2 2 0 1 1-2-2v2h2zm0 1a2 2 0 1 1 2 2 2 2 0 0 1-2-2zm-1 7a2 2 0 1 1-2 2v-2h2zm1-1a2 2 0 1 1 2 2h-2v-2zm0-1a2 2 0 1 1-2-2 2 2 0 0 1 2 2z"/>
              </svg>
              <span>Connect Slack</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
