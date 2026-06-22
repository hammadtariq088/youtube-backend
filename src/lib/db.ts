import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required. See .env.example");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: 10,
});

export const db = drizzle(pool);

/* ─── Schema ─── */

export const conversionsTable = pgTable("conversions", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  outputFormat: text("output_format").notNull(),
  quality: text("quality"),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  downloadUrl: text("download_url"),
  fileSize: integer("file_size"),
  errorMessage: text("error_message"),
  videoTitle: text("video_title"),
  videoThumbnail: text("video_thumbnail"),
  ipAddress: text("ip_address"),
  filePath: text("file_path"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const blogPostsTable = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  content: text("content").notNull(),
  category: text("category"),
  tags: text("tags").array(),
  published: boolean("published").notNull().default(false),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  coverImage: text("cover_image"),
  readingTime: integer("reading_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const faqItemsTable = pgTable("faq_items", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category"),
  order: integer("order").notNull().default(0),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
