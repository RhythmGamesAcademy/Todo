import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectStorage {
  put(params: { key: string; contentType: string; body: Blob }): Promise<void>;
  signedUrl(params: { key: string; contentType: string }): Promise<string>;
  delete(key: string): Promise<void>;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put({
    key,
    contentType,
    body,
  }: {
    key: string;
    contentType: string;
    body: Blob;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: new Uint8Array(await body.arrayBuffer()),
        ContentType: contentType,
      }),
    );
  }

  async signedUrl({
    key,
    contentType,
  }: {
    key: string;
    contentType: string;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
      }),
      { expiresIn: 900 },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

export function makeObjectStorageFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage | null {
  const endpoint = env.NEON_STORAGE_ENDPOINT?.trim() ?? "";
  const bucket = env.NEON_STORAGE_BUCKET?.trim() ?? "";
  const accessKeyId = env.NEON_STORAGE_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.NEON_STORAGE_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return new S3ObjectStorage(
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    env.NEON_STORAGE_REGION?.trim() || "us-east-1",
  );
}
