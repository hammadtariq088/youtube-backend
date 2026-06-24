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

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const YT_DLP = resolveYtDlp();

/* ─────────────────────────────
   YT-DLP RESOLUTION
───────────────────────────── */

function resolveYtDlp(): string {
  const envPath = process.env.YTDLP_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

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

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://vid.puffyan.us",
  "https://yewtu.be",
];

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1);
    }

    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

async function fetchFromInvidious(videoId: string) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`Trying ${instance}`);

      const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      });

      console.log(`${instance} -> ${response.status}`);

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.includes("application/json")) {
        console.log(`${instance} returned non-json response`);
        continue;
      }

      const data = await response.json();

      if (data?.title) {
        return data;
      }
    } catch (err) {
      console.error(instance, err);
    }
  }

  throw new Error("All Invidious instances failed");
}

async function fetchVideoInfo(url: string) {
  const videoId = extractVideoId(url);

  if (!videoId) {
    throw new Error("Invalid YouTube URL");
  }

  const info = await fetchFromInvidious(videoId);

  return {
    title: info.title ?? "Unknown Title",

    description: info.description ?? "",

    thumbnail:
      info.videoThumbnails?.find((t: any) => t.quality === "maxresdefault")
        ?.url ??
      info.videoThumbnails?.[0]?.url ??
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,

    duration: Number(info.lengthSeconds ?? 0),

    uploader: info.author ?? "",

    viewCount: Number(info.viewCount ?? 0),

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
    "--no-check-certificates",
    "--no-warnings",
    "--no-playlist",
    "--force-ipv4",
    "--extractor-args",
    "youtube:player_client=android",
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
            downloadUrl: `/api/downloads/${id}`,
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

export default router;
