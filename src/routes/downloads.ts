import { Router, type Request, type Response } from "express";
import { db, conversionsTable } from "../lib/db.js";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

const router = Router();

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".mkv": "video/x-matroska",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

async function handleDownload(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [conversion] = await db
    .select()
    .from(conversionsTable)
    .where(eq(conversionsTable.id, id));

  if (!conversion) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (conversion.status !== "completed") {
    res.status(409).json({ error: "Conversion not complete", status: conversion.status });
    return;
  }

  const filePath = conversion.filePath;
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on server" });
    return;
  }

  const safeTitle = (conversion.videoTitle ?? "video")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);

  const ext = path.extname(filePath) || `.${conversion.outputFormat}`;
  const downloadName = `${safeTitle}${ext}`;
  const stat = fs.statSync(filePath);

  res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  res.setHeader("Content-Type", getMimeType(ext));
  res.setHeader("Content-Length", stat.size);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => res.end());
}

router.get("/downloads/:id", handleDownload);

export default router;
