import { Router } from "express";
import { db, conversionsTable } from "../lib/db.js";
import { eq } from "drizzle-orm";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

/* ── yt-dlp binary resolution ── */
function getYtDlpPath(): string {
  // 1. Env override
  const envPath = process.env.YTDLP_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // 2. Downloaded during Render build (bin/yt-dlp relative to project root)
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const localBin = path.join(projectRoot, "bin", "yt-dlp");
  if (fs.existsSync(localBin)) return localBin;

  // 3. System PATH
  try {
    return execFileSync("which", ["yt-dlp"], { encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  // 4. Nix store (Replit dev environment)
  try {
    const nixStore = "/nix/store";
    if (fs.existsSync(nixStore)) {
      const dirs = fs
        .readdirSync(nixStore)
        .filter((d) => d.includes("yt-dlp"));
      for (const dir of dirs) {
        const bin = path.join(nixStore, dir, "bin", "yt-dlp");
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {
    /* ignore */
  }

  return "yt-dlp";
}

const YT_DLP = getYtDlpPath();
console.log(`[video] Using yt-dlp at: ${YT_DLP}`);

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? "/tmp/convertx-downloads";
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/* ── Bot-bypass yt-dlp args (added to every call) ── */
function getBotBypassArgs(): string[] {
  const args = [
    // Use the Android + web client — avoids "Sign in to confirm you're not a bot"
    "--extractor-args",
    "youtube:player_client=android,web",
    "--no-check-certificate",
    "--no-warnings",
    "--no-playlist",
  ];

  // If a cookies file is configured, use it (best long-term solution)
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push("--cookies", cookiesFile);
  }

  return args;
}

/* ── Platform detection ── */
const PLATFORM_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "YouTube", pattern: /(?:youtube\.com|youtu\.be)/i },
  { name: "Twitter/X", pattern: /(?:twitter\.com|x\.com)/i },
  { name: "Instagram", pattern: /instagram\.com/i },
  { name: "Facebook", pattern: /facebook\.com/i },
  { name: "TikTok", pattern: /tiktok\.com/i },
  { name: "Vimeo", pattern: /vimeo\.com/i },
  { name: "Dailymotion", pattern: /dailymotion\.com/i },
  { name: "Reddit", pattern: /reddit\.com/i },
  { name: "Twitch", pattern: /twitch\.tv/i },
];

function detectPlatform(url: string): string {
  for (const { name, pattern } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return name;
  }
  return "Unknown";
}

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/* ── Build yt-dlp format selector ── */
function buildFormatSelector(
  outputFormat: string,
  quality: string | null,
): { args: string[]; ext: string } {
  const q = quality ?? "highest";

  if (outputFormat === "mp3") {
    return {
      args: ["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"],
      ext: "mp3",
    };
  }
  if (outputFormat === "m4a") {
    return {
      args: ["-f", "bestaudio/best", "-x", "--audio-format", "m4a", "--audio-quality", "0"],
      ext: "m4a",
    };
  }
  if (outputFormat === "webm") {
    const heightMap: Record<string, string> = {
      "1080p": "1080",
      "720p": "720",
      "480p": "480",
      "360p": "360",
    };
    const h = heightMap[q];
    const fmtStr = h
      ? `bestvideo[height<=${h}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<=${h}]+bestaudio/best`
      : "bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio/best";
    return { args: ["-f", fmtStr, "--merge-output-format", "webm"], ext: "webm" };
  }

  // default: mp4
  const heightMap: Record<string, string> = {
    "1080p": "1080",
    "720p": "720",
    "480p": "480",
    "360p": "360",
  };
  const h = heightMap[q];
  const fmtStr = h
    ? `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`
    : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best";
  return { args: ["-f", fmtStr, "--merge-output-format", "mp4"], ext: "mp4" };
}

/* ── Fetch video metadata via yt-dlp --dump-json ── */
async function fetchVideoInfo(url: string) {
  return new Promise<ReturnType<typeof buildVideoInfoResponse>>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(YT_DLP, [
      "--dump-json",
      ...getBotBypassArgs(),
      url,
    ]);

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        const errMsg = stderr.trim() || "yt-dlp returned no data";
        return reject(new Error(errMsg));
      }
      try {
        const info = JSON.parse(stdout.trim());
        resolve(buildVideoInfoResponse(info, url));
      } catch {
        reject(new Error("Failed to parse video metadata"));
      }
    });

    proc.on("error", (err) => reject(err));

    // 30 second timeout for metadata
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Metadata fetch timed out after 30 seconds"));
    }, 30_000);

    proc.on("close", () => clearTimeout(timer));
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildVideoInfoResponse(info: any, originalUrl: string) {
  const platform = detectPlatform(originalUrl);
  const formats: Array<{
    formatId: string;
    quality: string;
    extension: string;
    filesize: number | null;
    vcodec: string | null;
    acodec: string | null;
    fps: number | null;
  }> = [];

  if (Array.isArray(info.formats)) {
    for (const f of info.formats) {
      formats.push({
        formatId: f.format_id ?? "",
        quality: f.format_note ?? f.quality?.toString() ?? "",
        extension: f.ext ?? "mp4",
        filesize: f.filesize ?? f.filesize_approx ?? null,
        vcodec: f.vcodec && f.vcodec !== "none" ? f.vcodec : null,
        acodec: f.acodec && f.acodec !== "none" ? f.acodec : null,
        fps: f.fps ?? null,
      });
    }
  }

  if (formats.length === 0) {
    formats.push(
      { formatId: "mp4-best", quality: "Best", extension: "mp4", filesize: null, vcodec: "h264", acodec: "aac", fps: null },
      { formatId: "mp3-best", quality: "Best", extension: "mp3", filesize: null, vcodec: null, acodec: "mp3", fps: null },
    );
  }

  return {
    title: info.title ?? "Unknown title",
    description: info.description ?? "",
    thumbnail: info.thumbnail ?? info.thumbnails?.[0]?.url ?? "",
    duration: typeof info.duration === "number" ? Math.round(info.duration) : 0,
    platform,
    url: info.webpage_url ?? originalUrl,
    uploader: info.uploader ?? info.channel ?? info.creator ?? "",
    viewCount: info.view_count ?? 0,
    formats,
  };
}

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

