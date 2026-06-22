import { Router } from "express";
import { db, faqItemsTable } from "../lib/db.js";
import { eq, asc } from "drizzle-orm";

const router = Router();

function serializeFaq(f: typeof faqItemsTable.$inferSelect) {
  return {
    id: f.id,
    question: f.question,
    answer: f.answer,
    category: f.category,
    order: f.order,
    published: f.published,
  };
}

// GET /api/faq
router.get("/faq", async (_req, res) => {
  const items = await db
    .select()
    .from(faqItemsTable)
    .where(eq(faqItemsTable.published, true))
    .orderBy(asc(faqItemsTable.order));
  return res.json(items.map(serializeFaq));
});

// POST /api/faq
router.post("/faq", async (req, res) => {
  const { question, answer, category, order, published } = req.body ?? {};
  if (!question || !answer) {
    return res.status(400).json({ error: "question and answer are required" });
  }
  const [faq] = await db
    .insert(faqItemsTable)
    .values({
      question,
      answer,
      category: category ?? null,
      order: order ?? 0,
      published: published ?? true,
    })
    .returning();
  return res.status(201).json(serializeFaq(faq));
});

// PATCH /api/faq/:id
router.patch("/faq/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { question, answer, category, order, published } = req.body ?? {};
  const [faq] = await db
    .update(faqItemsTable)
    .set({
      ...(question !== undefined && { question }),
      ...(answer !== undefined && { answer }),
      ...(category !== undefined && { category }),
      ...(order !== undefined && { order }),
      ...(published !== undefined && { published }),
    })
    .where(eq(faqItemsTable.id, id))
    .returning();
  if (!faq) return res.status(404).json({ error: "Not found" });
  return res.json(serializeFaq(faq));
});

// DELETE /api/faq/:id
router.delete("/faq/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  await db.delete(faqItemsTable).where(eq(faqItemsTable.id, id));
  return res.status(204).send();
});

export default router;
