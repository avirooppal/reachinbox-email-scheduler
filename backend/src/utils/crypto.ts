import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Returns a 32-byte Buffer derived from ENCRYPTION_KEY.
 */
function getKey(): Buffer {
  return crypto.scryptSync(env.ENCRYPTION_KEY, "email-scheduler-salt", 32);
}

/**
 * Encrypts plaintext string using AES-256-GCM.
 * Output format: iv:tag:ciphertext (hex encoded)
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM ciphertext formatted as iv:tag:ciphertext.
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivHex, tagHex, contentHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(tagHex!, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(contentHex!, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
