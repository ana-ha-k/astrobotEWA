import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, checkIns, userStreaks, messageActivity, type UserStreak } from "./db.js";
import { logger } from "./logger.js";

export const ABUNDANCE_ROLE_NAME    = process.env["ABUNDANCE_ROLE_NAME"] ?? "Aligned Abundance";
export const STREAK_UNLOCK_DAYS     = 6;  // 6 consecutive check-in days to unlock
export const MISS_REVOKE_DAYS       = 3;  // miss 3 consecutive days to lose access
export const DAILY_MSG_MINIMUM      = 3;  // messages/day that counts as an "active" day
export const MSG_DAYS_REQUIRED      = 4;  // need 4 active message days (3+ msgs) to unlock
export const INACTIVE_KICK_DAYS     = 5;  // no check-in AND no messages for 5 days → kicked
export const LEADERBOARD_CHANNEL_ID = "1507940278609121541"; // #📢┃leaderboard

function todayUTCDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
  );
}

/** Count how many days in the last N days the user sent ≥ DAILY_MSG_MINIMUM messages. */
export async function getMessageDaysCount(userId: string, guildId: string, lookbackDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(messageActivity)
    .where(and(
      eq(messageActivity.userId, userId),
      eq(messageActivity.guildId, guildId),
      gte(messageActivity.activityDate, cutoffStr),
      gte(messageActivity.messageCount, DAILY_MSG_MINIMUM),
    ));
  return rows.length;
}

/** Returns user IDs who have had no check-in AND no messages for INACTIVE_KICK_DAYS days. */
export async function getInactiveUsers(guildId: string): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - INACTIVE_KICK_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const stale = await db
    .select({ userId: userStreaks.userId })
    .from(userStreaks)
    .where(and(
      eq(userStreaks.guildId, guildId),
      or(isNull(userStreaks.lastCheckIn), lte(userStreaks.lastCheckIn, cutoffStr)),
    ));

  const result: string[] = [];
  for (const { userId } of stale) {
    const recent = await db
      .select()
      .from(messageActivity)
      .where(and(
        eq(messageActivity.userId, userId),
        eq(messageActivity.guildId, guildId),
        gte(messageActivity.activityDate, cutoffStr),
      ));
    if (recent.length === 0) result.push(userId);
  }
  return result;
}

/** Increment today's message count for a user. Call from messageCreate. */
export async function recordMessageActivity(userId: string, guildId: string): Promise<void> {
  const today = todayUTCDate();
  await db
    .insert(messageActivity)
    .values({ userId, guildId, activityDate: today, messageCount: 1 })
    .onConflictDoUpdate({
      target: [messageActivity.userId, messageActivity.guildId, messageActivity.activityDate],
      set: { messageCount: sql`message_activity.message_count + 1` },
    });
}

/** Get today's message count for a user. */
export async function getMessageCount(userId: string, guildId: string): Promise<number> {
  const today = todayUTCDate();
  const [row] = await db
    .select()
    .from(messageActivity)
    .where(and(
      eq(messageActivity.userId, userId),
      eq(messageActivity.guildId, guildId),
      eq(messageActivity.activityDate, today),
    ));
  return row?.messageCount ?? 0;
}

export type CheckInResult =
  | { status: "already_checked_in"; streak: number; messageDays: number }
  | { status: "checked_in"; streak: number; longestStreak: number; messageDays: number; unlocked: boolean; revoked: boolean };

