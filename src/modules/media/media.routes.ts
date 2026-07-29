import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { badRequest } from "../../core/http-error";

const uploadsRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif"
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    fs.mkdirSync(uploadsRoot, { recursive: true });
    callback(null, uploadsRoot);
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase() || ".jpg";
    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(badRequest("Unsupported file type. Please upload an image."));
      return;
    }

    callback(null, true);
  }
});

export const mediaRouter = Router();

mediaRouter.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(badRequest(`Image must be <= ${env.UPLOAD_MAX_FILE_SIZE_MB}MB`));
          return;
        }

        next(badRequest("Invalid multipart upload payload"));
        return;
      }

      next(error);
      return;
    }

    if (!req.file) {
      next(badRequest("Image file is required"));
      return;
    }

    const protocol = req.protocol;
    const host = req.get("host");
    const publicPath = `${env.UPLOAD_PUBLIC_BASE_PATH}/${req.file.filename}`;

    res.status(201).json({
      url: `${protocol}://${host}${publicPath}`,
      path: publicPath,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  });
});
