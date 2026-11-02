import { FileText, Presentation } from "lucide-react";
import { messages } from "../messages";
import { fileSizeText } from "../model";
import type { Attachment } from "../model";

/**
 * 画像・動画以外(PPTX・PDF・テキスト等)はファイルカード。
 * Discordの署名付きURLへ直接ダウンロードできる。
 */
export function FileAttachment({
  attachment,
  url,
}: {
  attachment: Attachment;
  url: string | null;
}) {
  const isPresentation = attachment.contentType.includes("presentationml");
  const Icon = isPresentation ? Presentation : FileText;
  return (
    <div className="file-attachment">
      <span className="file-attachment-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <span className="file-attachment-body">
        <span className="file-attachment-name">{attachment.filename}</span>
        <span className="file-attachment-size">
          {fileSizeText(attachment.sizeBytes)}
        </span>
      </span>
      {url && (
        <a
          className="button button-secondary download-button"
          href={url}
          download={attachment.filename}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={messages.attachment.downloadLabel(attachment.filename)}
        >
          {messages.attachment.download}
        </a>
      )}
    </div>
  );
}
