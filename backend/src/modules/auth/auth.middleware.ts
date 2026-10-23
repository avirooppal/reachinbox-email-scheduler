import { Request, Response, NextFunction } from "express";
import { AuthService, TokenPayload } from "./auth.service.js";
import { prisma } from "../../infra/prisma.js";
import { env } from "../../config/env.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  googleId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token = req.cookies?.auth_token;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.substring(7);
    }

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    let payload: TokenPayload;
    try {
      payload = AuthService.verifyToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(401).json({ error: "User account not found" });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      googleId: user.googleId
    };

    next();
  } catch (err) {
    req.log?.error({ err }, "Auth middleware error");
    return res.status(500).json({ error: "Authentication error" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const isAdmin = env.ADMIN_EMAILS.includes(req.user.email.toLowerCase());
  if (!isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}
