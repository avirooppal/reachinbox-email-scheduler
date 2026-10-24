import React, { useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Paperclip, ChevronDown, Plus } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { api } from "../../lib/api";
import { RecipientInput, Recipient } from "./RecipientInput";
import { SendLaterPopover } from "./SendLaterPopover";
import { RichEditor } from "./RichEditor";
import { AttachmentPreview, AttachmentItem } from "./AttachmentPreview";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";
import { toast } from "sonner";

export const ComposePage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedSenderId, setSelectedSenderId] = useState<string>("auto");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delaySec, setDelaySec] = useState<string>("02");
  const [hourlyLimit, setHourlyLimit] = useState<string>("200");
  const [sendAt, setSendAt] = useState<Date | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  const fileAttachmentRef = useRef<HTMLInputElement>(null);

  // Fetch user senders
  const { data: sendersData } = useQuery({
    queryKey: ["senders"],
    queryFn: api.senders.list
  });
  const senders = sendersData?.senders || [];

  // Add Ethereal sender mutation
  const addEtherealMutation = useMutation({
    mutationFn: () => api.senders.createEthereal(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["senders"] });
      setSelectedSenderId(data.sender.id);
      toast.success(`Ethereal test sender created: ${data.sender.fromEmail}`);
    },
    onError: (err: Error) => {
      toast.error(`Failed to create test sender: ${err.message}`);
    }
  });

  // Schedule campaign mutation
  const scheduleMutation = useMutation({
    mutationFn: api.campaigns.schedule,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      queryClient.invalidateQueries({ queryKey: ["emails", "counts"] });
      toast.success(
        sendAt
          ? `Campaign scheduled for ${sendAt.toLocaleTimeString()} (${res.accepted} emails)`
          : `Campaign started! ${res.accepted} emails enqueued`
      );
      navigate(sendAt ? "/scheduled" : "/sent");
    },
    onError: (err: Error) => {
      toast.error(`Failed to schedule campaign: ${err.message}`);
    }
  });

  // Handle file attachment selection
  const handleAttachmentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploadingFiles(true);
    try {
      const res = await api.attachments.upload(files);
      const newItems: AttachmentItem[] = res.attachments.map((att) => ({
        id: att.id,
        name: att.filename,
        size: att.sizeBytes,
        type: att.mimeType,
        url: api.attachments.url(att.id)
      }));

      setAttachments((prev) => [...prev, ...newItems]);
      setAttachmentIds((prev) => [...prev, ...res.attachments.map((a) => a.id)]);
      toast.success(`${files.length} file(s) attached`);
    } catch (err: any) {
      toast.error(err.message || "Failed to upload attachments");
    } finally {
      setIsUploadingFiles(false);
      if (fileAttachmentRef.current) fileAttachmentRef.current.value = "";
    }
  };

  const handleRemoveAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
    setAttachmentIds((prev) => prev.filter((_, i) => i !== idx));
  };

  // CSV Recipient Upload
  const handleUploadCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const newRecipients = [...recipients];

      for (const line of lines) {
        // Simple comma or space separation
        const parts = line.split(/[,\t]/).map((p) => p.replace(/["']/g, "").trim());
        const email = parts.find((p) => emailRegex.test(p)) || parts[0];
        const name = parts.find((p) => p !== email);

        if (email && !newRecipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
          newRecipients.push({
            email,
            name: name || undefined,
            isValid: emailRegex.test(email)
          });
        }
      }

      setRecipients(newRecipients);
      toast.success(`Loaded ${newRecipients.length} recipients from CSV`);
    };
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (recipients.length === 0) {
      toast.error("Please add at least one recipient");
      return;
    }

    const invalidRecipients = recipients.filter((r) => !r.isValid);
    if (invalidRecipients.length > 0) {
      toast.error(`Please fix or remove ${invalidRecipients.length} invalid email address(es)`);
      return;
    }

    if (!subject.trim()) {
      toast.error("Please enter an email subject");
      return;
    }

    if (!body.trim()) {
      toast.error("Please compose your email body");
      return;
    }

    const delayMs = Math.max(0, parseInt(delaySec, 10) * 1000 || 2000);
    const limit = Math.max(1, parseInt(hourlyLimit, 10) || 200);

    scheduleMutation.mutate({
      subject,
      body,
      startAt: sendAt ? sendAt.toISOString() : undefined,
      senderId: selectedSenderId === "auto" ? undefined : selectedSenderId,
      delayMs,
      hourlyLimit: limit,
      attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      recipients: recipients.map((r) => ({
        email: r.email,
        name: r.name
      }))
    });
  };

  const selectedSenderObj = senders.find((s) => s.id === selectedSenderId);
  const selectedSenderLabel =
    selectedSenderId === "auto"
      ? "Auto (rotate across all senders)"
      : selectedSenderObj
      ? `${selectedSenderObj.fromEmail}`
      : "Select Sender";

  const hasAttachments = attachments.length > 0;
  const isSendLater = sendAt !== null;

  return (
    <div className="flex flex-col flex-1 w-full max-w-4xl mx-auto py-3">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[#F0F1F2]">
        <div className="flex items-center gap-3">
          <Link
            to="/scheduled"
            className="p-1 rounded-full text-[#6B7280] hover:text-[#111827] hover:bg-[#F4F5F6] transition-colors"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2]" />
          </Link>
          <h1 className="text-xl font-bold text-[#111827]">Compose New Email</h1>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Attachment Paperclip Button */}
          <input
            ref={fileAttachmentRef}
            type="file"
            multiple
            onChange={handleAttachmentSelect}
            className="hidden"
          />
          <button
            type="button"
            title="Attach Files"
            onClick={() => fileAttachmentRef.current?.click()}
            disabled={isUploadingFiles}
            className={cn(
              "relative w-9 h-9 rounded-full flex items-center justify-center transition-all focus:outline-none",
              hasAttachments
                ? "bg-[#EAF6EE] text-[#00A63E] border border-[#00A63E]"
                : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F4F5F6]"
            )}
          >
            <Paperclip className="w-4 h-4 stroke-[2]" />
            {hasAttachments && (
              <span className="absolute -top-1 -right-1 text-[10px] font-bold bg-[#00A63E] text-white w-4 h-4 rounded-full flex items-center justify-center">
                {attachments.length}
              </span>
            )}
          </button>

          {/* Send Later Popover Trigger */}
          <SendLaterPopover sendAt={sendAt} onSelect={setSendAt} />

          {/* Send / Send Later Button */}
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleSubmit}
            isLoading={scheduleMutation.isPending}
            className="h-9 px-5 text-xs font-semibold"
          >
            {isSendLater ? "Send Later" : "Send"}
          </Button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="flex flex-col gap-3 pt-4">
        {/* From Row */}
        <div className="flex items-center gap-4 py-2 border-b border-[#F0F1F2]">
          <span className="text-xs text-[#6B7280] font-medium w-12">From</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F4F5F6] hover:bg-[#ECEEED] text-xs font-medium text-[#111827] transition-colors focus:outline-none"
              >
                <span>{selectedSenderLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-50 min-w-[260px] bg-white rounded-xl shadow-lg border border-[#E5E7EB] p-1.5 animate-in fade-in-50 text-xs select-none"
              >
                <DropdownMenu.Item
                  onClick={() => setSelectedSenderId("auto")}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors",
                    selectedSenderId === "auto" ? "bg-[#EAF6EE] text-[#00A63E] font-semibold" : "hover:bg-[#F4F5F6]"
                  )}
                >
                  <span>Auto (rotate across all senders)</span>
                </DropdownMenu.Item>

                {senders.map((s) => (
                  <DropdownMenu.Item
                    key={s.id}
                    onClick={() => setSelectedSenderId(s.id)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors",
                      selectedSenderId === s.id ? "bg-[#EAF6EE] text-[#00A63E] font-semibold" : "hover:bg-[#F4F5F6]"
                    )}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-[#111827]">{s.fromEmail}</span>
                      <span className="text-[10px] text-[#6B7280]">{s.name}</span>
                    </div>
                  </DropdownMenu.Item>
                ))}

                <DropdownMenu.Separator className="h-px bg-[#F3F4F6] my-1" />

                <DropdownMenu.Item
                  onClick={() => addEtherealMutation.mutate()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-[#00A63E] font-medium outline-none hover:bg-[#EAF6EE] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>+ Add Ethereal sender</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        {/* To Row */}
        <RecipientInput
          recipients={recipients}
          onChange={setRecipients}
          onUploadCsv={handleUploadCsv}
        />

        {/* Subject Row */}
        <div className="flex items-center gap-4 py-2 border-b border-[#F0F1F2]">
          <span className="text-xs text-[#6B7280] font-medium w-12">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 bg-transparent text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none border-none py-1"
          />
        </div>

        {/* Delay & Hourly Limit Row */}
        <div className="flex items-center gap-6 py-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#6B7280] font-medium">Delay between 2 emails</span>
            <input
              type="number"
              value={delaySec}
              onChange={(e) => setDelaySec(e.target.value)}
              placeholder="00"
              className="w-14 h-9 bg-[#F4F5F6] text-center text-xs font-semibold text-[#111827] rounded-xl outline-none focus:ring-1 focus:ring-[#00A63E]"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-[#6B7280] font-medium">Hourly Limit</span>
            <input
              type="number"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              placeholder="00"
              className="w-14 h-9 bg-[#F4F5F6] text-center text-xs font-semibold text-[#111827] rounded-xl outline-none focus:ring-1 focus:ring-[#00A63E]"
            />
          </div>
        </div>

        {/* TipTap Rich Text Editor */}
        <div className="mt-2">
          <RichEditor content={body} onChange={setBody} />
        </div>

        {/* Attachment Previews */}
        <AttachmentPreview
          attachments={attachments}
          onRemove={handleRemoveAttachment}
        />
      </div>
    </div>
  );
};
