import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { badRequest } from "../../core/http-error";
import { createObjectKey, uploadObject } from "../../core/object-storage";
import { asyncHandler } from "../../core/async-handler";
import { authenticate } from "../../middleware/auth.middleware";
import { requireTenant } from "../../middleware/tenant.middleware";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
    fields: 5,
    parts: 6
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
mediaRouter.use(authenticate, requireTenant);

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

    const buffer = req.file.buffer;
    const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    const gif = buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
    const contentMatches = req.file.mimetype === "image/jpeg" || req.file.mimetype === "image/jpg" ? jpeg : req.file.mimetype === "image/png" ? png : req.file.mimetype === "image/webp" ? webp : req.file.mimetype === "image/gif" ? gif : false;
    if (!contentMatches) {
      next(badRequest("Image content does not match its declared type"));
      return;
    }

    void asyncHandler(async (uploadReq, uploadRes) => {
      const extension = path.extname(uploadReq.file!.originalname).toLowerCase() || ".jpg";
      const key = createObjectKey(`media/${uploadReq.organizationId}`, `upload${extension}`);
      const stored = await uploadObject({
        key,
        body: uploadReq.file!.buffer,
        contentType: uploadReq.file!.mimetype,
        publicBaseUrl: `${uploadReq.protocol}://${uploadReq.get("host")}`
      });
      uploadRes.status(201).json({
        success: true,
        message: "Media uploaded successfully",
        data: { url: stored.url, path: stored.key, size: stored.size, mimeType: uploadReq.file!.mimetype }
      });
    })(req, res, next);
  });
});
