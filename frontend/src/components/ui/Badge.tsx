import React from "react";
import { Clock } from "lucide-react";
import { cn, formatScheduledBadge } from "../../lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant: "scheduled" | "sent" | "failed";
  timestamp?: string | Date;
  label?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  variant,
  timestamp,
  label,
  className,
  ...props
}) => {
  if (variant === "scheduled") {
    const formatted = timestamp ? formatScheduledBadge(timestamp) : label || "Scheduled";
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFF3E5] text-[#D9480F] border border-[#FFE8CC]",
          className
        )}
        {...props}
      >
        <Clock className="w-3 h-3 text-[#F08C00]" />
        <span>{formatted}</span>
      </span>
    );
  }

  if (variant === "failed") {
    return (
      <span
        className={cn(
          "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#DC2626] border border-[#FCA5A5]",
          className
        )}
        {...props}
      >
        {label || "Failed"}
      </span>
    );
  }

  // Sent badge
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]",
        className
      )}
      {...props}
    >
      {label || "Sent"}
    </span>
  );
};