export async function recordCheckIn(userId: string, guildId: string): Promise<CheckInResult> {
  const today = todayUTCDate();

  const existing = await db
    .select()
    .from(checkIns)
    .where(and(
      eq(checkIns.userId, userId),
      eq(checkIns.guildId, guildId),
      eq(checkIns.checkedInAt, today),
    ));

  if (existing.length > 0) {
    const [row] = await db
      .select()
      .from(userStreaks)
      .where(and(eq(userStreaks.userId, userId), eq(userStreaks.guildId, guildId)));
    const messageDays = await getMessageDaysCount(userId, guildId, STREAK_UNLOCK_DAYS);
    return { status: "already_checked_in", streak: row?.currentStreak ?? 1, messageDays };
  }

  await db.insert(checkIns).values({ userId, guildId, checkedInAt: today });

  const [streak] = await db
    .select()
    .from(userStreaks)
    .where(and(eq(userStreaks.userId, userId), eq(userStreaks.guildId, guildId)));

  let newStreak = 1;
  let newMisses = 0;
  const wasUnlocked = streak?.abundanceUnlocked ?? false;

  if (streak?.lastCheckIn) {
    const gap = daysBetween(streak.lastCheckIn, today);
    if (gap === 1) {
      newStreak = streak.currentStreak + 1;
      newMisses = 0;
    } else {
      newStreak = 1;
      newMisses = gap - 1;
    }
  }

  const messageDays     = await getMessageDaysCount(userId, guildId, STREAK_UNLOCK_DAYS);
  const longestStreak   = Math.max(newStreak, streak?.longestStreak ?? 0);
  const meetsAllReqs    = newStreak >= STREAK_UNLOCK_DAYS && messageDays >= MSG_DAYS_REQUIRED;
  const justUnlocked    = meetsAllReqs && !wasUnlocked;
  const abundanceActive = meetsAllReqs;
  const revoked         = wasUnlocked && newMisses >= MISS_REVOKE_DAYS;

  await db
    .insert(userStreaks)
    .values({
      userId,
      guildId,
      currentStreak:     newStreak,
      longestStreak,
      lastCheckIn:       today,
      abundanceUnlocked: revoked ? false : abundanceActive,
      consecutiveMisses: newMisses,
      reminderTime:      streak?.reminderTime ?? null,
    })
    .onConflictDoUpdate({
      target:  [userStreaks.userId, userStreaks.guildId],
      set: {
        currentStreak:     sql`excluded.current_streak`,
        longestStreak:     sql`excluded.longest_streak`,
        lastCheckIn:       sql`excluded.last_check_in`,
        abundanceUnlocked: sql`excluded.abundance_unlocked`,
        consecutiveMisses: sql`excluded.consecutive_misses`,
      },
    });

  return {
    status: "checked_in",
    streak:        newStreak,
    longestStreak,
    messageDays,
    unlocked:      justUnlocked,
    revoked,
  };
}

export async function getStreak(userId: string, guildId: string): Promise<UserStreak | null> {
  const [row] = await db
    .select()
    .from(userStreaks)
    .where(and(eq(userStreaks.userId, userId), eq(userStreaks.guildId, guildId)));
  return row ?? null;
}

export async function setReminder(userId: string, guildId: string, time: string | null): Promise<void> {
  await db
    .insert(userStreaks)
    .values({
      userId,
      guildId,
      currentStreak:     0,
      longestStreak:     0,
      abundanceUnlocked: false,
      consecutiveMisses: 0,
      reminderTime:      time,
    })
    .onConflictDoUpdate({
      target: [userStreaks.userId, userStreaks.guildId],
      set:    { reminderTime: sql`excluded.reminder_time` },
    });
}

export async function getLeaderboard(guildId: string, limit = 10): Promise<UserStreak[]> {
  return db
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.guildId, guildId))
    .orderBy(desc(userStreaks.currentStreak))
    .limit(limit);
}

/** Called daily by scheduler — increments misses and revokes access for lapsed members. */
export async function processDailyMisses(guildId: string): Promise<string[]> {
  const today = todayUTCDate();

  const unlocked = await db
    .select()
    .from(userStreaks)
    .where(and(eq(userStreaks.guildId, guildId), eq(userStreaks.abundanceUnlocked, true)));

  const revokedIds: string[] = [];

  for (const row of unlocked) {
    if (!row.lastCheckIn) continue;
    const gap = daysBetween(row.lastCheckIn, today);
    if (gap < 1) continue; // checked in today already

    const newMisses = row.consecutiveMisses + 1;
    const shouldRevoke = newMisses >= MISS_REVOKE_DAYS;

    await db
      .update(userStreaks)
      .set({
        consecutiveMisses: newMisses,
        abundanceUnlocked: shouldRevoke ? false : true,
      })
      .where(and(eq(userStreaks.userId, row.userId), eq(userStreaks.guildId, guildId)));

    if (shouldRevoke) {
      revokedIds.push(row.userId);
      logger.info({ userId: row.userId }, "Abundance access revoked after 3 missed days");
    }
  }

  return revokedIds;
}

/** Returns users whose reminderTime matches the current UTC HH:MM. */
export async function getUsersDueReminder(guildId: string): Promise<UserStreak[]> {
  const now = new Date();
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return db
    .select()
    .from(userStreaks)
    .where(and(eq(userStreaks.guildId, guildId), eq(userStreaks.reminderTime, hhmm)));
}
