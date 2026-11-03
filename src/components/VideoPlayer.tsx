import { messages } from "../messages";

/**
 * 動画は再生ボタン付きのプレイヤーで表示する(MOVはfile扱いで対象外)。
 * メタデータだけ先に読み、実際の再生は署名付きURLから行う。
 */
export function VideoPlayer({
  url,
  filename,
}: {
  url: string;
  filename: string;
}) {
  return (
    <video
      className="attachment-video"
      src={url}
      controls
      preload="metadata"
      aria-label={messages.attachment.videoLabel(filename)}
    />
  );
}
