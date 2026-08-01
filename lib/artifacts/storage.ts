import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AwsClient } from "aws4fetch";

export type ArtifactPutResult = { reused: boolean };

export interface ArtifactObjectStore {
  readonly backend: "s3" | "filesystem";
  put(key: string, bytes: Uint8Array, contentType: string, contentHash: string): Promise<ArtifactPutResult>;
  get(key: string): Promise<Uint8Array>;
}

type ArtifactStorageConfig =
  | { configured: true; backend: "s3"; endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }
  | { configured: true; backend: "filesystem"; path: string }
  | { configured: false; backend: "unconfigured" };

class FileArtifactStore implements ArtifactObjectStore {
  readonly backend = "filesystem" as const;
  constructor(private readonly root: string) {}

  private path(key: string) { return resolve(this.root, key); }

  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key);
    try {
      await stat(path);
      return { reused: true };
    } catch {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      return { reused: false };
    }
  }

  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
}

class S3ArtifactStore implements ArtifactObjectStore {
  readonly backend = "s3" as const;
  private readonly client: AwsClient;
  private bucketReady: Promise<void> | null = null;

  constructor(
    private readonly bucket: string,
    private readonly endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region });
  }

  private url(key?: string) {
    const base = this.endpoint.replace(/\/+$/, "");
    const objectPath = key?.split("/").map(encodeURIComponent).join("/");
    return objectPath ? `${base}/${encodeURIComponent(this.bucket)}/${objectPath}` : `${base}/${encodeURIComponent(this.bucket)}`;
  }

  private async assertOk(response: Response, operation: string) {
    if (response.ok) return;
    const detail = (await response.text()).trim();
    throw new Error(`${operation} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }

  private ensureBucket() {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const existing = await this.client.fetch(this.url(), { method: "HEAD" });
        if (existing.ok) return;
        if (existing.status !== 404) await this.assertOk(existing, "Artifact bucket check");
        const created = await this.client.fetch(this.url(), { method: "PUT" });
        if (!created.ok && created.status !== 409) await this.assertOk(created, "Artifact bucket creation");
      })();
    }
    return this.bucketReady;
  }

  async put(key: string, bytes: Uint8Array, contentType: string, contentHash: string) {
    await this.ensureBucket();
    const url = this.url(key);
    const existing = await this.client.fetch(url, { method: "HEAD" });
    if (existing.ok) return { reused: true };
    if (existing.status !== 404) await this.assertOk(existing, "Artifact object check");
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stored = await this.client.fetch(url, {
      method: "PUT",
      body,
      headers: { "Content-Type": contentType, "X-Amz-Meta-Content-Sha256": contentHash },
    });
    await this.assertOk(stored, "Artifact upload");
    return { reused: false };
  }

  async get(key: string) {
    await this.ensureBucket();
    const response = await this.client.fetch(this.url(key));
    await this.assertOk(response, "Artifact download");
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function artifactStorageConfig(): ArtifactStorageConfig {
  const endpoint = process.env.ARTIFACT_STORAGE_ENDPOINT?.trim();
  if (endpoint) {
    return {
      configured: true,
      backend: "s3" as const,
      endpoint,
      bucket: process.env.ARTIFACT_STORAGE_BUCKET?.trim() || "ai-infra-source-artifacts",
      region: process.env.ARTIFACT_STORAGE_REGION?.trim() || "us-east-1",
      accessKeyId: process.env.ARTIFACT_STORAGE_ACCESS_KEY?.trim() || "ai_infra",
      secretAccessKey: process.env.ARTIFACT_STORAGE_SECRET_KEY?.trim() || "ai_infra_artifacts",
    };
  }
  const configuredPath = process.env.ARTIFACT_STORAGE_PATH?.trim();
  const developmentPath = process.env.NODE_ENV !== "production" ? (process.env.E2E_TEST === "1" ? ".artifacts/e2e" : ".artifacts") : "";
  const path = configuredPath || developmentPath;
  return path
    ? { configured: true, backend: "filesystem" as const, path }
    : { configured: false, backend: "unconfigured" as const };
}

export function getArtifactObjectStore(): ArtifactObjectStore {
  const config = artifactStorageConfig();
  if (!config.configured) throw new Error("Artifact storage is not configured. Set ARTIFACT_STORAGE_ENDPOINT or ARTIFACT_STORAGE_PATH.");
  return config.backend === "s3"
    ? new S3ArtifactStore(config.bucket, config.endpoint, config.region, config.accessKeyId, config.secretAccessKey)
    : new FileArtifactStore(config.path);
}

export function assertArtifactStorageReady(options: { durable?: boolean } = {}) {
  const config = artifactStorageConfig();
  if (!config.configured) throw new Error("Artifact storage is not configured. Set ARTIFACT_STORAGE_ENDPOINT or ARTIFACT_STORAGE_PATH.");
  if (options.durable && config.backend !== "s3") {
    throw new Error("Durable research ingestion requires S3-compatible artifact storage. Filesystem storage is development-only.");
  }
  return config;
}
