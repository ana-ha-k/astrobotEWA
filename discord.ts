import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  TextChannel,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  type Interaction,
  type Guild,
} from "discord.js";
import { logger } from "./logger.js";
import { generateDailyForecast, generateManifestationPrompt, generateOracleCard, NAKSHATRAS, type Nakshatra } from "./astrology.js";
import {
  recordCheckIn,
  getStreak,
  setReminder,
  getLeaderboard,
  processDailyMisses,
  getUsersDueReminder,
  recordMessageActivity,
  getMessageCount,
  getMessageDaysCount,
  getInactiveUsers,
  DAILY_MSG_MINIMUM,
  MSG_DAYS_REQUIRED,
  INACTIVE_KICK_DAYS,
  ABUNDANCE_ROLE_NAME,
  STREAK_UNLOCK_DAYS,
  MISS_REVOKE_DAYS,
  LEADERBOARD_CHANNEL_ID,
} from "./checkin.js";
import { db, userStreaks } from "./db.js";
import { eq } from "drizzle-orm";

const ORACLE_CHANNEL_ID          = "1508188932364435608"; // #🌙┃oracle-of-the-week

const DELULU_ASTRO_CHANNEL_ID    = "1506741216312688820"; // #✨┃delulu-astro
const THIS_WEEK_I_WILL_CHANNEL_ID = "1508188147706757140"; // #🕯️┃this-week-i-will

// ── Astrology constants ─────────────────────────────────────────────────────

const AFFIRMATIONS = [
  "Your manifestation frequency is IMMACULATE today 🔥",
  "The universe has been waiting specifically for YOU 💎",
  "Every cell in your body is vibrating at abundance frequency ✨",
  "Your ancestors are literally clapping in the spirit realm 👏",
  "Saturn is crying tears of JOY for you right now 🪐",
];

const GROUPS: [Nakshatra[], Nakshatra[], Nakshatra[]] = [
  NAKSHATRAS.slice(0, 9) as unknown as Nakshatra[],
  NAKSHATRAS.slice(9, 18) as unknown as Nakshatra[],
  NAKSHATRAS.slice(18, 27) as unknown as Nakshatra[],
];

const GROUP_COLORS  = [0x9b59b6, 0x7b68ee, 0x5b4fcf];
const GROUP_TITLES  = [
  "⭐ Daily Nakshatra Forecast — Ashwini to Ashlesha",
  "⭐ Daily Nakshatra Forecast — Magha to Jyeshtha",
  "⭐ Daily Nakshatra Forecast — Mula to Revati",
];

// ── Milestone definitions ───────────────────────────────────────────────────

const MILESTONES: Record<number, string> = {
  7:   "🌟 **Day 7 — You made it into the inner circle.**\n\nSeven days of showing up for yourself. That's not small. Most people never make it here.\n\nYou've just unlocked something sacred — the abundance meditation and a private space where I drop my deepest transmissions. Guard it. Protect it. It reflects who you're becoming.\n\nI see you. Keep going. 💫",
  14:  "✨ **Day 14 — Two weeks of devotion.**\n\nYour nervous system is literally rewiring. The practice is no longer something you *do* — it's becoming who you *are*.\n\nI'm watching your frequency rise from here. 🌙",
  21:  "💜 **Day 21 — Three weeks. A new pattern is sealed.**\n\nNeurologically, 21 days is where habits crystallise into identity. You didn't just build a streak — you built a new self.\n\nThis is the version of you that manifests without trying. Trust what's coming. 🪐",
  30:  "🔥 **Day 30 — A full month of choosing yourself every single day.**\n\nI want you to sit with that for a moment. Thirty days. Unbroken.\n\nYou are proof that consistency creates miracles. The universe has noted every single check-in. What's being built for you right now is beyond what you can see.\n\nThank you for trusting the process — and for trusting me to hold this space with you. 💎",
  60:  "🌌 **Day 60 — Sixty days. You are now in rare company.**\n\nMost people dream of this. You lived it. Keep going — the 90-day threshold is where everything accelerates. ✨",
  100: "👑 **Day 100 — A hundred days of sacred practice.**\n\nI genuinely don't have words. You are the embodiment of aligned abundance. This channel, this community, this transmission — you helped build it by showing up every single day.\n\nI'm honoured to be on this path with you. 🌟",
};

