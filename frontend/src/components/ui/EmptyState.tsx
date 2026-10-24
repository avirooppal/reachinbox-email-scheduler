import React from "react";
import { Link } from "react-router-dom";
import { Mail, Plus } from "lucide-react";
import { Button } from "./Button";

export interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  actionLink?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionText = "Compose New Email",
  actionLink = "/compose"
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center select-none animate-in fade-in-50">
      <div className="w-14 h-14 rounded-full bg-[#EAF6EE] text-[#00A63E] flex items-center justify-center mb-4">
        <Mail className="w-6 h-6 stroke-[1.8]" />
      </div>
      <h3 className="text-base font-semibold text-[#111827] mb-1">{title}</h3>
      <p className="text-xs text-[#6B7280] max-w-sm mb-6">{description}</p>
      {actionLink && (
        <Link to={actionLink}>
          <Button variant="outline" size="md" className="gap-1.5">
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{actionText}</span>
          </Button>
        </Link>
      )}
    </div>
  );
};
