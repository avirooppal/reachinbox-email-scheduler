import React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface ChipProps {
  label: string;
  isValid?: boolean;
  onRemove?: () => void;
  className?: string;
  onClick?: () => void;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  isValid = true,
  onRemove,
  className,
  onClick
}) => {
  return (
    <span
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all select-none",
        isValid
          ? "border border-[#00A63E] text-[#00A63E] bg-[#EAF6EE]/40 hover:bg-[#EAF6EE]"
          : "border border-[#DC2626] text-[#DC2626] bg-[#FEE2E2]/40 hover:bg-[#FEE2E2]",
        onClick && "cursor-pointer",
        className
      )}
    >
      <span className="truncate max-w-[200px]">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-75 focus:outline-none"
        >
          <X className="w-3 h-3 stroke-[2.5]" />
        </button>
      )}
    </span>
  );
};
