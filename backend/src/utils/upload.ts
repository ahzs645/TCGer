import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';

const UPLOADS_ROOT_DIR = path.resolve(
  process.env.UPLOADS_DIR?.trim() || path.resolve(process.cwd(), 'uploads'),
);
const UPLOADS_DIR = path.join(UPLOADS_ROOT_DIR, 'collection-images');
const CARD_SCAN_DEBUG_DIR = path.join(UPLOADS_ROOT_DIR, 'card-scan-debug');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Ensure uploads directory exists
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CARD_SCAN_DEBUG_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
}

export const uploadImages = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
});

export function getUploadsRootDir(): string {
  return UPLOADS_ROOT_DIR;
}

export function getImagePublicPath(filename: string): string {
  return `/uploads/collection-images/${filename}`;
}

export function deleteImageFile(publicPath: string): void {
  const filename = path.basename(publicPath);
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may already be deleted
  }
}

export function getCardScanDebugUploadDir(): string {
  return CARD_SCAN_DEBUG_DIR;
}

export function getCardScanDebugPublicPath(filename: string): string {
  return `/uploads/card-scan-debug/${filename}`;
}
