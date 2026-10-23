import jwt from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma.js";

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
}

export class AuthService {
  /**
   * Generates Google OAuth authorization URL with anti-CSRF state token.
   */
  static getGoogleAuthUrl(): { url: string; state: string } {
    const state = crypto.randomBytes(32).toString("hex");
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      state
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state
    };
  }

  /**
   * Exchanges Google authorization code for user profile info.
   */
  static async exchangeCodeForGoogleUser(code: string): Promise<{
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }> {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      })
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      throw new Error(`Google token exchange failed: ${errBody}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string; id_token: string };

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userInfoRes.ok) {
      throw new Error("Failed to fetch userinfo from Google");
    }

    const userInfo = (await userInfoRes.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };

    return {
      googleId: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.email.split("@")[0] || "User",
      avatarUrl: userInfo.picture
    };
  }

  /**
   * Upserts user in PostgreSQL database from Google profile.
   */
  static async upsertGoogleUser(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }) {
    return prisma.user.upsert({
      where: { googleId: profile.googleId },
      update: {
        name: profile.name,
        avatarUrl: profile.avatarUrl
      },
      create: {
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl
      }
    });
  }

  /**
   * Signs a JWT auth session token.
   */
  static signToken(payload: TokenPayload): string {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "7d" });
  }

  /**
   * Verifies a JWT token.
   */
  static verifyToken(token: string): TokenPayload {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  }
}
