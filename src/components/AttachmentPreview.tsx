import { useEffect, useState } from "react";
import { Film, FileText, Presentation, X } from "lucide-react";
import { messages } from "../messages";
import { attachmentCategory } from "../model";

/**
 * 選択中ファイルのサムネイル付きプレビュー。まだアップロード前の File。
 * 画像は objectURL でその場表示し、動画・それ以外はアイコンで示す。
 */
export function AttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove?: () => void;
}) {
  const category = attachmentCategory(file.name, file.type);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (category !== "image") return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, category]);
  const icon =
    category === "video" ? <Film size={22} /> : attachmentPresetIcon(file.name);
  return (
    <span className="attachment-preview">
      {url ? (
        <img
          src={url}
          alt={messages.attachment.thumbnail(file.name)}
          className="attachment-preview-thumb"
        />
      ) : (
        <span className="attachment-preview-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="attachment-preview-name">{file.name}</span>
      <span className="attachment-preview-type">{file.type}</span>
      {onRemove && (
        <button
          type="button"
          className="icon-button tag-remove"
          aria-label={messages.attachment.removeLabel(file.name)}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}

function attachmentPresetIcon(filename: string) {
  if (filename.toLowerCase().endsWith(".pptx"))
    return <Presentation size={22} />;
  return <FileText size={22} />;
}
