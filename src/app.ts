import express from "express";
import cors from "cors";
import videoRouter from "./routes/video.js";
import downloadsRouter from "./routes/downloads.js";
import blogRouter from "./routes/blog.js";
import faqRouter from "./routes/faq.js";
import statsRouter from "./routes/stats.js";

const app = express();

/* ─── CORS ─── */
const allowedOrigin = process.env.CORS_ORIGIN ?? "*";
app.use(
  cors({
    origin: allowedOrigin === "*" ? true : allowedOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: allowedOrigin !== "*",
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* ─── Routes ─── */
app.use("/api", videoRouter);
app.use("/api", downloadsRouter);
app.use("/api", blogRouter);
app.use("/api", faqRouter);
app.use("/api", statsRouter);

app.get("/api/healthz", (_req, res) =>
  res.json({ status: "ok", ts: Date.now() }),
);

/* ─── Error handler ─── */
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default app;
