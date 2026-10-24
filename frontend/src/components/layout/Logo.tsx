import React from "react";
import { cn } from "../../lib/utils";

export interface LogoProps {
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
  return (
    <div className={cn("flex items-center gap-2 select-none", className)}>
      <span className="font-pixel text-2xl font-bold tracking-wider text-[#111827]">
        ONB
      </span>
    </div>
  );
};
