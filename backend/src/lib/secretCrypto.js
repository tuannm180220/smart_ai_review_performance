import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey() {
  const hex = process.env.CONFIG_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "CONFIG_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt plaintext to `iv:tag:ciphertext` (all base64url). Empty string stays empty. */
export function encryptSecret(plaintext) {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(packed) {
  if (!packed) return "";
  const parts = String(packed).split(":");
  if (parts.length !== 3) return "";
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    // Wrong CONFIG_ENCRYPTION_KEY or corrupt ciphertext — treat as unset.
    return "";
  }
}
