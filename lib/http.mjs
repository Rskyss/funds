// HTTP 层通用小工具：带状态码的错误、客户端 IP、静态目录路径守卫、恒定时间字符串比较。
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

/** 带 HTTP 状态码的错误：顶层 catch 会按 status 返回 message；非 HttpError 一律 500 + 通用文案。 */
export class HttpError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.name = "HttpError";
    this.status = Number(status) || 500;
    this.extra = extra && typeof extra === "object" ? extra : null;
  }
}

/** 取客户端 IP：服务只监听回环、由 Nginx 反代，因此信任 X-Forwarded-For 的第一段。 */
export function clientIp(req) {
  const xff = String(req?.headers?.["x-forwarded-for"] || "");
  const first = xff.split(",")[0].trim();
  if (first) return first;
  const addr = String(req?.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return addr || "unknown";
}

/** 请求是否直接来自本机（没有经过反代）：用于本地 cron 触发刷新等免 token 场景。 */
export function isLoopbackDirect(req) {
  if (req?.headers?.["x-forwarded-for"]) return false;
  const addr = String(req?.socket?.remoteAddress || "");
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/**
 * 把 URL 路径解析成 public 目录内的绝对路径；任何越界（../、编码的 ..%2f、NUL）返回 null。
 * 修复点：旧实现用 startsWith(PUBLIC_DIR) 判断，"public_legacy" 这类同前缀的兄弟目录会被放行。
 */
export function resolvePublicPath(publicDir, urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname || "/");
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = path.resolve(publicDir);
  const abs = path.resolve(root, rel);
  if (abs === root) return path.join(root, "index.html");
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 恒定时间比较两个字符串（口令 / token），避免逐字节早退的时序侧信道。 */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** 校验 UUID 形态（会话 id 由客户端回传，只接受合法 UUID）。 */
export function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
