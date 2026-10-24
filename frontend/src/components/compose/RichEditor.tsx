import React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import {
  Undo,
  Redo,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Quote,
  Code,
  Strikethrough,
  Heading1,
  Heading2,
  Pilcrow
} from "lucide-react";
import { cn } from "../../lib/utils";

export interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export const RichEditor: React.FC<RichEditorProps> = ({
  content,
  onChange,
  placeholder = "Type Your Reply...",
  className
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"]
      })
    ],
    content,
    editorProps: {
      attributes: {
        class: "prose max-w-none text-sm text-[#111827] outline-none min-h-[160px] p-4",
        "data-placeholder": placeholder
      }
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    }
  });

  if (!editor) return null;

  return (
    <div className={cn("rounded-2xl bg-[#F9FAFB] border border-[#F0F1F2] overflow-hidden", className)}>
      {/* Editor Content Area */}
      <EditorContent editor={editor} />

      {/* Floating Toolbar matching design */}
      <div className="flex items-center justify-center p-2.5 bg-transparent border-t border-[#F0F1F2]/60">
        <div className="flex items-center gap-1 bg-white px-3 py-1.5 rounded-full shadow-sm border border-[#E5E7EB] text-[#4B5563]">
          {/* Undo / Redo */}
          <button
            type="button"
            title="Undo"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            className="p-1 rounded hover:bg-[#F4F5F6] disabled:opacity-30"
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Redo"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            className="p-1 rounded hover:bg-[#F4F5F6] disabled:opacity-30"
          >
            <Redo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

          {/* Heading toggle */}
          <button
            type="button"
            title="Paragraph"
            onClick={() => editor.chain().focus().setParagraph().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("paragraph") && "text-[#00A63E] font-bold")}
          >
            <Pilcrow className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Heading 1"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("heading", { level: 1 }) && "text-[#00A63E] font-bold")}
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Heading 2"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("heading", { level: 2 }) && "text-[#00A63E] font-bold")}
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

          {/* Bold, Italic, Underline */}
          <button
            type="button"
            title="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("bold") && "text-[#00A63E] bg-[#EAF6EE]")}
          >
            <Bold className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
          <button
            type="button"
            title="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("italic") && "text-[#00A63E] bg-[#EAF6EE]")}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("underline") && "text-[#00A63E] bg-[#EAF6EE]")}
          >
            <UnderlineIcon className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

          {/* Text Alignment */}
          <button
            type="button"
            title="Align Left"
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive({ textAlign: "left" }) && "text-[#00A63E]")}
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Align Center"
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive({ textAlign: "center" }) && "text-[#00A63E]")}
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Align Right"
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive({ textAlign: "right" }) && "text-[#00A63E]")}
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

          {/* Lists & Quotes */}
          <button
            type="button"
            title="Numbered List"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("orderedList") && "text-[#00A63E]")}
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Bullet List"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("bulletList") && "text-[#00A63E]")}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Blockquote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("blockquote") && "text-[#00A63E]")}
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Code Block"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("codeBlock") && "text-[#00A63E]")}
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Strikethrough"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={cn("p-1 rounded hover:bg-[#F4F5F6]", editor.isActive("strike") && "text-[#00A63E]")}
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
