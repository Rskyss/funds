import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey() {
  const hex = process.env.AI_KEY_SECRET;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("AI_KEY_SECRET 未配置或格式不对（需 64 位 hex / 32 字节）");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decryptSecret(blob) {
  const [ivHex, tagHex, dataHex] = String(blob || "").split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("密文格式不正确");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return dec.toString("utf8");
}

export function maskSecret(plain) {
  const s = String(plain || "");
  if (s.length <= 8) return "****";
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}
