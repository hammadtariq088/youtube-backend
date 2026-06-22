import { Router } from "express";
import { db, blogPostsTable } from "../lib/db.js";
import { eq, desc, count, sql } from "drizzle-orm";

const router = Router();

function serializeBlogPost(p: typeof blogPostsTable.$inferSelect) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    content: p.content,
    category: p.category,
    tags: p.tags ?? [],
    published: p.published,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    coverImage: p.coverImage,
    readingTime: p.readingTime,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /api/blog/posts
router.get("/blog/posts", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const category = req.query.category as string | undefined;
  const publishedParam = req.query.published;
  const published =
    publishedParam !== undefined ? publishedParam === "true" : undefined;

  const conditions = [];
  if (category) conditions.push(eq(blogPostsTable.category, category));
  if (published !== undefined) conditions.push(eq(blogPostsTable.published, published));

  type SqlExpr = ReturnType<typeof sql>;
  const whereClause =
    conditions.length > 0
      ? (conditions.reduce((a, b) => sql`${a as SqlExpr} AND ${b as SqlExpr}`) as SqlExpr)
      : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(blogPostsTable)
      .where(whereClause)
      .orderBy(desc(blogPostsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(blogPostsTable).where(whereClause),
  ]);

  return res.json({ items: items.map(serializeBlogPost), total: Number(total) });
});

// POST /api/blog/posts
router.post("/blog/posts", async (req, res) => {
  const { slug, title, content, excerpt, category, tags, published, metaTitle, metaDescription } =
    req.body ?? {};
  if (!slug || !title || !content) {
    return res.status(400).json({ error: "slug, title, and content are required" });
  }
  const [post] = await db
    .insert(blogPostsTable)
    .values({
      slug,
      title,
      content,
      excerpt: excerpt ?? null,
      category: category ?? null,
      tags: tags ?? [],
      published: published ?? false,
      metaTitle: metaTitle ?? null,
      metaDescription: metaDescription ?? null,
    })
    .returning();
  return res.status(201).json(serializeBlogPost(post));
});

// GET /api/blog/posts/:slug
router.get("/blog/posts/:slug", async (req, res) => {
  const [post] = await db
    .select()
    .from(blogPostsTable)
    .where(eq(blogPostsTable.slug, req.params.slug as string));
  if (!post) return res.status(404).json({ error: "Not found" });
  return res.json(serializeBlogPost(post));
});

// PATCH /api/blog/posts/:slug
router.patch("/blog/posts/:slug", async (req, res) => {
  const { title, content, excerpt, category, tags, published, metaTitle, metaDescription } =
    req.body ?? {};
  const [post] = await db
    .update(blogPostsTable)
    .set({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(excerpt !== undefined && { excerpt }),
      ...(category !== undefined && { category }),
      ...(tags !== undefined && { tags }),
      ...(published !== undefined && { published }),
      ...(metaTitle !== undefined && { metaTitle }),
      ...(metaDescription !== undefined && { metaDescription }),
      updatedAt: new Date(),
    })
    .where(eq(blogPostsTable.slug, req.params.slug as string))
    .returning();
  if (!post) return res.status(404).json({ error: "Not found" });
  return res.json(serializeBlogPost(post));
});

// DELETE /api/blog/posts/:slug
router.delete("/blog/posts/:slug", async (req, res) => {
  await db.delete(blogPostsTable).where(eq(blogPostsTable.slug, req.params.slug as string));
  return res.status(204).send();
});

// GET /api/blog/categories
router.get("/blog/categories", async (_req, res) => {
  const rows = await db
    .select({ name: blogPostsTable.category, count: count() })
    .from(blogPostsTable)
    .where(
      sql`${blogPostsTable.category} IS NOT NULL AND ${blogPostsTable.published} = true`,
    )
    .groupBy(blogPostsTable.category);
  return res.json(
    rows.map((r) => ({ name: r.name ?? "Uncategorized", count: Number(r.count) })),
  );
});

export default router;