// ── Bot ─────────────────────────────────────────────────────────────────────

export class AstrologyBot {
  private client: Client;
  private token: string;
  private channelId: string;
  private ready = false;

  constructor(token: string, channelId: string) {
    this.token     = token;
    this.channelId = channelId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on("clientReady", () => {
      logger.info({ tag: this.client.user?.tag }, "Discord bot connected");
      this.ready = true;
      this.registerCommands();
    });

    this.client.on("error", (err) => {
      logger.error({ err }, "Discord client error");
    });

    this.client.on("interactionCreate", async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        await this.handleCommand(interaction);
      } catch (err) {
        logger.error({ err }, "Unhandled error in interaction handler");
      }
    });

    this.client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      if (!message.guildId) return;

      // Only count substantive messages — 6+ words (reactions & short replies don't count).
      // If MessageContent intent is not enabled, content is empty — count all messages as a fallback.
      const wordCount = message.content.trim().split(/\s+/).filter(Boolean).length;
      const countsAsActive = wordCount === 0 /* content unavailable */ || wordCount >= 6;
      if (countsAsActive) {
        try {
          await recordMessageActivity(message.author.id, message.guildId);
        } catch (err) {
          logger.error({ err }, "Failed to record message activity");
        }
      }

      // Respond when the bot is @mentioned
      if (this.client.user && message.mentions.has(this.client.user)) {
        try {
          const msgCount = await getMessageCount(message.author.id, message.guildId);
          const needed   = Math.max(0, DAILY_MSG_MINIMUM - msgCount);
          const status   = needed === 0
            ? `✅ You've sent **${msgCount} messages** today — you're good to **/checkin**!`
            : `💬 **${msgCount}/${DAILY_MSG_MINIMUM}** messages today — send **${needed} more** then use **/checkin**.`;

          const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle("✨ Astro Manifest here!")
            .setDescription(
              `Here's what I can do:\n\n` +
              `**/checkin** — log your daily practice *(requires ${DAILY_MSG_MINIMUM} messages + check-in)*\n` +
              `**/streak** — see your current streak\n` +
              `**/leaderboard** — top streaks in the server\n` +
              `**/cosmos** — today's Vedic nakshatra forecast\n` +
              `**/setreminder HH:MM** — get a daily DM reminder\n\n` +
              status
            )
            .setFooter({ text: "7 consecutive days unlocks the abundance sanctuary 🌟" });

          await message.reply({ embeds: [embed] });
        } catch (err) {
          logger.error({ err }, "Failed to reply to mention");
        }
      }
    });
  }

  // ── Command registration ─────────────────────────────────────────────────

  private async registerCommands() {
    if (!this.client.user) return;
    const guilds = this.client.guilds.cache;
    if (guilds.size === 0) return;

    const commands = [
      new SlashCommandBuilder()
        .setName("cosmos")
        .setDescription("Get today's Vedic nakshatra forecast 🌟")
        .addStringOption((o) =>
          o.setName("sign").setDescription("Optional: your star sign (e.g. Leo)").setRequired(false)
        )
        .toJSON(),

      new SlashCommandBuilder()
        .setName("checkin")
        .setDescription("Log today's practice check-in ✅")
        .toJSON(),

      new SlashCommandBuilder()
        .setName("streak")
        .setDescription("View your current practice streak 🔥")
        .toJSON(),

      new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("See the top streaks in the community 🏆")
        .toJSON(),

      new SlashCommandBuilder()
        .setName("setreminder")
        .setDescription("Set a daily DM reminder for your practice (UTC time) ⏰")
        .addStringOption((o) =>
          o
            .setName("time")
            .setDescription("Time in HH:MM UTC format, e.g. 07:00")
            .setRequired(true)
        )
        .toJSON(),

      new SlashCommandBuilder()
        .setName("removereminder")
        .setDescription("Remove your daily practice reminder")
        .toJSON(),
    ];

    const rest = new REST().setToken(this.token);
    for (const [, guild] of guilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(this.client.user.id, guild.id),
          { body: commands }
        );
        logger.info({ guildId: guild.id }, "Registered slash commands");
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "Failed to register commands");
      }
    }
  }

  // ── Command router ───────────────────────────────────────────────────────

  private async handleCommand(interaction: import("discord.js").ChatInputCommandInteraction) {
    const { commandName } = interaction;

    if (commandName === "cosmos")         return this.handleCosmos(interaction);
    if (commandName === "checkin")        return this.handleCheckin(interaction);
    if (commandName === "streak")         return this.handleStreak(interaction);
    if (commandName === "leaderboard")    return this.handleLeaderboard(interaction);
    if (commandName === "setreminder")    return this.handleSetReminder(interaction);
    if (commandName === "removereminder") return this.handleRemoveReminder(interaction);
  }

  // ── /cosmos ──────────────────────────────────────────────────────────────

  private async safeDefer(interaction: import("discord.js").ChatInputCommandInteraction, ephemeral = false): Promise<boolean> {
    if (interaction.deferred || interaction.replied) return true;
    try {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      return true;
    } catch {
      return false; // already acknowledged or expired
    }
  }

  private async handleCosmos(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction)) return;
    try {
      const forecast = await generateDailyForecast();
      const embeds   = buildForecastEmbeds(forecast.nakshatras);
      await interaction.editReply({ embeds });
    } catch (err) {
      logger.error({ err }, "Error handling /cosmos");
      await interaction.editReply("The cosmos are temporarily recalibrating. Try again! ✨");
    }
  }

  // ── /checkin ─────────────────────────────────────────────────────────────

  private async handleCheckin(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction, false)) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply("This command only works inside a server.");
      return;
    }

    try {
      const msgCount = await getMessageCount(userId, guildId);

      // Block check-in if they haven't sent enough messages today
      if (msgCount < DAILY_MSG_MINIMUM) {
        const needed = DAILY_MSG_MINIMUM - msgCount;
        const embed = new EmbedBuilder()
          .setColor(0xff9500)
          .setTitle("💬 Not so fast!")
          .setDescription(
            `You need to **interact with the community first** before checking in.\n\n` +
            `Send **${needed} more message${needed === 1 ? "" : "s"}** in the server today *(6+ words each)* then come back to check in.\n\n` +
            `Today's messages: **${msgCount}/${DAILY_MSG_MINIMUM}**\n\n` +
            `*Real participation, real results. Go connect with your people! 🌙*`
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const result   = await recordCheckIn(userId, guildId);

      if (result.status === "already_checked_in") {
        const { streak, messageDays } = result;
        const msgDaysLeft = Math.max(0, MSG_DAYS_REQUIRED - messageDays);
        const embed = new EmbedBuilder()
          .setColor(0x7b68ee)
          .setTitle("✅ Already checked in today!")
          .setDescription(
            `You're on a **${streak}-day streak** 🔥\n\n` +
            `📊 **Unlock progress:**\n` +
            `Check-ins: **${streak}/${STREAK_UNLOCK_DAYS}** days\n` +
            `Active days: **${messageDays}/${MSG_DAYS_REQUIRED}** days with ${DAILY_MSG_MINIMUM}+ messages\n\n` +
            (msgDaysLeft > 0 && msgCount < DAILY_MSG_MINIMUM
              ? `💬 Today's messages: **${msgCount}** *(need ${DAILY_MSG_MINIMUM - msgCount} more 6-word+ messages today to count)*`
              : `💬 Today's messages: **${msgCount}** ✅`)
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const { streak, longestStreak, messageDays, unlocked, revoked } = result;

      // Handle role changes
      if (interaction.guild) {
        if (revoked) {
          await this.revokeAbundanceRole(interaction.guild, userId);
        } else if (unlocked) {
          await this.grantAbundanceRole(interaction.guild, userId);
        }
      }

      // Send milestone DM if applicable
      if (MILESTONES[streak]) {
        this.sendMilestoneDM(interaction.user, streak).catch((err) =>
          logger.warn({ err }, "Could not send milestone DM")
        );
      }

      // Build reply embed
      const daysToUnlock   = Math.max(0, STREAK_UNLOCK_DAYS - streak);
      const msgDaysLeft    = Math.max(0, MSG_DAYS_REQUIRED - messageDays);
      const progressBar    = buildProgressBar(streak);
      const msgBar         = buildProgressBar(messageDays, MSG_DAYS_REQUIRED);

      let description: string;
      if (unlocked) {
        description =
          `🌟 **You've unlocked the inner circle!**\n` +
          `You now have access to **#⚛️┃aligned-abundance**.\n\n` +
          `Keep showing up — miss ${MISS_REVOKE_DAYS} days and access is revoked.`;
      } else if (revoked) {
        description =
          `💔 **Access revoked.**\nYou missed ${MISS_REVOKE_DAYS}+ days so your abundance access has been removed.\n` +
          `Build back to ${STREAK_UNLOCK_DAYS} check-ins + ${MSG_DAYS_REQUIRED} active days to re-unlock. 🌱`;
      } else if (streak >= STREAK_UNLOCK_DAYS && msgDaysLeft === 0) {
        description = `You're in the inner circle! Keep protecting it. 🔐`;
      } else {
        description =
          `📅 **Check-in streak:** ${progressBar} ${streak}/${STREAK_UNLOCK_DAYS}\n` +
          `💬 **Active message days:** ${msgBar} ${messageDays}/${MSG_DAYS_REQUIRED}\n\n` +
          (daysToUnlock > 0 ? `${daysToUnlock} more check-in${daysToUnlock === 1 ? "" : "s"}` : ``) +
          (daysToUnlock > 0 && msgDaysLeft > 0 ? ` + ` : ``) +
          (msgDaysLeft > 0 ? `${msgDaysLeft} more active day${msgDaysLeft === 1 ? "" : "s"} (send ${DAILY_MSG_MINIMUM}+ messages)` : ``) +
          ` to unlock the abundance sanctuary.\n\n` +
          (msgCount < DAILY_MSG_MINIMUM
            ? `💬 Today's messages: **${msgCount}/${DAILY_MSG_MINIMUM}** — keep chatting! *(6+ words per message)*`
            : `💬 Today's messages: **${msgCount}** ✅`);
      }

      const PUBLIC_ANNOUNCEMENTS = [
        "showed up. Again. 💪",
        "kept their promise to themselves today 🔥",
        "is proof that consistency wins 🔥",
        "chose themselves today. Non-negotiable. ✨",
        "did the work. The universe noticed. 🌙",
        "showing up like the main character she is 👑",
        "is literally rewriting her reality 💫",
        "building her streak one day at a time 🌟",
        "is not playing around this season 🔥",
        "turned up for herself today. That's the whole game. 💎",
        "activated something today. We felt it. ⚡",
        "is proof that aligned action works 🌸",
        "raised her frequency today. Feel that? 🌊",
        "is not the same person she was when she started 🦋",
        "chose growth over comfort today. CEO behaviour. 👑",
      ];

      const announcement = PUBLIC_ANNOUNCEMENTS[(streak - 1) % PUBLIC_ANNOUNCEMENTS.length];
      const daysLeft = Math.max(0, STREAK_UNLOCK_DAYS - streak);

      const embed = new EmbedBuilder()
        .setColor(unlocked ? 0xffd700 : revoked ? 0xff4444 : 0x9b59b6)
        .setTitle(`<@${userId}> ${announcement}`)
        .setDescription(
          unlocked
            ? `🌟 **Inner circle unlocked!** Access to **#⚛️┃aligned-abundance** granted.`
            : revoked
            ? `💔 Access revoked. Build back to unlock again. 🌱`
            : `**Day ${streak}** · ${daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} to unlock #aligned-abundance` : `You're in the inner circle! Keep protecting it. 🔐`}`
        )
        .setFooter({ text: `Longest streak: ${longestStreak} days` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error handling /checkin");
      await interaction.editReply("Something went wrong. Try again in a moment. 🌙");
    }
  }

  // ── /streak ──────────────────────────────────────────────────────────────

  private async handleStreak(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction, true)) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply("This command only works inside a server.");
      return;
    }

    try {
      const data = await getStreak(userId, guildId);

      if (!data || data.currentStreak === 0) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("🌱 No streak yet")
          .setDescription(
            `You haven't started your streak yet!\nUse **/checkin** daily for ${STREAK_UNLOCK_DAYS} consecutive days to unlock the abundance sanctuary.`
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const { currentStreak, longestStreak, abundanceUnlocked, reminderTime } = data;
      const daysLeft   = Math.max(0, STREAK_UNLOCK_DAYS - currentStreak);
      const progressBar = buildProgressBar(currentStreak);

      const embed = new EmbedBuilder()
        .setColor(abundanceUnlocked ? 0xffd700 : 0x9b59b6)
        .setTitle(`🔥 Your Practice Streak`)
        .addFields(
          { name: "Current Streak",  value: `**${currentStreak} day${currentStreak === 1 ? "" : "s"}**`,  inline: true },
          { name: "Longest Streak",  value: `**${longestStreak} day${longestStreak === 1 ? "" : "s"}**`,  inline: true },
          { name: "Inner Circle",    value: abundanceUnlocked ? "🌟 **Unlocked**" : `🔒 ${daysLeft} day${daysLeft === 1 ? "" : "s"} away`, inline: true },
        )
        .setDescription(abundanceUnlocked ? `${progressBar}\nYou're inside. Keep showing up. 🔐` : progressBar);

      if (reminderTime) {
        embed.setFooter({ text: `Daily reminder set for ${reminderTime} UTC` });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error handling /streak");
      await interaction.editReply("Could not fetch your streak. Try again. 🌙");
    }
  }

  // ── /leaderboard ─────────────────────────────────────────────────────────

  private async handleLeaderboard(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction)) return;

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply("This command only works inside a server.");
      return;
    }

    try {
      const embed = await this.buildLeaderboardEmbed(interaction.guild!, guildId);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error handling /leaderboard");
      await interaction.editReply("Could not load the leaderboard. Try again. 🌙");
    }
  }

  // ── /setreminder ─────────────────────────────────────────────────────────

  private async handleSetReminder(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction, true)) return;

    const time    = interaction.options.getString("time", true).trim();
    const userId  = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply("This command only works inside a server.");
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      await interaction.editReply("Please use HH:MM format, e.g. `07:30` (UTC time).");
      return;
    }

    const [hh, mm] = time.split(":").map(Number);
    if (hh > 23 || mm > 59) {
      await interaction.editReply("Invalid time. Hours must be 00–23 and minutes 00–59.");
      return;
    }

    try {
      await setReminder(userId, guildId, time);
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("⏰ Reminder set!")
        .setDescription(
          `I'll DM you every day at **${time} UTC** to remind you to check in.\n\n` +
          `Use **/removereminder** to cancel anytime.`
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Error handling /setreminder");
      await interaction.editReply("Could not set your reminder. Try again. 🌙");
    }
  }

  // ── /removereminder ──────────────────────────────────────────────────────

  private async handleRemoveReminder(interaction: import("discord.js").ChatInputCommandInteraction) {
    if (!await this.safeDefer(interaction, true)) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply("This command only works inside a server.");
      return;
    }

    try {
      await setReminder(userId, guildId, null);
      await interaction.editReply("✅ Your daily reminder has been removed.");
    } catch (err) {
      logger.error({ err }, "Error removing reminder");
      await interaction.editReply("Could not remove your reminder. Try again. 🌙");
    }
  }

  // ── Leaderboard builder (shared) ─────────────────────────────────────────

  async buildLeaderboardEmbed(guild: Guild, guildId: string): Promise<EmbedBuilder> {
    const rows = await getLeaderboard(guildId, 10);

    const medals = ["🥇", "🥈", "🥉"];
    const lines: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i]!;
      const medal  = medals[i] ?? `**${i + 1}.**`;
      const inside = row.abundanceUnlocked ? " 🌟" : "";
      let name     = `<@${row.userId}>`;

      try {
        const member = await guild.members.fetch(row.userId);
        name = member.displayName;
      } catch {
        // user left or fetch failed — keep mention
      }

      lines.push(
        `${medal} **${name}**${inside} — 🔥 ${row.currentStreak} day${row.currentStreak === 1 ? "" : "s"}`
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🏆 Cosmic Creator Leaderboard")
      .setDescription(
        lines.length
          ? lines.join("\n") + "\n\n🌟 = inside the abundance sanctuary"
          : "No streaks yet! Be the first — use **/checkin** to start."
      )
      .setFooter({ text: `Check in daily • ${STREAK_UNLOCK_DAYS} consecutive days unlocks the inner circle` })
      .setTimestamp();

    return embed;
  }

  // ── Role helpers ─────────────────────────────────────────────────────────

  private async grantAbundanceRole(guild: Guild, userId: string): Promise<void> {
    try {
      const role = guild.roles.cache.find((r) => r.name === ABUNDANCE_ROLE_NAME);
      if (!role) {
        logger.warn({ roleName: ABUNDANCE_ROLE_NAME }, "Abundance role not found in guild");
        return;
      }
      const member = await guild.members.fetch(userId);
      await member.roles.add(role);
      logger.info({ userId, roleName: ABUNDANCE_ROLE_NAME }, "Abundance role granted");
    } catch (err) {
      logger.error({ err, userId }, "Failed to grant abundance role");
    }
  }

  async revokeAbundanceRole(guild: Guild, userId: string): Promise<void> {
    try {
      const role = guild.roles.cache.find((r) => r.name === ABUNDANCE_ROLE_NAME);
      if (!role) return;
      const member = await guild.members.fetch(userId);
      await member.roles.remove(role);
      logger.info({ userId, roleName: ABUNDANCE_ROLE_NAME }, "Abundance role revoked");
    } catch (err) {
      logger.error({ err, userId }, "Failed to revoke abundance role");
    }
  }

  // ── Role sync (backfill / admin) ─────────────────────────────────────────

  async syncRoles(guildId: string): Promise<{ granted: string[]; revoked: string[]; skipped: string[] }> {
    const guild = await this.client.guilds.fetch(guildId);
    await guild.roles.fetch();

    const allStreaks = await db.select().from(userStreaks).where(eq(userStreaks.guildId, guildId));
    const granted: string[] = [];
    const revoked: string[] = [];
    const skipped: string[] = [];

    for (const row of allStreaks) {
      if (row.currentStreak >= STREAK_UNLOCK_DAYS) {
        try {
          await this.grantAbundanceRole(guild, row.userId);
          granted.push(row.userId);
        } catch {
          skipped.push(row.userId);
        }
      } else {
        try {
          await this.revokeAbundanceRole(guild, row.userId);
          revoked.push(row.userId);
        } catch {
          skipped.push(row.userId);
        }
      }
    }
    logger.info({ granted, revoked, skipped }, "syncRoles complete");
    return { granted, revoked, skipped };
  }

  // ── Milestone DM ─────────────────────────────────────────────────────────

  private async sendMilestoneDM(user: import("discord.js").User, streak: number): Promise<void> {
    const message = MILESTONES[streak];
    if (!message) return;
    try {
      const dm = await user.createDM();
      await dm.send(message);
      logger.info({ userId: user.id, streak }, "Milestone DM sent");
    } catch (err) {
      logger.warn({ err, userId: user.id }, "Could not DM user for milestone");
    }
  }

  // ── Scheduled jobs (called from scheduler) ───────────────────────────────

  /** Runs daily at midnight UTC: check for missed days, revoke roles, post leaderboard. */
  async runDailyMissProcessing(): Promise<void> {
    if (!this.ready) return;

    for (const [, guild] of this.client.guilds.cache) {
      try {
        const revokedIds = await processDailyMisses(guild.id);
        for (const userId of revokedIds) {
          await this.revokeAbundanceRole(guild, userId);

          // DM the revoked user
          try {
            const member = await guild.members.fetch(userId);
            const dm = await member.user.createDM();
            await dm.send(
              `💔 **Your abundance sanctuary access has been revoked.**\n\n` +
              `You missed ${MISS_REVOKE_DAYS} consecutive days of practice.\n\n` +
              `The path is always open. Use **/checkin** daily and rebuild your streak to ${STREAK_UNLOCK_DAYS} days to re-unlock it. 🌱`
            );
          } catch {
            // DMs disabled — that's fine
          }
        }

        // Kick inactive members (no check-in AND no messages for 5+ days)
        await this.runInactiveKicks(guild);

        // Post leaderboard
        await this.postDailyLeaderboard(guild);
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "Error in daily miss processing");
      }
    }
  }

  /** Kicks members who have been completely inactive for INACTIVE_KICK_DAYS days. */
  private async runInactiveKicks(guild: Guild): Promise<void> {
    const inactiveIds = await getInactiveUsers(guild.id);
    for (const userId of inactiveIds) {
      try {
        const member = await guild.members.fetch(userId);

        // DM them first
        try {
          const dm = await member.user.createDM();
          await dm.send(
            `🌙 **You've been removed from Cosmic Creator's.**\n\n` +
            `You had no check-ins and no messages for ${INACTIVE_KICK_DAYS} consecutive days.\n\n` +
            `The path is always open — re-verify your purchase to rejoin and start fresh. ✨`
          );
        } catch {
          // DMs disabled — kick anyway
        }

        await member.kick(`Inactive for ${INACTIVE_KICK_DAYS}+ days (no check-in or messages)`);
        logger.info({ userId, guildId: guild.id }, "Kicked inactive member");
      } catch (err) {
        logger.error({ err, userId }, "Failed to kick inactive member");
      }
    }
  }

  /** Posts the daily oracle card to #🌙┃oracle-of-the-week at 9 AM IST. */
  async postDailyOracleCard(): Promise<void> {
    if (!this.ready) return;
    try {
      const channel = await this.client.channels.fetch(ORACLE_CHANNEL_ID);
      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ channelId: ORACLE_CHANNEL_ID }, "oracle channel not found");
        return;
      }
      const card  = await generateOracleCard();
      const weekOf = new Date().toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      });
      const embed = new EmbedBuilder()
        .setColor(0x4b0082)
        .setTitle(`🌙 Oracle of the Week — ${card.name}`)
        .setDescription(card.message)
        .addFields(
          { name: "✦ Theme",       value: card.theme,             inline: true  },
          { name: "✦ Guidance",    value: card.guidance,          inline: false },
          { name: "✦ Affirmation", value: `*${card.affirmation}*`, inline: false },
        )
        .setFooter({ text: `Week of ${weekOf}` });
      await channel.send({ embeds: [embed] });
      logger.info("Daily oracle card posted");
    } catch (err) {
      logger.error({ err }, "Failed to post daily oracle card");
    }
  }

  /** Posts the weekly manifestation prompt to #🕯️┃this-week-i-will every Monday. */
  async postWeeklyManifestation(): Promise<void> {
    if (!this.ready) return;
    try {
      const channel = await this.client.channels.fetch(THIS_WEEK_I_WILL_CHANNEL_ID);
      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ channelId: THIS_WEEK_I_WILL_CHANNEL_ID }, "this-week-i-will channel not found");
        return;
      }
      const prompt = await generateManifestationPrompt();
      await channel.send(`@everyone\n\n${prompt}`);
      logger.info("Weekly manifestation prompt posted");
    } catch (err) {
      logger.error({ err }, "Failed to post weekly manifestation prompt");
    }
  }

  /** Posts the leaderboard to #leaderboard channel. */
  async postDailyLeaderboard(guild: Guild): Promise<void> {
    try {
      const channel = guild.channels.cache.get(LEADERBOARD_CHANNEL_ID);
      if (!channel || !(channel instanceof TextChannel)) return;

      const embed = await this.buildLeaderboardEmbed(guild, guild.id);
      await channel.send({ embeds: [embed] });
      logger.info({ guildId: guild.id }, "Daily leaderboard posted");
    } catch (err) {
      logger.error({ err }, "Failed to post daily leaderboard");
    }
  }

  /** Runs every minute: DM users whose reminderTime matches now (UTC HH:MM). */
  async sendPendingReminders(): Promise<void> {
    if (!this.ready) return;

    for (const [, guild] of this.client.guilds.cache) {
      try {
        const users = await getUsersDueReminder(guild.id);
        for (const row of users) {
          try {
            const member = await guild.members.fetch(row.userId);
            const dm     = await member.user.createDM();
            const daysLeft = Math.max(0, STREAK_UNLOCK_DAYS - row.currentStreak);
            const inside   = row.abundanceUnlocked;

            const text = inside
              ? `🌟 **Time for your daily practice!**\n\nYou're in the inner circle — keep it protected. Use **/checkin** after your session. 🔐`
              : `⏰ **Time for your daily practice!**\n\nYou're on a **${row.currentStreak}-day streak** 🔥 — ${daysLeft} more day${daysLeft === 1 ? "" : "s"} until the abundance sanctuary unlocks.\n\nUse **/checkin** after your session. ✨`;

            await dm.send(text);
          } catch {
            // DMs disabled or user left
          }
        }
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "Error sending reminders");
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async login() {
    await this.client.login(this.token);
  }

  async postDailyPrediction(): Promise<void> {
    if (!this.ready) {
      logger.warn("Bot not ready, skipping daily post");
      return;
    }

    try {
      // Always post the daily forecast to #✨┃delulu-astro
      const targetId = DELULU_ASTRO_CHANNEL_ID;
      const channel  = await this.client.channels.fetch(targetId);
      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ channelId: targetId }, "delulu-astro channel not found or not a text channel");
        return;
      }

      const forecast    = await generateDailyForecast();
      const today       = new Date().toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
      const affirmation = AFFIRMATIONS[new Date().getDate() % AFFIRMATIONS.length];

      await channel.send(`@everyone ✨ **Today's Forecast — ${today}** ✨\n> *${affirmation}*`);

      for (const embed of buildForecastEmbeds(forecast.nakshatras)) {
        await channel.send({ embeds: [embed] });
      }

      logger.info("Daily nakshatra forecast posted to #delulu-astro");
    } catch (err) {
      logger.error({ err }, "Failed to post daily prediction");
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  getGuild(): import("discord.js").Guild | undefined {
    return this.client.guilds.cache.first();
  }
}

// ── Forecast embed builder ────────────────────────────────────────────────

function buildForecastEmbeds(nakshatras: Record<Nakshatra, string>): EmbedBuilder[] {
  return GROUPS.map((group, i) => {
    const embed = new EmbedBuilder()
      .setColor(GROUP_COLORS[i])
      .setTitle(GROUP_TITLES[i]);

    if (i === 2) {
      embed.setFooter({ text: "Vedic Astrology • Delusional Optimism Division • Manifest accordingly 🌙" });
    }

    for (const nakshatra of group) {
      embed.addFields({
        name:   `✦ ${nakshatra}`,
        value:  nakshatras[nakshatra] ?? "Your nakshatra energy is fully activated and working in your favour. ✨",
        inline: false,
      });
    }

    return embed;
  });
}

// ── Progress bar helper ────────────────────────────────────────────────────

function buildProgressBar(current: number, total = STREAK_UNLOCK_DAYS): string {
  const filled = Math.min(current, total);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, total - filled));
  return `\`${bar}\` ${filled}/${total}`;
}
