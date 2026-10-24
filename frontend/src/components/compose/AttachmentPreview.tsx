import React from "react";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { formatBytes } from "../../lib/utils";

export interface AttachmentItem {
  id?: string;
  name: string;
  size: number;
  type: string;
  url?: string;
}

export interface AttachmentPreviewProps {
  attachments: AttachmentItem[];
  onRemove?: (index: number) => void;
  readOnly?: boolean;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  onRemove,
  readOnly = false
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mt-4">
      {attachments.map((file, idx) => {
        const isImage = file.type.startsWith("image/");
        return (
          <div
            key={file.id || `${file.name}-${idx}`}
            className="relative group w-44 rounded-xl border border-[#E5E7EB] bg-white overflow-hidden shadow-sm hover:shadow transition-shadow select-none"
          >
            {/* Thumbnail */}
            <div className="h-24 w-full bg-[#F4F5F6] flex items-center justify-center overflow-hidden">
              {isImage && file.url ? (
                <img
                  src={file.url}
                  alt={file.name}
                  className="w-full h-full object-cover"
                />
              ) : isImage ? (
                <ImageIcon className="w-8 h-8 text-[#9CA3AF]" />
              ) : (
                <FileText className="w-8 h-8 text-[#9CA3AF]" />
              )}
            </div>

            {/* Info */}
            <div className="p-2.5">
              <p className="text-xs font-semibold text-[#111827] truncate" title={file.name}>
                {file.name}
              </p>
              <p className="text-[11px] text-[#6B7280] font-medium">
                {formatBytes(file.size)}
              </p>
            </div>

            {/* Remove Action */}
            {!readOnly && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black transition-colors"
              >
                <X className="w-3 h-3 stroke-[2.5]" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
