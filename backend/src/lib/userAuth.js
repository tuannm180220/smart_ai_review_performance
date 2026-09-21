import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query, isMultiTenant, newUserId } from "../db/pool.js";
import { runWithContext } from "./requestContext.js";
import { hydrateConfig } from "../config/configStore.js";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

function sessionSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_SESSION_SECRET || "dev-user-session-secret";
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(payload) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function allowRegister() {
  return process.env.ALLOW_REGISTER !== "false";
}

export async function registerUser(email, password) {
  if (!isMultiTenant()) {
    const err = new Error("Registration requires DATABASE_URL (PostgreSQL multi-tenant)");
    err.status = 503;
    throw err;
  }
  if (!allowRegister()) {
    const err = new Error("Registration is disabled");
    err.status = 403;
    throw err;
  }
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !password || String(password).length < 8) {
    const err = new Error("Email and password (min 8 characters) are required");
    err.status = 400;
    throw err;
  }
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const id = newUserId();
  try {
    const result = await query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, created_at`,
      [id, normalized, passwordHash]
    );
    const user = result.rows[0];
    await query(`INSERT INTO user_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [user.id]);
    return { id: user.id, email: user.email };
  } catch (err) {
    if (err.code === "23505" || /UNIQUE constraint failed/i.test(err.message)) {
      const e = new Error("An account with this email already exists");
      e.status = 409;
      throw e;
    }
    throw err;
  }
}

export async function authenticateUser(email, password) {
  if (!isMultiTenant()) {
    const err = new Error("Login requires multi-tenant mode");
    err.status = 503;
    throw err;
  }
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !password) return null;
  const result = await query(`SELECT id, email, password_hash FROM users WHERE email = $1`, [normalized]);
  const row = result.rows[0];
  if (!row) return null;
  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return null;
  return { id: row.id, email: row.email };
}

export function createUserToken(user) {
  const payload = JSON.stringify({
    sub: user.id,
    email: user.email,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const encodedPayload = Buffer.from(payload, "utf-8").toString("base64url");
  const signature = sign(encodedPayload);
  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };
}

export function verifyUserToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  if (!timingSafeStringEqual(signature, sign(encodedPayload))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp || !payload.sub) return null;
  return { id: payload.sub, email: payload.email };
}

export function requireUserAuth(req, res, next) {
  if (!isMultiTenant()) {
    return next();
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = verifyUserToken(token);
  if (!user) {
    return res.status(401).json({ error: { message: "Authentication required", code: "UNAUTHORIZED" } });
  }
  req.user = user;
  runWithContext({ userId: user.id, email: user.email }, () => {
    hydrateConfig()
      .then(() => next())
      .catch(next);
  });
}