/* ── POST /api/video/info ── */
router.post("/video/info", async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid request", message: "URL is required" });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid URL", message: "Please provide a valid HTTP/HTTPS URL" });
  }

  try {
    const videoInfo = await fetchVideoInfo(url);
    return res.json(videoInfo);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch video info";
    console.error(`[video/info] ${msg}`);
    return res.status(422).json({ error: "Could not fetch video", message: msg });
  }
});

/* ── POST /api/video/convert ── */
router.post("/video/convert", async (req, res) => {
  const { url, outputFormat, quality, videoTitle, videoThumbnail } = req.body ?? {};
  if (!url || !outputFormat) {
    return res.status(400).json({ error: "Invalid request", message: "URL and output format are required" });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.ip ?? "unknown";

  const [conversion] = await db
    .insert(conversionsTable)
    .values({
      url,
      outputFormat,
      quality: quality ?? null,
      status: "pending",
      progress: 0,
      videoTitle: videoTitle ?? null,
      videoThumbnail: videoThumbnail ?? null,
      ipAddress: ip,
    })
    .returning();

  // Fire and forget — conversion runs in background
  runConversion(conversion.id, url, outputFormat, quality ?? null);

  return res.status(202).json(serializeConversion(conversion));
});

/* ── Background conversion using yt-dlp ── */
async function runConversion(
  id: number,
  url: string,
  outputFormat: string,
  quality: string | null,
) {
  try {
    await db
      .update(conversionsTable)
      .set({ status: "processing", progress: 5 })
      .where(eq(conversionsTable.id, id));

    const { args: fmtArgs, ext } = buildFormatSelector(outputFormat, quality);
    const outputTemplate = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

    const ytArgs = [
      ...fmtArgs,
      ...getBotBypassArgs(),
      "--newline",
      "-o",
      outputTemplate,
      url,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(YT_DLP, ytArgs);
      let stderr = "";
      let lastProgress = 5;

      proc.stdout.on("data", async (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          const match = line.match(/\[download\]\s+([\d.]+)%/);
          if (match) {
            const pct = Math.min(99, Math.round(parseFloat(match[1])));
            if (pct > lastProgress) {
              lastProgress = pct;
              await db
                .update(conversionsTable)
                .set({ progress: pct })
                .where(eq(conversionsTable.id, id));
            }
          }
        }
      });

      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      proc.on("close", async (code) => {
        if (code !== 0) {
          return reject(new Error(stderr.trim() || "yt-dlp exited with error"));
        }

        // Find the output file
        const prefix = `${id}.`;
        const files = fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.startsWith(prefix));
        if (files.length === 0) {
          return reject(new Error("Output file not found after conversion"));
        }

        const preferredFile = files.find((f) => f.endsWith(`.${ext}`)) ?? files[0];
        const filePath = path.join(DOWNLOADS_DIR, preferredFile);
        const stat = fs.statSync(filePath);

        await db
          .update(conversionsTable)
          .set({
            status: "completed",
            progress: 100,
            downloadUrl: `/api/downloads/${id}`,
            fileSize: stat.size,
            filePath,
            completedAt: new Date(),
          })
          .where(eq(conversionsTable.id, id));

        resolve();
      });

      proc.on("error", (err) => reject(err));

      // 10-minute timeout
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error("Conversion timed out after 10 minutes"));
      }, 600_000);

      proc.on("close", () => clearTimeout(timer));
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Conversion failed";
    console.error(`[runConversion:${id}] ${msg}`);
    await db
      .update(conversionsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(conversionsTable.id, id));
  }
}

/* ── GET /api/video/conversion/:id ── */
router.get("/video/conversion/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  const [conversion] = await db
    .select()
    .from(conversionsTable)
    .where(eq(conversionsTable.id, id));

  if (!conversion) {
    return res.status(404).json({ error: "Conversion not found" });
  }

  return res.json(serializeConversion(conversion));
});

export default router;
