import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  pgTable, serial, text, date, integer, boolean, primaryKey, unique,
} from "drizzle-orm/pg-core";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Schema ────────────────────────────────────────────────────────────────

export const messageActivity = pgTable(
  "message_activity",
  {
    userId:       text("user_id").notNull(),
    guildId:      text("guild_id").notNull(),
    activityDate: date("activity_date").notNull(),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guildId, t.activityDate] })],
);

export const checkIns = pgTable("check_ins", {
  id:          serial("id").primaryKey(),
  userId:      text("user_id").notNull(),
  guildId:     text("guild_id").notNull(),
  checkedInAt: date("checked_in_at").notNull(),
}, (t) => [
  unique("check_ins_user_guild_date_uniq").on(t.userId, t.guildId, t.checkedInAt),
]);

export const userStreaks = pgTable("user_streaks", {
  userId:            text("user_id").notNull(),
  guildId:           text("guild_id").notNull(),
  currentStreak:     integer("current_streak").default(0).notNull(),
  longestStreak:     integer("longest_streak").default(0).notNull(),
  lastCheckIn:       date("last_check_in"),
  abundanceUnlocked: boolean("abundance_unlocked").default(false).notNull(),
  consecutiveMisses: integer("consecutive_misses").default(0).notNull(),
  reminderTime:      text("reminder_time"),
}, (t) => [
  primaryKey({ columns: [t.userId, t.guildId] }),
]);

export type UserStreak    = typeof userStreaks.$inferSelect;
export type CheckIn       = typeof checkIns.$inferSelect;
export type MessageActivity = typeof messageActivity.$inferSelect;

const schema = { messageActivity, checkIns, userStreaks };
export const db = drizzle(pool, { schema });
