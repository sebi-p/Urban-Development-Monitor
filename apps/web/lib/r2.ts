import "server-only";
import { AwsClient } from "aws4fetch";

/**
 * Read-only access to the private R2 bucket for the admin audit viewer (M5.2, ADR 0019): the
 * mirrored PDFs, served only to signed-in reviewers. Uses a read-only token (R2_ENDPOINT,
 * R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY); the public site never reads R2.
 */
let client: AwsClient | null = null;

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  );
}

/** The object at `key`, or null when it doesn't exist or R2 isn't configured. */
export async function r2Get(key: string): Promise<Response | null> {
  if (!r2Configured()) return null;
  client ??= new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const base = process.env.R2_ENDPOINT!.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  const res = await client.fetch(`${base}/${process.env.R2_BUCKET}/${path}`);
  return res.ok ? res : null;
}
