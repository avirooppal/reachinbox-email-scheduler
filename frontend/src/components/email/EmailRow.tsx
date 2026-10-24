import React from "react";
import { useNavigate } from "react-router-dom";
import { Star, ExternalLink } from "lucide-react";
import { Email } from "../../types";
import { Badge } from "../ui/Badge";
import { cn, formatSentTimestamp } from "../../lib/utils";

export interface EmailRowProps {
  email: Email;
  view: "scheduled" | "sent";
  onToggleStar: (id: string, currentStarred: boolean) => void;
}

export const EmailRow: React.FC<EmailRowProps> = ({
  email,
  view,
  onToggleStar
}) => {
  const navigate = useNavigate();

  const recipientLabel = email.toName
    ? `To: ${email.toName}`
    : `To: ${email.toEmail.split("@")[0]}`;

  const handleRowClick = () => {
    navigate(`/emails/${email.id}`);
  };

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStar(email.id, email.isStarred);
  };

  const isFailed = email.status === "FAILED";

  return (
    <div
      onClick={handleRowClick}
      className="group flex items-center gap-3.5 px-3 py-2.5 h-[42px] border-b border-[#F0F1F2] hover:bg-[#F9FAFB] cursor-pointer transition-colors text-xs select-none"
    >
      {/* Recipient */}
      <div className="w-[130px] shrink-0 font-medium text-[#111827] truncate">
        {recipientLabel}
      </div>

      {/* Status Badge */}
      <div className="shrink-0">
        {view === "scheduled" ? (
          <Badge variant="scheduled" timestamp={email.plannedAt || email.scheduledAt} />
        ) : isFailed ? (
          <Badge variant="failed" label="Failed" />
        ) : (
          <Badge variant="sent" label="Sent" />
        )}
      </div>

      {/* Subject + Snippet */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
        <span className="font-semibold text-[#111827] shrink-0 max-w-[300px] truncate">
          {email.subject}
        </span>
        {email.snippet && (
          <span className="text-[#6B7280] truncate font-normal">
            - {email.snippet}
          </span>
        )}
      </div>

      {/* Sent View Timestamp */}
      {view === "sent" && email.sentAt && (
        <span className="shrink-0 text-xs text-[#9CA3AF] font-medium tabular-nums">
          {formatSentTimestamp(email.sentAt)}
        </span>
      )}

      {/* Preview Button in Sent View */}
      {view === "sent" && (
        <a
          href={email.previewUrl || `/api/emails/${email.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open Ethereal Preview"
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EAF6EE] hover:bg-[#00A63E] text-[#00A63E] hover:text-white text-[11px] font-semibold transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          <span>Preview</span>
        </a>
      )}

      {/* Star Action */}
      <button
        type="button"
        onClick={handleStarClick}
        title={email.isStarred ? "Unstar" : "Star"}
        className="shrink-0 p-1 text-[#D1D5DB] hover:text-[#F59E0B] focus:outline-none transition-colors"
      >
        <Star
          className={cn(
            "w-4 h-4 transition-transform active:scale-125",
            email.isStarred ? "fill-[#F59E0B] text-[#F59E0B]" : "group-hover:text-[#9CA3AF]"
          )}
        />
      </button>
    </div>
  );
};
