import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  allowRegister,
  authenticateUser,
  createUserToken,
  registerUser,
  requireUserAuth,
} from "../lib/userAuth.js";
import { isMultiTenant } from "../db/pool.js";

const router = Router();

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX = 20;

function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    entry = { start: now, count: 0 };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX) {
    return res.status(429).json({ error: { message: "Too many login attempts. Try again shortly." } });
  }
  next();
}

router.get("/auth/status", (req, res) => {
  res.json({
    multiTenant: isMultiTenant(),
    allowRegister: isMultiTenant() && allowRegister(),
  });
});

router.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await registerUser(email, password);
    const { token, expiresAt } = createUserToken(user);
    res.status(201).json({ token, email: user.email, expiresAt, userId: user.id });
  })
);

router.post(
  "/auth/login",
  rateLimitLogin,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await authenticateUser(email, password);
    if (!user) {
      return res.status(401).json({ error: { message: "Invalid email or password" } });
    }
    const { token, expiresAt } = createUserToken(user);
    res.json({ token, email: user.email, expiresAt, userId: user.id });
  })
);

router.get(
  "/auth/me",
  requireUserAuth,
  asyncHandler(async (req, res) => {
    if (!isMultiTenant()) {
      return res.json({ multiTenant: false, user: null });
    }
    res.json({ multiTenant: true, user: { id: req.user.id, email: req.user.email } });
  })
);

export default router;
