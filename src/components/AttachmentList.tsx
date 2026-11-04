import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Download, Trash2 } from "lucide-react";
import { messages } from "../messages";
import { attachmentCategory, dateText, fileSizeText } from "../model";
import type { Attachment } from "../model";
import { VideoPlayer } from "./VideoPlayer";

/**
 * 添付一覧。署名付きURLは永続保存しないため、表示のたびにAPIから引き直す。
 * 画像はクリックで拡大、動画(mp4/webm)はプレイヤー、テキストはインライン
 * プレビュー、それ以外はダウンロード中心のファイルカード。
 */
export function useAttachmentUrl(
  attachment: Attachment,
  resolver: (attachmentId: string) => Promise<string>,
): { url: string | null; failed: boolean; retry: () => void } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  useEffect(() => {
    let cancelled = false;
    resolver(attachment.id)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, resolver, attempt]);
  return { url, failed, retry };
}

/**
 * テキスト添付の中身を署名付きURLから取得して表示用に整形する。
 * 長い本文は先頭を切り出す(全文はダウンロードで確認できる)。
 */
function useTextPreview(
  category: string,
  url: string | null,
): { content: string | null; truncated: boolean } {
  const [state, setState] = useState<{ content: string | null; truncated: boolean }>({
    content: null,
    truncated: false,
  });
  useEffect(() => {
    if (category !== "text" || !url) {
      setState({ content: null, truncated: false });
      return;
    }
    let cancelled = false;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("text preview fetch failed");
        const full = await response.text();
        if (cancelled) return;
        setState({
          content: full.slice(0, TEXT_PREVIEW_MAX_LENGTH),
          truncated: full.length > TEXT_PREVIEW_MAX_LENGTH,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ content: null, truncated: false });
      });
    return () => {
      cancelled = true;
    };
  }, [category, url]);
  return state;
}

const TEXT_PREVIEW_MAX_LENGTH = 4000;

function AttachmentItem({
  attachment,
  resolver,
  onDelete,
}: {
  attachment: Attachment;
  resolver: (attachmentId: string) => Promise<string>;
  onDelete?: (attachment: Attachment) => void;
}) {
  const { url, failed, retry } = useAttachmentUrl(attachment, resolver);
  const category = attachmentCategory(
    attachment.filename,
    attachment.contentType,
  );
  const preview = useTextPreview(category, url);
  const [zoomed, setZoomed] = useState(false);
  return (
    <li className="attachment-item">
      <div className="attachment-media">
        {category === "image" && url && (
          <button
            type="button"
            className="attachment-zoom"
            aria-label={messages.attachment.previewLabel(attachment.filename)}
            onClick={() => setZoomed(true)}
          >
            <img
              src={url}
              alt={messages.attachment.thumbnail(attachment.filename)}
              className="attachment-thumb"
              loading="lazy"
            />
          </button>
        )}
        {category === "video" && url && (
          <VideoPlayer url={url} filename={attachment.filename} />
        )}
        {category === "text" && (
          <div className="file-attachment">
            <span className="file-attachment-body">
              <span className="file-attachment-name">
                {attachment.filename}
              </span>
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
                aria-label={messages.attachment.downloadLabel(
                  attachment.filename,
                )}
              >
                <Download size={15} />
                {messages.attachment.download}
              </a>
            )}
          </div>
        )}
        {category === "text" && preview.content !== null && (
          <>
            <pre
              className="attachment-text-preview"
              aria-label={messages.attachment.textPreview(attachment.filename)}
            >
              {preview.content}
            </pre>
            {preview.truncated && (
              <span className="attachment-text-note">
                {messages.attachment.textTruncated}
              </span>
            )}
          </>
        )}
        {category === "file" && (
          <div className="file-attachment">
            <span className="file-attachment-body">
              <span className="file-attachment-name">
                {attachment.filename}
              </span>
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
                aria-label={messages.attachment.downloadLabel(
                  attachment.filename,
                )}
              >
                <Download size={15} />
                {messages.attachment.download}
              </a>
            )}
          </div>
        )}
        {failed && (
          <div className="attachment-failed" role="alert">
            <AlertCircle size={16} />
            <span>{messages.attachment.loadFailed}</span>
            <button
              type="button"
              className="button button-secondary"
              onClick={retry}
            >
              {messages.common.retry}
            </button>
          </div>
        )}
      </div>
      <div className="attachment-meta">
        <span className="attachment-name" title={attachment.filename}>
          {attachment.filename}
        </span>
        <span className="attachment-info">
          {fileSizeText(attachment.sizeBytes)}・
          {dateText(attachment.createdAt, true)}
        </span>
        {onDelete && (
          <button
            type="button"
            className="icon-button danger-icon attachment-remove"
            aria-label={messages.attachment.deleteTitle}
            onClick={() => onDelete(attachment)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {zoomed && url && (
        <div
          className="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(false)}
        >
          <img
            src={url}
            alt={messages.attachment.previewLabel(attachment.filename)}
            className="attachment-lightbox-image"
          />
        </div>
      )}
    </li>
  );
}

export function AttachmentList({
  attachments,
  resolver,
  onDelete,
}: {
  attachments: readonly Attachment[];
  resolver: (attachmentId: string) => Promise<string>;
  onDelete?: (attachment: Attachment) => void;
}) {
  if (attachments.length === 0)
    return <p className="attachment-empty">{messages.attachment.empty}</p>;
  return (
    <ul className="attachment-grid">
      {attachments.map((attachment) => (
        <AttachmentItem
          key={attachment.id}
          attachment={attachment}
          resolver={resolver}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

/** メモ(タイムライン内)の添付は小さめのサムネ行。 */
export function NoteAttachments({
  attachments,
  resolver,
}: {
  attachments: readonly Attachment[];
  resolver: (attachmentId: string) => Promise<string>;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="note-attachment-row">
      {attachments.map((attachment) => (
        <AttachmentItem
          key={attachment.id}
          attachment={attachment}
          resolver={resolver}
        />
      ))}
    </ul>
  );
}
