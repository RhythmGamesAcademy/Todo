import { describe, expect, it } from "vitest";
import {
  AttachmentValidationError,
  MAX_FILE_SIZE_BYTES,
  verifyAttachment,
} from "./attachment.js";

const buildFile = (
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  type = "",
): File => new File([bytes], name, { type });

const ascii = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([...text].map((char) => char.charCodeAt(0)));

// TXTなどマルチバイト文字の中身はUTF-8として符号化する。
const utf8 = (text: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  try {
    await promise;
    expect.unreachable("検証が通ってしまった");
  } catch (error) {
    expect(error).toBeInstanceOf(AttachmentValidationError);
    expect((error as AttachmentValidationError).code).toBe(code);
  }
};

describe("添付ファイルの検証", () => {
  it("PNG・JPEG・GIF・WebP画像を受け付ける", async () => {
    await expect(
      verifyAttachment("a.png", "image/png", buildFile("a.png", PNG_HEADER)),
    ).resolves.toMatchObject({ contentType: "image/png", category: "image" });
    await expect(
      verifyAttachment(
        "b.jpg",
        "image/jpeg",
        buildFile("b.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
      ),
    ).resolves.toMatchObject({ contentType: "image/jpeg" });
    await expect(
      verifyAttachment("c.gif", "", buildFile("c.gif", ascii("GIF89a"))),
    ).resolves.toMatchObject({ contentType: "image/gif" });
    await expect(
      verifyAttachment(
        "d.webp",
        "image/webp",
        buildFile(
          "d.webp",
          Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]),
        ),
      ),
    ).resolves.toMatchObject({ contentType: "image/webp" });
  });

  it("宣言されたMIMEが拡張子と家族違いなら拒否する", async () => {
    await expectCode(
      verifyAttachment("a.png", "video/mp4", buildFile("a.png", PNG_HEADER)),
      "content-mismatch",
    );
  });

  it("MP4・MOV・WebM動画を受け付ける", async () => {
    const mp4 = Uint8Array.from([
      0,
      0,
      0,
      24,
      ...ascii("ftyp"),
      ...ascii("isom"),
      0,
      0,
      2,
      0,
    ]);
    await expect(
      verifyAttachment("v.mp4", "video/mp4", buildFile("v.mp4", mp4)),
    ).resolves.toMatchObject({ contentType: "video/mp4", category: "video" });
    const mov = Uint8Array.from([
      0,
      0,
      0,
      24,
      ...ascii("ftyp"),
      ...ascii("qt  "),
      0,
      0,
      2,
      0,
    ]);
    await expect(
      verifyAttachment("v.mov", "", buildFile("v.mov", mov)),
    ).resolves.toMatchObject({ contentType: "video/quicktime" });
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
    await expect(
      verifyAttachment("v.webm", "video/webm", buildFile("v.webm", webm)),
    ).resolves.toMatchObject({ contentType: "video/webm" });
  });

  it("PDF・テキスト形式を受け付ける", async () => {
    await expect(
      verifyAttachment("d.pdf", "", buildFile("d.pdf", ascii("%PDF-1.7"))),
    ).resolves.toMatchObject({ contentType: "application/pdf" });
    // テキスト形式はUTF-8として解釈できる中身が条件。text/plain で
    //カテゴリ "text" になりインラインプレビューの対象になる。
    await expect(
      verifyAttachment("d.txt", "text/plain", buildFile("d.txt", utf8("メモ"))),
    ).resolves.toMatchObject({ contentType: "text/plain", category: "text" });
    await expect(
      verifyAttachment("b.md", "text/markdown", buildFile("b.md", utf8("# 案"))),
    ).resolves.toMatchObject({ category: "text" });
    await expect(
      verifyAttachment(
        "j.json",
        "application/json",
        buildFile("j.json", utf8('{"a":1}')),
      ),
    ).resolves.toMatchObject({ contentType: "text/plain", category: "text" });
    await expect(
      verifyAttachment(
        "s.xml",
        "application/xml",
        buildFile("s.xml", utf8("<a><b/></a>")),
      ),
    ).resolves.toMatchObject({ category: "text" });
    await expect(
      verifyAttachment(
        "c.csv",
        "text/csv",
        buildFile("c.csv", utf8("id,title\n" + "1,設計\n")),
      ),
    ).resolves.toMatchObject({ category: "text" });
  });

  it("PPTXはZIPに加えてプレゼンテーション本体のエントリも確認する", async () => {
    const pptx = Uint8Array.from([
      ...ascii("PK\x03\x04"),
      ...new Array(400).fill(0),
      ...ascii("ppt/presentation.xml"),
    ]);
    await expect(
      verifyAttachment("s.pptx", "", buildFile("s.pptx", pptx)),
    ).resolves.toMatchObject({
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    // ZIPのままPPTXではないもの(DOCXなど)は拒否する。
    const zip = Uint8Array.from([
      ...ascii("PK\x03\x04"),
      ...new Array(200).fill(0),
    ]);
    await expectCode(
      verifyAttachment("notes.pptx", "", buildFile("notes.pptx", zip)),
      "content-mismatch",
    );
  });

  it("未知の拡張子でも添付できる。宣言MIMEは安全な形に正規化する", async () => {
    // DOCXなど中身を検証できない形式は容量・MIME正規化だけで受け付ける。
    await expect(
      verifyAttachment("a.docx", "", buildFile("a.docx", ascii("PK\x03\x04"))),
    ).resolves.toMatchObject({
      contentType: "application/octet-stream",
      category: "file",
    });
    await expect(
      verifyAttachment(
        "noext",
        "image/png",
        buildFile("noext", PNG_HEADER),
      ),
    ).resolves.toMatchObject({ contentType: "image/png", category: "file" });
    // 危険な表示になり得る宣言は無害なフォールバックへ寄せる。
    await expect(
      verifyAttachment(
        "x.page",
        "text/html; charset=utf-8",
        buildFile("x.page", ascii("<h1>")),
      ),
    ).resolves.toMatchObject({ contentType: "application/octet-stream" });
  });

  it("テキスト形式の中身がUTF-8でないならcontent-mismatch", async () => {
    // テキストとして解釈できないTXT。
    await expectCode(
      verifyAttachment(
        "a.txt",
        "",
        buildFile("a.txt", Uint8Array.from([0xff, 0xfe, 0x00, 0x81])),
      ),
      "content-mismatch",
    );
  });

  it("拡張子と一致しない中身はcontent-mismatch", async () => {
    const fakePng = Uint8Array.from([0x00, 0x01, 0x02, 0x03]);
    await expectCode(
      verifyAttachment("fake.png", "", buildFile("fake.png", fakePng)),
      "content-mismatch",
    );
  });

  it("空ファイルと3MiB超過を拒否する", async () => {
    await expectCode(
      verifyAttachment(
        "empty.png",
        "",
        buildFile("empty.png", new Uint8Array(0)),
      ),
      "empty",
    );
    const oversized = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
    oversized.set(PNG_HEADER);
    await expectCode(
      verifyAttachment("big.png", "", buildFile("big.png", oversized)),
      "too-large",
    );
  });
});
