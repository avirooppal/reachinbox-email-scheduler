import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Star,
  Archive,
  Trash2,
  ChevronDown,
  Download,
  FileText,
  ExternalLink
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { api } from "../../lib/api";
import { Avatar } from "../ui/Avatar";
import { TimelineView } from "./TimelineView";
import { formatSentTimestamp, formatBytes, cn } from "../../lib/utils";
import { toast } from "sonner";

export const EmailDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["emails", id],
    queryFn: () => api.emails.get(id!),
    enabled: Boolean(id)
  });

  const email = data?.email;

  const starMutation = useMutation({
    mutationFn: (isStarred: boolean) => api.emails.toggleStar(id!, isStarred),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails", id] });
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.emails.delete(id!),
    onSuccess: (res) => {
      toast.success(res.message || "Email removed");
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      queryClient.invalidateQueries({ queryKey: ["emails", "counts"] });
      navigate(-1);
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`);
    }
  });

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 max-w-4xl mx-auto py-12 items-center justify-center text-sm text-[#6B7280]">
        Loading email...
      </div>
    );
  }

  if (isError || !email) {
    return (
      <div className="flex flex-col flex-1 max-w-4xl mx-auto py-12 items-center justify-center gap-3">
        <p className="text-sm font-medium text-[#DC2626]">Email not found</p>
        <Link to="/scheduled" className="text-xs text-[#00A63E] hover:underline">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const senderName = email.sender?.name || "Amanda Clark";
  const senderEmail = email.sender?.fromEmail || "sender@example.com";
  const recipientName = email.toName || "me";
  const displayTime = email.sentAt || email.plannedAt || email.createdAt;

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto py-3 select-none">
      {/* Top Header Row */}
      <div className="flex items-center justify-between pb-4 border-b border-[#F0F1F2]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 rounded-full text-[#6B7280] hover:text-[#111827] hover:bg-[#F4F5F6] transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2]" />
          </button>
          <h1 className="text-lg font-bold text-[#111827] truncate">
            {email.subject}
          </h1>
        </div>

        {/* Action Icons */}
        <div className="flex items-center gap-2 shrink-0 text-[#6B7280]">
          {/* Ethereal Preview Button */}
          <a
            href={email.previewUrl || `/api/emails/${email.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Ethereal Preview"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#EAF6EE] hover:bg-[#00A63E] text-[#00A63E] hover:text-white text-xs font-semibold transition-all shadow-sm"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Preview</span>
          </a>

          <button
            type="button"
            title={email.isStarred ? "Unstar" : "Star"}
            onClick={() => starMutation.mutate(!email.isStarred)}
            className="p-2 rounded-full hover:bg-[#F4F5F6] hover:text-[#111827] transition-colors"
          >
            <Star
              className={cn(
                "w-4 h-4 transition-transform active:scale-125",
                email.isStarred && "fill-[#F59E0B] text-[#F59E0B]"
              )}
            />
          </button>

          <button
            type="button"
            title="Archive"
            onClick={() => {
              toast.success("Email archived");
              navigate(-1);
            }}
            className="p-2 rounded-full hover:bg-[#F4F5F6] hover:text-[#111827] transition-colors"
          >
            <Archive className="w-4 h-4" />
          </button>

          <button
            type="button"
            title={email.status === "SCHEDULED" ? "Cancel Scheduled Send" : "Delete"}
            onClick={() => {
              if (window.confirm("Are you sure you want to remove this email?")) {
                deleteMutation.mutate();
              }
            }}
            className="p-2 rounded-full hover:bg-[#FEE2E2]/60 hover:text-[#DC2626] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

          {/* User profile avatar thumbnail */}
          <a
            href={email.previewUrl || `/api/emails/${email.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Ethereal Preview"
            className="cursor-pointer transition-transform hover:scale-110"
          >
            <Avatar name={senderName} size="sm" />
          </a>
        </div>
      </div>

      {/* Sender Row matching 06-email-detail.png */}
      <div className="flex items-start justify-between py-4">
        <div className="flex items-start gap-3">
          {/* Green circle letter avatar */}
          <div className="w-9 h-9 rounded-full bg-[#00A63E] text-white flex items-center justify-center font-bold text-sm shrink-0">
            {senderName.charAt(0).toUpperCase()}
          </div>

          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-sm text-[#111827]">{senderName}</span>
              <span className="text-xs text-[#6B7280]">&lt;{senderEmail}&gt;</span>
            </div>

            {/* "to me" dropdown */}
            <Popover.Root open={detailsOpen} onOpenChange={setDetailsOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#111827] mt-0.5 focus:outline-none"
                >
                  <span>to {recipientName}</span>
                  <ChevronDown className="w-3 h-3 text-[#9CA3AF]" />
                </button>
              </Popover.Trigger>

              <Popover.Portal>
                <Popover.Content
                  align="start"
                  sideOffset={4}
                  className="z-50 w-80 bg-white rounded-xl shadow-lg border border-[#E5E7EB] p-3 text-xs animate-in fade-in-50"
                >
                  <div className="grid grid-cols-[60px_1fr] gap-1.5 text-[#6B7280]">
                    <span className="font-semibold text-[#111827]">From:</span>
                    <span>{senderName} &lt;{senderEmail}&gt;</span>
                    <span className="font-semibold text-[#111827]">To:</span>
                    <span>{email.toEmail}</span>
                    <span className="font-semibold text-[#111827]">Date:</span>
                    <span>{new Date(displayTime).toLocaleString()}</span>
                    <span className="font-semibold text-[#111827]">Subject:</span>
                    <span className="text-[#111827]">{email.subject}</span>
                    {email.messageId && (
                      <>
                        <span className="font-semibold text-[#111827]">Message-ID:</span>
                        <span className="font-mono text-[10px] break-all">{email.messageId}</span>
                      </>
                    )}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>

        {/* Right Timestamp */}
        <span className="text-xs text-[#6B7280] font-medium shrink-0 pt-1">
          {formatSentTimestamp(displayTime)}
        </span>
      </div>

      {/* Email Body Content */}
      <div className="py-4 text-sm text-[#111827] leading-relaxed">
        <div
          className="prose max-w-none [&_blockquote]:border-l-4 [&_blockquote]:border-[#00A63E] [&_blockquote]:pl-4 [&_blockquote]:italic"
          dangerouslySetInnerHTML={{ __html: email.body }}
        />
      </div>

      {/* Attachments Section */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="pt-6 border-t border-[#F0F1F2]">
          <p className="text-xs font-semibold text-[#6B7280] mb-3">
            Attachments ({email.attachments.length})
          </p>
          <div className="flex flex-wrap gap-3">
            {email.attachments.map((att) => {
              const isImage = att.mimeType.startsWith("image/");
              const downloadUrl = api.attachments.url(att.id);

              return (
                <a
                  key={att.id}
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={att.filename}
                  className="group w-44 rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-sm hover:shadow transition-shadow block"
                >
                  <div className="h-24 w-full bg-[#F4F5F6] flex items-center justify-center overflow-hidden">
                    {isImage ? (
                      <img
                        src={downloadUrl}
                        alt={att.filename}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <FileText className="w-8 h-8 text-[#9CA3AF]" />
                    )}
                  </div>
                  <div className="p-2.5 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#111827] truncate" title={att.filename}>
                        {att.filename}
                      </p>
                      <p className="text-[11px] text-[#6B7280]">
                        {formatBytes(att.sizeBytes)}
                      </p>
                    </div>
                    <Download className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#00A63E] transition-colors shrink-0 ml-1" />
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Delivery Timeline View */}
      <TimelineView emailId={email.id} />
    </div>
  );
};
