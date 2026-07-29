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
