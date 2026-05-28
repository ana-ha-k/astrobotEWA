import { logger } from "./logger.js";
import { AstrologyBot } from "./discord.js";
import { startScheduler } from "./scheduler.js";

const discordToken = process.env["DISCORD_BOT_TOKEN"];
const channelId    = process.env["DISCORD_CHANNEL_ID"];

if (!discordToken) throw new Error("DISCORD_BOT_TOKEN is required.");
if (!channelId)    throw new Error("DISCORD_CHANNEL_ID is required.");

logger.info("Starting Astro Manifest Bot...");

const bot = new AstrologyBot(discordToken, channelId);

bot.login().then(() => {
  startScheduler(bot);
  logger.info("Bot online and scheduler running ✨");
}).catch((err) => {
  logger.error({ err }, "Failed to start bot");
  process.exit(1);
});
