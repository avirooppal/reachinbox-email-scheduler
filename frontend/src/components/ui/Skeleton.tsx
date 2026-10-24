import React from "react";
import { cn } from "../../lib/utils";

export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[#F4F5F6]", className)}
      {...props}
    />
  );
};

export const EmailRowSkeleton: React.FC = () => {
  return (
    <div className="flex items-center gap-3.5 px-3 py-2.5 h-[42px] border-b border-[#F0F1F2]">
      <Skeleton className="w-[120px] h-3.5" />
      <Skeleton className="w-[100px] h-5 rounded-full" />
      <Skeleton className="flex-1 h-3.5" />
      <Skeleton className="w-4 h-4 rounded-full" />
    </div>
  );
};
