import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Clock, Calendar as CalendarIcon, Check } from "lucide-react";
import { addDays, setHours, setMinutes, setSeconds, format } from "date-fns";
import { cn } from "../../lib/utils";

export interface SendLaterPopoverProps {
  sendAt: Date | null;
  onSelect: (date: Date | null) => void;
}

export const SendLaterPopover: React.FC<SendLaterPopoverProps> = ({
  sendAt,
  onSelect
}) => {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState(
    sendAt ? format(sendAt, "yyyy-MM-dd'T'HH:mm") : ""
  );

  const tomorrow = addDays(new Date(), 1);

  const quickOptions = [
    {
      label: "Tomorrow, 9:00 AM",
      date: setSeconds(setMinutes(setHours(tomorrow, 9), 0), 0)
    },
    {
      label: "Tomorrow, 10:00 AM",
      date: setSeconds(setMinutes(setHours(tomorrow, 10), 0), 0)
    },
    {
      label: "Tomorrow, 11:00 AM",
      date: setSeconds(setMinutes(setHours(tomorrow, 11), 0), 0)
    },
    {
      label: "Tomorrow, 3:00 PM",
      date: setSeconds(setMinutes(setHours(tomorrow, 15), 0), 0)
    }
  ];

  const handleApplyQuick = (date: Date) => {
    onSelect(date);
    setOpen(false);
  };

  const handleApplyCustom = () => {
    if (customInput) {
      const parsed = new Date(customInput);
      if (!isNaN(parsed.getTime())) {
        onSelect(parsed);
      }
    }
    setOpen(false);
  };

  const handleCancel = () => {
    onSelect(null);
    setOpen(false);
  };

  const hasScheduledTime = sendAt !== null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Send Later"
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center transition-all focus:outline-none",
            hasScheduledTime
              ? "bg-[#EAF6EE] text-[#00A63E] border border-[#00A63E]"
              : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F4F5F6]"
          )}
        >
          <Clock className="w-4 h-4 stroke-[2]" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] p-4 animate-in fade-in-50 zoom-in-95 text-xs select-none"
        >
          {/* Custom Date Input */}
          <div className="relative mb-3">
            <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
            <input
              type="datetime-local"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              className="w-full bg-[#F4F5F6] text-[#111827] text-xs rounded-xl pl-9 pr-3 py-2 outline-none border border-transparent focus:border-[#00A63E] focus:bg-white"
            />
          </div>

          {/* Quick Preset Options */}
          <div className="flex flex-col gap-1 mb-4">
            {quickOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleApplyQuick(opt.date)}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F4F5F6] transition-colors"
              >
                <span>{opt.label}</span>
                {sendAt && Math.abs(sendAt.getTime() - opt.date.getTime()) < 60000 && (
                  <Check className="w-3.5 h-3.5 text-[#00A63E]" />
                )}
              </button>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F0F1F2]">
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-[#6B7280] hover:text-[#111827] hover:bg-[#F4F5F6] transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleApplyCustom}
              className="px-4 py-1.5 rounded-full text-xs font-medium bg-[#00A63E] text-white hover:bg-[#009236] transition-all"
            >
              Done
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
