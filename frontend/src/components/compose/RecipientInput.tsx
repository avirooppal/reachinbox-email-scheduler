import React, { useState, useRef, KeyboardEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Upload } from "lucide-react";
import { Chip } from "../ui/Chip";

export interface Recipient {
  email: string;
  name?: string;
  isValid: boolean;
}

export interface RecipientInputProps {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  onUploadCsv: (file: File) => void;
  disabled?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RecipientInput: React.FC<RecipientInputProps> = ({
  recipients,
  onChange,
  onUploadCsv,
  disabled = false
}) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addEmails = (rawText: string) => {
    const tokens = rawText
      .split(/[,;\s\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) return;

    const newRecipients = [...recipients];
    for (const token of tokens) {
      // Check if already added
      if (!newRecipients.some((r) => r.email.toLowerCase() === token.toLowerCase())) {
        newRecipients.push({
          email: token,
          isValid: EMAIL_REGEX.test(token)
        });
      }
    }

    onChange(newRecipients);
    setInputValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", ";", " "].includes(e.key)) {
      e.preventDefault();
      if (inputValue.trim()) {
        addEmails(inputValue);
      }
    } else if (e.key === "Backspace" && !inputValue && recipients.length > 0) {
      e.preventDefault();
      onChange(recipients.slice(0, -1));
    }
  };

  const handleRemove = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadCsv(file);
      e.target.value = "";
    }
  };

  // Show max 3 chips inline, then "+N"
  const visibleChips = recipients.slice(0, 3);
  const extraCount = recipients.length - 3;

  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-[#F0F1F2] min-h-[44px]">
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-[#6B7280] font-medium w-12">To</span>
      </div>

      <div
        onClick={() => inputRef.current?.focus()}
        className="flex-1 flex flex-wrap items-center gap-1.5 cursor-text min-h-[32px]"
      >
        {visibleChips.map((r, i) => (
          <Chip
            key={`${r.email}-${i}`}
            label={r.email}
            isValid={r.isValid}
            onRemove={() => handleRemove(i)}
          />
        ))}

        {extraCount > 0 && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border border-[#00A63E] text-[#00A63E] bg-[#EAF6EE] hover:bg-[#D3EFDD] transition-colors"
              >
                +{extraCount}
              </button>
            </Popover.Trigger>

            <Popover.Portal>
              <Popover.Content
                align="start"
                sideOffset={6}
                className="z-50 w-72 max-h-60 overflow-y-auto bg-white rounded-xl shadow-lg border border-[#E5E7EB] p-3 animate-in fade-in-50 text-xs"
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#F3F4F6]">
                  <span className="font-semibold text-[#111827]">
                    All Recipients ({recipients.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="text-[11px] text-[#DC2626] hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recipients.map((r, idx) => (
                    <Chip
                      key={`${r.email}-${idx}`}
                      label={r.email}
                      isValid={r.isValid}
                      onRemove={() => handleRemove(idx)}
                    />
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}

        <input
          ref={inputRef}
          type="text"
          data-testid="recipient-input"
          value={inputValue}
          disabled={disabled}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) addEmails(inputValue);
          }}
          placeholder={recipients.length === 0 ? "recipient@example.com" : ""}
          className="flex-1 min-w-[160px] bg-transparent text-sm text-[#111827] placeholder:text-[#9CA3AF] outline-none border-none py-1"
        />
      </div>

      {/* Upload List Button */}
      <div className="shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00A63E] hover:text-[#008f35] px-2.5 py-1.5 rounded-lg hover:bg-[#EAF6EE] transition-colors"
        >
          <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Upload List</span>
        </button>
      </div>
    </div>
  );
};
