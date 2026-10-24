import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, History, CheckCircle2, AlertCircle, Clock, Send, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { format } from "date-fns";

export interface TimelineViewProps {
  emailId: string;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ emailId }) => {
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["emails", emailId, "timeline"],
    queryFn: () => api.emails.timeline(emailId),
    enabled: isOpen
  });

  const getEventIcon = (type: string) => {
    switch (type) {
      case "SENT":
        return <CheckCircle2 className="w-4 h-4 text-[#00A63E]" />;
      case "FAILED":
      case "SMTP_ERROR":
        return <AlertCircle className="w-4 h-4 text-[#DC2626]" />;
      case "CLAIMED":
      case "SLOT_RESERVED":
        return <ShieldCheck className="w-4 h-4 text-[#2563EB]" />;
      case "PLANNED":
      case "RESCHEDULED":
        return <Clock className="w-4 h-4 text-[#F59E0B]" />;
      default:
        return <Send className="w-4 h-4 text-[#6B7280]" />;
    }
  };

  return (
    <div className="mt-8 border border-[#E5E7EB] rounded-2xl overflow-hidden bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-5 py-3.5 bg-[#F9FAFB] hover:bg-[#F3F4F6] text-xs font-semibold text-[#111827] transition-colors focus:outline-none select-none"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#00A63E]" />
          <span>Delivery Timeline & Audit Ledger</span>
        </div>
        <div className="flex items-center gap-1.5 text-[#6B7280]">
          <span>{isOpen ? "Hide" : "Inspect History"}</span>
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-5 border-t border-[#E5E7EB] animate-in fade-in-50 text-xs">
          {isLoading ? (
            <div className="py-4 text-center text-[#6B7280]">Loading timeline...</div>
          ) : !data ? (
            <div className="py-4 text-center text-[#6B7280]">No timeline events recorded.</div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Plain English Summary */}
              {data.summary && (
                <div className="p-3.5 rounded-xl bg-[#EAF6EE] text-[#00782D] text-xs font-medium border border-[#D3EFDD]">
                  {data.summary}
                </div>
              )}

              {/* Event Nodes */}
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#E5E7EB]">
                {data.events.map((ev) => (
                  <div key={ev.id} className="relative flex flex-col gap-1">
                    <div className="absolute -left-[27px] top-0 p-0.5 bg-white rounded-full">
                      {getEventIcon(ev.type)}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#111827]">{ev.type}</span>
                      <span className="text-[11px] text-[#9CA3AF] tabular-nums">
                        {format(new Date(ev.at), "MMM d, yyyy h:mm:ss a")}
                      </span>
                    </div>
                    {ev.data && Object.keys(ev.data).length > 0 && (
                      <pre className="text-[10px] bg-[#F4F5F6] p-2 rounded-lg text-[#4B5563] overflow-x-auto font-mono">
                        {JSON.stringify(ev.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
