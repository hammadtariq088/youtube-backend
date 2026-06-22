import { Router } from "express";
import { db, conversionsTable } from "../lib/db.js";
import { eq, gte, desc, count, sql } from "drizzle-orm";
import { serializeConversion } from "./video.js";

const router = Router();

// GET /api/stats/summary
router.get("/stats/summary", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalCount] = await db.select({ count: count() }).from(conversionsTable);
  const [todayCount] = await db
    .select({ count: count() })
    .from(conversionsTable)
    .where(gte(conversionsTable.createdAt, today));
  const [completedCount] = await db
    .select({ count: count() })
    .from(conversionsTable)
    .where(eq(conversionsTable.status, "completed"));
  const formatCounts = await db
    .select({ format: conversionsTable.outputFormat, count: count() })
    .from(conversionsTable)
    .groupBy(conversionsTable.outputFormat)
    .orderBy(desc(count()));
  const recentItems = await db
    .select()
    .from(conversionsTable)
    .orderBy(desc(conversionsTable.createdAt))
    .limit(5);

  const total = Number(totalCount.count);
  const completed = Number(completedCount.count);

  return res.json({
    totalConversions: total,
    completedToday: Number(todayCount.count),
    totalDownloads: completed,
    successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    popularFormats: formatCounts.map((f) => ({
      format: f.format,
      count: Number(f.count),
    })),
    recentActivity: recentItems.map(serializeConversion),
  });
});

// GET /api/admin/analytics
router.get("/admin/analytics", async (req, res) => {
  const days = Math.min(parseInt(req.query.days as string) || 7, 90);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const dailyRows = await db
    .select({
      date: sql<string>`date_trunc('day', ${conversionsTable.createdAt})::date::text`,
      conversions: count(),
      downloads: sql<number>`count(*) filter (where ${conversionsTable.status} = 'completed')`,
    })
    .from(conversionsTable)
    .where(gte(conversionsTable.createdAt, since))
    .groupBy(sql`date_trunc('day', ${conversionsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${conversionsTable.createdAt})`);

  const formatRows = await db
    .select({ format: conversionsTable.outputFormat, count: count() })
    .from(conversionsTable)
    .groupBy(conversionsTable.outputFormat);

  const [totalCount] = await db.select({ count: count() }).from(conversionsTable);
  const [completedCount] = await db
    .select({ count: count() })
    .from(conversionsTable)
    .where(eq(conversionsTable.status, "completed"));

  const totalFormatCount = formatRows.reduce((s, r) => s + Number(r.count), 0);

  return res.json({
    daily: dailyRows.map((r) => ({
      date: r.date,
      conversions: Number(r.conversions),
      downloads: Number(r.downloads),
    })),
    totalConversions: Number(totalCount.count),
    totalDownloads: Number(completedCount.count),
    formatBreakdown: formatRows.map((r) => ({
      format: r.format,
      count: Number(r.count),
      percentage:
        totalFormatCount > 0
          ? Math.round((Number(r.count) / totalFormatCount) * 100)
          : 0,
    })),
  });
});

// GET /api/admin/conversions
router.get("/admin/conversions", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string | undefined;
  const whereClause = status ? eq(conversionsTable.status, status) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(conversionsTable)
      .where(whereClause)
      .orderBy(desc(conversionsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(conversionsTable).where(whereClause),
  ]);

  return res.json({ items: items.map(serializeConversion), total: Number(total) });
});

export default router;
