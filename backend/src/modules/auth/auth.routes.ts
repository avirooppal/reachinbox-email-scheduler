import { Router, Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";
import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma.js";

export const authRouter = Router();

// In-memory or cookie-backed state store for CSRF protection
const stateStore = new Set<string>();

/**
 * Initiates Google OAuth Code Flow.
 */
authRouter.get("/google", (_req: Request, res: Response) => {
  const { url, state } = AuthService.getGoogleAuthUrl();
  stateStore.add(state);

  // Expire state after 10 minutes
  setTimeout(() => stateStore.delete(state), 10 * 60 * 1000);

  res.cookie("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
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

    if (!code || !state || state !== savedState || !stateStore.has(state)) {
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

    res.cookie("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.redirect(`${env.FRONTEND_URL}/dashboard`);
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
 * STRICTLY disabled unless NODE_ENV === 'test'.
 * Creates or gets a test user and returns session cookie + bearer token.
 */
authRouter.post("/test-token", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== "test") {
    return res.status(403).json({ error: "Test authentication is disabled in non-test environments" });
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
