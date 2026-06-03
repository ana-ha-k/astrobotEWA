import cron from "node-cron";
import { logger } from "./logger.js";
import { AstrologyBot } from "./discord.js";

let lastPostDate = "";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function scheduledTimePassedToday(): boolean {
  const now    = new Date();
  const utcHour = now.getUTCHours();
  const utcMin  = now.getUTCMinutes();
  // Scheduled time is 00:30 UTC (6 AM IST)
  return utcHour > 0 || (utcHour === 0 && utcMin >= 30);
}

async function postIfNotYetToday(bot: AstrologyBot) {
  const today = todayUTC();
  if (lastPostDate === today) return;
  lastPostDate = today;
  logger.info("Posting daily forecast");
  await bot.postDailyPrediction();
}

export function startScheduler(bot: AstrologyBot) {
  // ── Daily forecast at 00:30 UTC (6 AM IST) ─────────────────────────────
  cron.schedule("30 0 * * *", async () => {
    logger.info("Cron: daily forecast");
    await postIfNotYetToday(bot);
  });

  // ── Weekly oracle card — Sundays at 03:30 UTC (9 AM IST) ───────────────
  cron.schedule("30 3 * * 0", async () => {
    logger.info("Cron: weekly oracle card");
    await bot.postDailyOracleCard();
  });

  // ── Monday manifestation prompt at 00:30 UTC (6 AM IST) ───────────────
  cron.schedule("30 0 * * 1", async () => {
    logger.info("Cron: Monday manifestation prompt");
    await bot.postWeeklyManifestation();
  });

  // ── Daily miss processing at 23:55 UTC ─────────────────────────────────
  // Checks who skipped the day, increments miss count, revokes access after
  // 3 consecutive missed days, posts the leaderboard
  cron.schedule("55 23 * * *", async () => {
    logger.info("Cron: daily miss processing + leaderboard");
    await bot.runDailyMissProcessing();
  });

  // ── Daily abundance teaching at 09:30 UTC (3 PM IST) ─────────────────────
  cron.schedule("30 9 * * *", async () => {
    logger.info("Cron: daily abundance teaching");
    await bot.postAbundanceTeaching();
  });

  // ── Per-minute reminder job ─────────────────────────────────────────────
  // Sends DMs to users whose reminderTime matches current UTC HH:MM
  cron.schedule("* * * * *", async () => {
    await bot.sendPendingReminders();
  });

  logger.info(
    "Scheduler started: forecast 06:00 IST | miss-check 23:55 UTC | reminders every minute"
  );
}
