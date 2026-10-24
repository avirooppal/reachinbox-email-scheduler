import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { requireAuth } from "../auth/auth.middleware.js";
import { prisma } from "../../infra/prisma.js";

export const attachmentsRouter = Router();

// Ensure upload directory exists
const uploadDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer disk storage retaining unique file paths
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${uniqueSuffix}-${sanitized}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB per file
  }
});

attachmentsRouter.use(requireAuth);

/**
 * Upload single or multiple attachments
 * POST /api/attachments
 */
attachmentsRouter.post(
  "/",
  upload.array("files", 5),
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files provided" });
      }

      // Check total batch size <= 15MB
      const totalSize = files.reduce((acc, f) => acc + f.size, 0);
      if (totalSize > 15 * 1024 * 1024) {
        // Cleanup written files
        for (const f of files) {
          try { fs.unlinkSync(f.path); } catch {}
        }
        return res.status(400).json({ error: "Total attachment size exceeds 15MB limit" });
      }

      const userId = req.user!.id;
      const created = await Promise.all(
        files.map((file) =>
          prisma.attachment.create({
            data: {
              userId,
              filename: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              storagePath: file.path
            }
          })
        )
      );

      return res.status(201).json({
        attachments: created.map((att) => ({
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          createdAt: att.createdAt
        }))
      });
    } catch (err) {
      req.log?.error?.({ err }, "Upload error") ?? console.error(err);
      return res.status(500).json({ error: "Failed to upload attachments" });
    }
  }
);

/**
 * Download attachment file
 * GET /api/attachments/:id
 */
attachmentsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const attachment = await prisma.attachment.findFirst({
      where: { id: req.params.id as string }
    });

    if (!attachment) {
      return res.status(404).json({ error: "Attachment not found" });
    }

    if (!fs.existsSync(attachment.storagePath)) {
      return res.status(404).json({ error: "Attachment file missing on server" });
    }

    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${attachment.filename}"`);
    return fs.createReadStream(attachment.storagePath).pipe(res);
  } catch (err) {
    req.log?.error?.({ err }, "Download attachment error") ?? console.error(err);
    return res.status(500).json({ error: "Failed to download attachment" });
  }
});
