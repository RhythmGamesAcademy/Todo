import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { AlertCircle, ClipboardPaste, Upload, X } from "lucide-react";
import { messages } from "../messages";
import { MAX_ATTACHMENTS_PER_PICK, attachmentFileError } from "../model";

export type UploadState = "pending" | "uploading" | "done" | "error";

export interface QueuedFile {
  id: string;
  file: File;
  state: UploadState;
  error?: string;
}

// サーバーが受け付ける既知の拡張子(attachment.ts の FORMATS)に、
// その他のテキスト・ファイル形式を足した最小限の目安(選択ダイアログの絞り
// 込み)。未対応拡張子でも任意のファイルを添付可能なため、見えない場合は
// 「すべてのファイル」に切り替えても送れる。
const ACCEPTANCE =
  ".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov,.pptx,.pdf," +
  ".txt,.md,.csv,.tsv,.xml,.json,.yaml,.yml,.ini,.log,.srt,.vtt";

/**
 * TODO単位の添付アップローダー。ファイル選択・複数選択・ドラッグ＆ドロップ・
 * クリップボード貼り付けに対応する。選んだファイルは1リクエスト1ファイルで
 * 順番に送り(Vercel Functionsの4.5MB制限を避けるため)、失敗したファイルだけ
 * 再試行できる。送信前に選択から外すこともできる。
 */
export function AttachmentUploader({
  upload,
  disabled = false,
}: {
  /** アップロード1件。完了まで逐次の対象は先に進めない。 */
  upload: (file: File) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [pickError, setPickError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // アップロード中フラグ。複数の送信を同時に起こさないための参照を保持する。
  const uploadingRef = useRef(false);
  const queueRef = useRef<QueuedFile[]>([]);
  queueRef.current = queue;

  const update = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setQueue((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const addFiles = useCallback((chosen: readonly File[]) => {
    setPickError("");
    const active = queueRef.current.filter(
      (item) => item.state === "pending" || item.state === "uploading",
    );
    const remaining = MAX_ATTACHMENTS_PER_PICK - active.length;
    if (chosen.length > remaining) {
      setPickError(messages.attachment.maxPick);
      return;
    }
    const appended = chosen.map((file) => ({
      id: crypto.randomUUID(),
      file,
      state: "pending" as UploadState,
      error: attachmentFileError(file) ?? undefined,
    }));
    setQueue((items) => [...items, ...appended]);
  }, []);

  // pending(検証エラーの無いもの)を先頭から1件ずつ送る。
  useEffect(() => {
    if (uploadingRef.current || disabled) return;
    const next = queue.find(
      (item) => item.state === "pending" && item.error === undefined,
    );
    if (!next) return;
    uploadingRef.current = true;
    update(next.id, { state: "uploading", error: undefined });
    void (async () => {
      try {
        await upload(next.file);
        update(next.id, { state: "done", error: undefined });
      } catch {
        update(next.id, { state: "error", error: messages.attachment.failed });
      } finally {
        uploadingRef.current = false;
        // 状態表示とキューのリング更新を確実にして、次の1件を起こす。
        setQueue((items) => [...items]);
      }
    })();
  }, [queue, upload, disabled, update]);

  // クリップボード貼り付け(スクリーンショット等の画像を含む)。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const retry = (item: QueuedFile) => {
    const problem = attachmentFileError(item.file);
    if (problem) {
      update(item.id, { state: "error", error: problem });
      return;
    }
    update(item.id, { state: "pending", error: undefined });
  };
  const cancel = (id: string) =>
    setQueue((items) => items.filter((item) => item.id !== id));
  const clearDone = () =>
    setQueue((items) => items.filter((item) => item.state !== "done"));

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (disabled) return;
    addFiles([...event.dataTransfer.files]);
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles([...(event.target.files ?? [])]);
    event.target.value = "";
  };

  const doneCount = queue.filter((item) => item.state === "done").length;

  return (
    <div
      className={
        "attachment-uploader" +
        (dragOver ? " drag-over" : "") +
        (disabled ? " is-disabled" : "")
      }
      // D&D時のブラウザ既定(ページ遷移・別タブ表示)を止める。
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTANCE}
        className="sr-only"
        id="attachment-file-input"
        aria-label={messages.attachment.chooseLabel}
        onChange={onChange}
      />
      <div className="attachment-uploader-row">
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          aria-label={messages.attachment.addLabel}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} />
          {messages.attachment.add}
        </button>
        <span className="attachment-dropzone-hint">
          <ClipboardPaste size={14} />
          {messages.attachment.dropzone}
        </span>
        {doneCount > 0 && (
          <button
            type="button"
            className="button button-secondary"
            onClick={clearDone}
          >
            {messages.attachment.clearDone}
          </button>
        )}
      </div>
      {queue.length > 0 && (
        <span className="attachment-pick-count" aria-live="polite">
          {messages.attachment.pickCount(
            queue.length,
            MAX_ATTACHMENTS_PER_PICK,
          )}
        </span>
      )}
      {pickError && (
        <p className="form-error" role="alert">
          <AlertCircle size={15} />
          {pickError}
        </p>
      )}
      {queue.length > 0 && (
        <ul className="upload-queue">
          {queue.map((item) => (
            <li key={item.id} className={"upload-item upload-" + item.state}>
              <span className="upload-item-name">{item.file.name}</span>
              <span className="upload-item-state">
                {item.error ??
                  (item.state === "uploading"
                    ? messages.attachment.uploading
                    : item.state === "done"
                      ? messages.attachment.uploadDone
                      : messages.attachment.pending)}
              </span>
              {(item.state === "error" || item.error) && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={disabled}
                  onClick={() => retry(item)}
                >
                  <AlertCircle size={14} />
                  {messages.attachment.uploadRetry}
                </button>
              )}
              {item.state !== "uploading" && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={messages.attachment.removeLabel(item.file.name)}
                  onClick={() => cancel(item.id)}
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
