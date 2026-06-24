import { Router } from "express";
import { db, conversionsTable } from "../lib/db.js";
import { eq } from "drizzle-orm";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { serializeConversion } from "../utils/serializeConversion.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ─────────────────────────────
   CONFIG
───────────────────────────── */

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? "/tmp/convertx-downloads";
const baseUrl =
  process.env.PUBLIC_API_URL || "https://youtube-backend-4zfp.onrender.com/";

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const YT_DLP = resolveYtDlp();
console.log("YT-DLP:", YT_DLP);

/* ─────────────────────────────
   YT-DLP RESOLUTION
───────────────────────────── */

function resolveYtDlp(): string {
  const renderPath = "/opt/render/project/src/bin/yt-dlp";

  if (fs.existsSync(renderPath)) {
    return renderPath;
  }

  try {
    return execFileSync("which", ["yt-dlp"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "yt-dlp";
  }
}

/* ─────────────────────────────
   PIPED API (INFO ONLY)
───────────────────────────── */

async function fetchVideoInfo(url: string) {
  const response = await fetch(
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch metadata");
  }

  const data: any = await response.json();

  return {
    title: data.title ?? "Unknown Video",
    description: "",
    thumbnail: data.thumbnail_url ?? "",
    duration: 0,
    uploader: data.author_name ?? "",
    viewCount: 0,
    platform: "YouTube",
    url,
    formats: [
      {
        formatId: "mp4",
        quality: "Best",
        extension: "mp4",
      },
      {
        formatId: "mp3",
        quality: "Best",
        extension: "mp3",
      },
    ],
  };
}

/* ─────────────────────────────
   VALIDATION
───────────────────────────── */

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

/* ─────────────────────────────
   FORMAT SELECTOR
───────────────────────────── */

function buildFormatSelector(format: string, quality: string | null) {
  const q = quality ?? "best";

  if (format === "mp3") {
    return {
      args: [
        "-f",
        "bestaudio/best",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
      ],
      ext: "mp3",
    };
  }

  const heightMap: Record<string, string> = {
    "1080p": "1080",
    "720p": "720",
    "480p": "480",
    "360p": "360",
  };

  const h = heightMap[q];

  const fmt = h
    ? `bestvideo[height<=${h}]+bestaudio/best`
    : "bestvideo+bestaudio/best";

  return {
    args: ["-f", fmt, "--merge-output-format", "mp4"],
    ext: "mp4",
  };
}

/* ─────────────────────────────
   BOT BYPASS ARGS
───────────────────────────── */

function getYtDlpArgs() {
  return [
    "--force-ipv4",
    "--no-playlist",
    "--no-warnings",

    "--extractor-args",
    "youtube:player_client=android,web",

    "--extractor-retries",
    "5",

    "--socket-timeout",
    "30",
  ];
}

/* ─────────────────────────────
   ROUTE: VIDEO INFO (PIPED)
───────────────────────────── */

router.post("/video/info", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({
      error: "Invalid URL",
    });
  }

  try {
    const data = await fetchVideoInfo(url);
    return res.json(data);
  } catch (err: any) {
    return res.status(422).json({
      error: "Could not fetch video",
      message: err.message,
    });
  }
});

/* ─────────────────────────────
   ROUTE: CONVERT (YT-DLP)
───────────────────────────── */

router.post("/video/convert", async (req, res) => {
  const { url, outputFormat, quality, videoTitle, videoThumbnail } =
    req.body ?? {};

  if (!url || !outputFormat) {
    return res.status(400).json({
      error: "Missing parameters",
    });
  }

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
    })
    .returning();

  runConversion(conversion.id, url, outputFormat, quality ?? null);

  return res.json(serializeConversion(conversion));
});

/* ─────────────────────────────
   BACKGROUND WORKER
───────────────────────────── */

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

    const output = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);

    const args = [
      ...fmtArgs,
      ...getYtDlpArgs(),
      "--newline",
      "-o",
      output,
      url,
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(YT_DLP, args);

      let stderr = "";
      let last = 5;

      proc.stdout.on("data", async (d) => {
        const lines = d.toString().split("\n");

        for (const line of lines) {
          const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);

          if (match) {
            const pct = Math.min(99, Math.round(+match[1]));

            if (pct > last) {
              last = pct;

              await db
                .update(conversionsTable)
                .set({ progress: pct })
                .where(eq(conversionsTable.id, id));
            }
          }
        }
      });

      proc.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      proc.on("close", async (code) => {
        if (code !== 0) {
          return reject(new Error(stderr));
        }

        const files = fs
          .readdirSync(DOWNLOADS_DIR)
          .filter((f) => f.startsWith(`${id}.`));

        const file = files.find((f) => f.endsWith(ext)) ?? files[0];

        if (!file) return reject(new Error("File not found"));

        const filePath = path.join(DOWNLOADS_DIR, file);
        const stat = fs.statSync(filePath);

        await db
          .update(conversionsTable)
          .set({
            status: "completed",
            progress: 100,
            filePath,
            fileSize: stat.size,
            downloadUrl: `${baseUrl}/api/downloads/${id}`,
            completedAt: new Date(),
          })
          .where(eq(conversionsTable.id, id));

        resolve();
      });

      proc.on("error", reject);
    });
  } catch (err: any) {
    await db
      .update(conversionsTable)
      .set({
        status: "failed",
        errorMessage: err.message,
      })
      .where(eq(conversionsTable.id, id));
  }
}

router.get("/video/conversion/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(400).json({
      error: "Invalid conversion id",
    });
  }

  const [conversion] = await db
    .select()
    .from(conversionsTable)
    .where(eq(conversionsTable.id, id));

  if (!conversion) {
    return res.status(404).json({
      error: "Conversion not found",
    });
  }

  return res.json(serializeConversion(conversion));
});

export default router;
