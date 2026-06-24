import { conversionsTable } from "../lib/db.js";

export function serializeConversion(c: typeof conversionsTable.$inferSelect) {
  return {
    id: c.id,
    url: c.url,
    outputFormat: c.outputFormat,
    quality: c.quality,
    status: c.status,
    progress: c.progress,
    downloadUrl: c.downloadUrl,
    fileSize: c.fileSize,
    errorMessage: c.errorMessage,
    videoTitle: c.videoTitle,
    videoThumbnail: c.videoThumbnail,
    createdAt: c.createdAt.toISOString(),
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
  };
}
