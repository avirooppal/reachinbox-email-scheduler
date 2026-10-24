import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { AuthService } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { createAuthRateLimiter } from "./rate-limiter.js";

export const authRouter = Router();

const authRateLimiter = createAuthRateLimiter({ windowSeconds: 60, maxRequests: 10 });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

/**
 * Register with email and password
 */
authRouter.post("/register", authRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid registration data", details: parseResult.error.format() });
    }

    const { email, password, name } = parseResult.data;
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = hashPassword(password);
    const displayName = name?.trim() || normalizedEmail.split("@")[0] || "User";

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: displayName
      }
    });

    const token = AuthService.signToken({
      userId: user.id,
      email: user.email,
      name: user.name
    });

    res.cookie("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl
      },
      token
    });
  } catch (err) {
    req.log?.error?.({ err }, "Registration error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to create account" });
  }
});

/**
 * Login with email and password
 */
authRouter.post("/login", authRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid login credentials", details: parseResult.error.format() });
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = AuthService.signToken({
      userId: user.id,
      email: user.email,
      name: user.name
    });

    res.cookie("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl
      },
      token
    });
  } catch (err) {
    req.log?.error?.({ err }, "Login error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to authenticate" });
  }
});

// In-memory or cookie-backed state store for CSRF protection
const stateStore = new Set<string>();

/**
 * Initiates Google OAuth Code Flow.
 */
authRouter.get("/google", (req: Request, res: Response) => {
  const { url, state } = AuthService.getGoogleAuthUrl();
  stateStore.add(state);

  // Expire state after 10 minutes
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  const isSecure = env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: 10 * 60 * 1000
  });

  return res.redirect(url);
});

/**
 * Google OAuth Callback.
 */
authRouter.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    const savedState = req.cookies?.oauth_state;

    if (!code || !state) {
      req.log?.warn("Google OAuth callback missing code or state");
      return res.status(400).json({ error: "Invalid OAuth state or missing code" });
    }

    let isValid = false;
    try {
      jwt.verify(state, env.JWT_SECRET);
      isValid = true;
    } catch {
      if (stateStore.has(state) || (savedState && savedState === state)) {
        isValid = true;
      }
    }

    if (!isValid) {
      req.log?.warn({ state, savedState }, "Google OAuth callback invalid state");
      return res.status(400).json({ error: "Invalid OAuth state or missing code" });
    }

    stateStore.delete(state);
    res.clearCookie("oauth_state");

    const profile = await AuthService.exchangeCodeForGoogleUser(code);
    const user = await AuthService.upsertGoogleUser(profile);

    const token = AuthService.signToken({
      userId: user.id,
      email: user.email,
      name: user.name
    });

    const isSecure = env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";

    res.cookie("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.redirect(`${env.FRONTEND_URL}/scheduled`);
  } catch (err) {
    req.log?.error({ err }, "Google OAuth callback error");
    return res.status(500).json({ error: "Failed to authenticate with Google" });
  }
});

/**
 * Get current session profile.
 */
authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  return res.status(200).json({
    user: req.user
  });
});

/**
 * Sign out and clear httpOnly session cookie.
 */
authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production"
  });
  return res.status(200).json({ status: "logged_out" });
});

/**
 * TEST-ONLY GATED AUTH BYPASS
 * STRICTLY disabled in production and only active when NODE_ENV === 'test'.
 * Refuses execution if NODE_ENV is production.
 */
authRouter.post("/test-token", async (req: Request, res: Response) => {
  if (env.NODE_ENV === "production" || process.env.NODE_ENV !== "test") {
    return res.status(403).json({ error: "Test authentication is disabled in production environments" });
  }

  const email = (req.body?.email as string) || "test@example.com";
  const name = (req.body?.name as string) || "Test User";
  const googleId = (req.body?.googleId as string) || `google_test_${email}`;

  const user = await prisma.user.upsert({
    where: { googleId },
    update: { name, email },
    create: {
      googleId,
      email,
      name
    }
  });

  const token = AuthService.signToken({
    userId: user.id,
    email: user.email,
    name: user.name
  });

  res.cookie("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      googleId: user.googleId
    }
  });
});
