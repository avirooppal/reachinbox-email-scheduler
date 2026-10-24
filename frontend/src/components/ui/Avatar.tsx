import React from "react";
import { cn } from "../../lib/utils";

export interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name = "User",
  size = "md",
  className
}) => {
  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base"
  };

  const initial = name ? name.trim().charAt(0).toUpperCase() : "U";

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "rounded-full object-cover shrink-0 border border-black/5",
          sizeClasses[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full bg-[#00A63E] text-white flex items-center justify-center font-medium shrink-0",
        sizeClasses[size],
        className
      )}
    >
      {initial}
    </div>
  );
};
