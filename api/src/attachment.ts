/**
 * 添付ファイルの検証。拡張子だけで判定せず、MIMEタイプと実際の内容
 * (マジックナンバー)を確認する。上限は Vercel Functions の 4.5MB リクエスト
 * 本文制限に余裕を持たせるため 3MiB、1リクエストにつき1ファイル。
 */

export const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;
/** 一度に選択できるファイルの上限。複数は1リクエストずつ逐次アップロードする。 */
export const MAX_FILES_PER_PICK = 5;
/** ひとつのTODO(TODO単位とメモ単位の合計)に添付できる上限。 */
export const MAX_ATTACHMENTS_PER_TODO = 50;

export type AttachmentCategory = "image" | "video" | "file";

export interface AttachmentFormat {
  /** 受け付ける拡張子(小文字)。 */
  readonly ext: string;
  readonly contentType: string;
  readonly category: AttachmentCategory;
}

const FORMATS: readonly AttachmentFormat[] = [
  { ext: "jpg", contentType: "image/jpeg", category: "image" },
  { ext: "jpeg", contentType: "image/jpeg", category: "image" },
  { ext: "png", contentType: "image/png", category: "image" },
  { ext: "webp", contentType: "image/webp", category: "image" },
  { ext: "gif", contentType: "image/gif", category: "image" },
  { ext: "mp4", contentType: "video/mp4", category: "video" },
  { ext: "webm", contentType: "video/webm", category: "video" },
  { ext: "mov", contentType: "video/quicktime", category: "video" },
  {
    ext: "pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    category: "file",
  },
  { ext: "pdf", contentType: "application/pdf", category: "file" },
  { ext: "txt", contentType: "text/plain", category: "file" },
];

export const findFormat = (filename: string): AttachmentFormat | null => {
  const base = filename.split(/[\\/]/).at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{2,10}$/.test(ext)) return null;
  return FORMATS.find((format) => format.ext === ext) ?? null;
};

export type AttachmentErrorCode =
  "no-file" | "unknown-format" | "too-large" | "empty" | "content-mismatch";

export class AttachmentValidationError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export interface VerifiedFile {
  readonly filename: string;
  /** 正規化後のMIME。ブラウザの宣言ではなく拡張子に対応した既知の値。 */
  readonly contentType: string;
  readonly category: AttachmentCategory;
}

/**
 * ブラウザから受け取った1ファイルを検証する。拡張子・宣言MIME・マジック
 * ナンバー・容量のすべてを確かめ、失敗は AttachmentValidationError に寄せる。
 */
export async function verifyAttachment(
  filename: string,
  declaredType: string,
  file: Blob,
): Promise<VerifiedFile> {
  const format = findFormat(filename);
  if (!format)
    throw new AttachmentValidationError(
      "unknown-format",
      "unsupported file extension",
    );
  if (declaredType) {
    const [declaredFamily] = declaredType.split("/");
    const [expectedFamily] = format.contentType.split("/");
    if (declaredFamily !== expectedFamily)
      throw new AttachmentValidationError(
        "content-mismatch",
        "declared content type does not match the extension",
      );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0)
    throw new AttachmentValidationError("empty", "file is empty");
  if (bytes.length > MAX_FILE_SIZE_BYTES)
    throw new AttachmentValidationError(
      "too-large",
      "file size exceeds the limit",
    );
  assertSignature(bytes, format);
  return {
    filename,
    contentType: format.contentType,
    category: format.category,
  };
}

/**
 * 実際の中身が宣言された形式と一致するかを確かめる。
 * PPTX は ZIP コンテナなので、ZIP で終わらずエントリ(ppt/presentation.xml)の
 * 出現まで確認する。
 */
function assertSignature(bytes: Uint8Array, format: AttachmentFormat): void {
  const type = format.contentType;
  const mismatch = (message: string) =>
    new AttachmentValidationError("content-mismatch", message);
  if (type === "image/jpeg") {
    if (!matchBytes(bytes, [0xff, 0xd8, 0xff]))
      throw mismatch("content does not match a JPEG image");
    return;
  }
  if (type === "image/png") {
    if (!matchBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      throw mismatch("content does not match a PNG image");
    return;
  }
  if (type === "image/gif") {
    if (!matchAscii(bytes, "GIF87a") && !matchAscii(bytes, "GIF89a"))
      throw mismatch("content does not match a GIF image");
    return;
  }
  if (type === "image/webp") {
    if (!matchAscii(bytes, "RIFF") || !matchAscii(bytes.slice(8), "WEBP"))
      throw mismatch("content does not match a WebP image");
    return;
  }
  if (type === "video/webm") {
    if (!matchBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
      throw mismatch("content does not match a WebM video");
    return;
  }
  if (type === "video/mp4" || type === "video/quicktime") {
    if (!matchAscii(bytes.slice(4), "ftyp"))
      throw mismatch("content does not match an MP4/MOV video");
    const brand = ascii(bytes.slice(8), 4);
    const ok =
      type === "video/quicktime"
        ? brand.startsWith("qt")
        : /^(isom|iso2|mp41|mp42|avc1)/.test(brand);
    if (!ok) throw mismatch("content is not the declared MP4/MOV brand");
    return;
  }
  if (type === "application/pdf") {
    if (!matchAscii(bytes, "%PDF-"))
      throw mismatch("content does not match a PDF document");
    return;
  }
  if (type.includes("presentationml")) {
    if (
      !matchBytes(bytes, [0x50, 0x4b]) ||
      !containsAscii(bytes, "ppt/presentation.xml", 4096)
    )
      throw mismatch("content is not a PowerPoint presentation");
    return;
  }
  // TXT は UTF-8 として完全にデコードできるときだけ認める。
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw mismatch("content is not text");
  }
}

const matchBytes = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, index) => bytes[index] === byte);

const matchAscii = (bytes: Uint8Array, text: string): boolean => {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1)
    if (bytes[index] !== text.charCodeAt(index)) return false;
  return true;
};

const ascii = (bytes: Uint8Array, length: number): string =>
  String.fromCharCode(...bytes.slice(0, length));

const containsAscii = (
  bytes: Uint8Array,
  text: string,
  limit: number,
): boolean => ascii(bytes, limit).includes(text);
