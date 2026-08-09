import { createRegisterCommand, type PluginContext } from "@sharkord/plugin-sdk";
import type { Commands } from "../contracts/commands";
import * as fs from "fs";
import * as path from "path";

// ─── Types ───────────────────────────────────────────────────────────────
interface ChatMessage {
  userId: number | null;      // AI replies use null for userId to distinguish them
  content: string;
  timestamp: number;
}

interface ChannelHistory {
  messages: ChatMessage[];    // User messages (includes trigger prefix)
  aiReplies: ChatMessage[];   // Bot responses only
}

interface UserTokenRecord {
  tokensUsed: number;
  resetTime: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function getHistoryDir(ctx: PluginContext): string {
  const dir = path.join(ctx.path, "history");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getHistoryPath(ctx: PluginContext, channelId: number): string {
  return path.join(getHistoryDir(ctx), `channel-${channelId}.json`);
}

function loadHistory(ctx: PluginContext, channelId: number): ChannelHistory {
  const filePath = getHistoryPath(ctx, channelId);
  if (!fs.existsSync(filePath)) {
    return { messages: [], aiReplies: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.messages) && Array.isArray(parsed.aiReplies)) {
      return parsed as ChannelHistory;
    }
    ctx.warn(`Corrupted history file for channel ${channelId}, resetting.`);
    return { messages: [], aiReplies: [] };
  } catch (err) {
    ctx.error(`Failed to read history for channel ${channelId}:`, err);
    return { messages: [], aiReplies: [] };
  }
}

function saveHistory(ctx: PluginContext, channelId: number, history: ChannelHistory): void {
  const filePath = getHistoryPath(ctx, channelId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch (err) {
    ctx.error(`Failed to save history for channel ${channelId}:`, err);
  }
}

function trimHistory(history: ChannelHistory, maxMessages: number): ChannelHistory {
  const all = [...history.messages, ...history.aiReplies].sort((a, b) => a.timestamp - b.timestamp);
  const kept = all.slice(-maxMessages);
  return {
    messages: history.messages.filter(m => kept.includes(m)),
    aiReplies: history.aiReplies.filter(m => kept.includes(m)),
  };
}

// ── FIXED: Build API messages purely from chronological history ──────────
function buildApiMessages(
  history: ChannelHistory,
): Array<{ role: string; content: string }> {
  // Merge all messages and sort by timestamp.
  // userId === null means it's an AI reply (assistant), otherwise user.
  const all = [...history.messages, ...history.aiReplies].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  return all.map(m => ({
    role: m.userId === null ? "assistant" : "user",
    content: m.content,
  }));
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

async function callApi(
  ctx: PluginContext,
  baseUrl: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  timeoutMs: number,
  apiKey?: string,
): Promise<{ reply: string; tokensUsed: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  ctx.debug(`Calling API: ${url} with model ${model}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? "(No response from API)";
    const tokensUsed = data.usage?.total_tokens ?? 0;
    return { reply, tokensUsed };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Plugin State ────────────────────────────────────────────────────────
const rateLimitMap = new Map<number, number>();
const userTokenMap = new Map<number, UserTokenRecord>();
const channelLocks = new Map<number, Promise<void>>();

function withChannelLock<T>(channelId: number, fn: () => Promise<T>): Promise<T> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  channelLocks.set(channelId, next.then(() => undefined, () => undefined));
  return next;
}

function checkTokenLimit(userId: number, limitPerHour: number, now: number): { allowed: boolean; resetInMinutes: number } {
  if (limitPerHour <= 0) return { allowed: true, resetInMinutes: 0 };

  let record = userTokenMap.get(userId);
  if (!record || now > record.resetTime) {
    record = { tokensUsed: 0, resetTime: now + 3600_000 };
    userTokenMap.set(userId, record);
  }

  if (record.tokensUsed >= limitPerHour) {
    return { allowed: false, resetInMinutes: Math.ceil((record.resetTime - now) / 60_000) };
  }
  return { allowed: true, resetInMinutes: 0 };
}

// ─── Plugin Init ─────────────────────────────────────────────────────────
const onLoad = async (ctx: PluginContext) => {
  ctx.log("AI Chat plugin loaded");

  const settings = await ctx.settings.register([
    {
      key: "api-url",
      name: "API URL",
      description: "Base URL of your OpenAI-compatible API instance (e.g., Ollama, vLLM, LiteLLM). Some OpenAI end points (Open-WebUI) may require the /api suffix, otherwise you will get a 405 error.",
      type: "string",
      defaultValue: "http://localhost:11434",
    },
    {
      key: "api-key",
      name: "API Key",
      description: "Optional Bearer token for authentication",
      type: "string",
      defaultValue: "",
    },
    {
      key: "model-name",
      name: "Model Name",
      description: "Name of the model to use",
      type: "string",
      defaultValue: "llama3.2",
    },
    {
      key: "system-prompt",
      name: "System Prompt",
      description: "Optional system prompt sent to the model",
      type: "string",
      defaultValue: "You are an AI Chat bot in a sharkord chat server, you are not allowed to make any tool calls. You are allowed to be rowdy, call people names, and be generally mean. Curse words are allowed. You are roleplaying as Naruto, end every message with Dattebayo!",
    },
    {
      key: "history-length",
      name: "History Length",
      description: "Messages to keep as context",
      type: "number",
      defaultValue: 20,
    },
    {
      key: "timeout-seconds",
      name: "Request Timeout",
      description: "Seconds to wait for API response",
      type: "number",
      defaultValue: 120,
    },
    {
      key: "rate-limit-seconds",
      name: "Rate Limit (seconds)",
      description: "Minimum seconds between AI replies per channel (0 to disable)",
      type: "number",
      defaultValue: 5,
    },
    {
      key: "token-limit-per-hour",
      name: "Token Limit (per hour)",
      description: "Maximum tokens a single user can consume per hour (0 to disable)",
      type: "number",
      defaultValue: 0,
    },
    {
      key: "trigger-prefix",
      name: "Trigger Prefix",
      description: 'Message prefix that triggers AI reply. Leave empty to disable. For ease of use, I recommend creating a user with no permissions so it is easier to call the model.',
      type: "string",
      defaultValue: "@OpenAI ",
    },
  ]);

  // ─── Register Commands (for autocomplete / command list) ──────────────
  const registerCommand = createRegisterCommand<Commands>(ctx);

  registerCommand("chatbot", { description: "Learn how to use the AI chat bot." }, async () => "");
  registerCommand("quota", { description: "Check your remaining AI token quota for this hour." }, async () => "");

  // ─── Message Listener ──────────────────────────────────────────────────
  ctx.events.on("message:created", async (payload) => {
    if (!payload.messageId || !payload.channelId) return;

    const text = payload.textContent || "";

    // ─── Handle /chatbot via delete-and-replace pattern ─────────────────
    if (text.trim().toLowerCase() === "/chatbot") {
      ctx.debug(`Deleting command message ${payload.messageId} in channel ${payload.channelId}: "${text}"`);
      try { await ctx.messages.delete(payload.messageId); } catch (err) { ctx.error(`Failed to delete message ${payload.messageId}`, err); }

      const triggerPrefix = (await settings.get("trigger-prefix")) as string;
      if (!triggerPrefix) {
        await ctx.messages.send(payload.channelId, "⚠️ The AI chat bot is currently disabled. Contact an admin to configure a trigger prefix.");
        return;
      }
      await ctx.messages.send(payload.channelId, `💬 Mention ${triggerPrefix.trim()} at the start of your message to talk with the AI Bot.`);
      return;
    }

    // ─── Handle /quota via delete-and-replace pattern ──────────────────
    if (text.trim().toLowerCase() === "/quota") {
      ctx.debug(`Deleting command message ${payload.messageId} in channel ${payload.channelId}: "${text}"`);
      try { await ctx.messages.delete(payload.messageId); } catch (err) { ctx.error(`Failed to delete message ${payload.messageId}`, err); }

      const tokenLimitPerHour = (await settings.get("token-limit-per-hour")) as number;
      if (tokenLimitPerHour <= 0) {
        await ctx.messages.send(payload.channelId, "✅ Token limits are currently disabled. You have unlimited access!");
        return;
      }

      const userId = Number(payload.userId);
      if (!userId) {
        await ctx.messages.send(payload.channelId, "⚠️ Could not identify user.");
        return;
      }

      const now = Date.now();
      let record = userTokenMap.get(userId);

      if (!record || now > record.resetTime) {
        await ctx.messages.send(payload.channelId, `✅ You have your full quota of ${tokenLimitPerHour} tokens available for this hour.`);
        return;
      }

      const remaining = Math.max(0, tokenLimitPerHour - record.tokensUsed);
      const resetInMinutes = Math.ceil((record.resetTime - now) / 60_000);
      await ctx.messages.send(payload.channelId, `📊 You have ${remaining} tokens remaining out of ${tokenLimitPerHour}. Your quota resets in ${resetInMinutes} minute(s).`);
      return;
    }

    // ─── Skip our own plugin messages (strict check) ────────────────────
    if (payload.pluginId && payload.pluginId !== ctx.pluginId) return;
    if (payload.pluginId) return;

    const triggerPrefix = (await settings.get("trigger-prefix")) as string;
    const historyLength = (await settings.get("history-length")) as number;
    const rateLimitSeconds = (await settings.get("rate-limit-seconds")) as number;
    const tokenLimitPerHour = (await settings.get("token-limit-per-hour")) as number;

    // 1. Persist user message to history
    await withChannelLock(payload.channelId, () =>
      (async () => {
        const history = loadHistory(ctx, payload.channelId);
        history.messages.push({
          userId: payload.userId,
          content: text,
          timestamp: Date.now(),
        });
        saveHistory(ctx, payload.channelId, trimHistory(history, historyLength));
      })(),
    );

    // 2. Check trigger prefix for AI chat
    if (!triggerPrefix || !text.startsWith(triggerPrefix)) return;

    const question = text.slice(triggerPrefix.length).trim();
    if (!question) return;

    // 3. Per-channel cooldown
    if (rateLimitSeconds > 0) {
      const lastReply = rateLimitMap.get(payload.channelId) ?? 0;
      const elapsed = (Date.now() - lastReply) / 1000;
      if (elapsed < rateLimitSeconds) {
        const remaining = Math.ceil(rateLimitSeconds - elapsed);
        await ctx.messages.send(payload.channelId, `⏳ Please wait ${remaining}s before asking again.`);
        return;
      }
      rateLimitMap.set(payload.channelId, Date.now());
    }

    // 4. Per-user token limit check
    if (payload.userId && tokenLimitPerHour > 0) {
      const { allowed, resetInMinutes } = checkTokenLimit(payload.userId, tokenLimitPerHour, Date.now());
      if (!allowed) {
        await ctx.messages.send(payload.channelId, `⚠️ Hourly token limit reached. Try again in ${resetInMinutes} minute(s).`);
        return;
      }
    }

    ctx.debug(`AI trigger in channel ${payload.channelId}`);

    // 5. Call API & post response (serialized per channel)
    await withChannelLock(payload.channelId, () =>
      (async () => {
        try {
          const apiUrl = (await settings.get("api-url")) as string;
          if (!isValidHttpUrl(apiUrl)) throw new Error("Invalid API URL configured.");

          const apiKey = (await settings.get("api-key")) as string;
          const modelName = (await settings.get("model-name")) as string;
          const systemPrompt = (await settings.get("system-prompt")) as string;
          const timeoutSeconds = (await settings.get("timeout-seconds")) as number;

          if (!modelName?.trim()) throw new Error("Model name is not configured.");

          // Load fresh history (already includes the user's current message)
          const history = loadHistory(ctx, payload.channelId);
          const trimmed = trimHistory(history, historyLength);

          // Build API messages from full chronological history only.
          // The user's latest message is already included; do not pass question again.
          let apiMessages = buildApiMessages(trimmed);

          // Inject system prompt first if provided
          if (systemPrompt.trim()) {
            apiMessages = [{ role: "system", content: systemPrompt }, ...apiMessages];
          }

          const { reply, tokensUsed } = await callApi(
            ctx, apiUrl, modelName.trim(), apiMessages, timeoutSeconds * 1000, apiKey,
          );

          // Update user token quota
          if (payload.userId && tokenLimitPerHour > 0) {
            let record = userTokenMap.get(payload.userId);
            if (record) record.tokensUsed += tokensUsed;
          }

          // Save AI reply to history with userId: null so it's recognized as assistant
          trimmed.aiReplies.push({
            userId: null,
            content: reply,
            timestamp: Date.now(),
          });
          saveHistory(ctx, payload.channelId, trimmed);
          await ctx.messages.send(payload.channelId, reply);
        } catch (err) {
          ctx.error("AI request failed:", err);
          const errorMsg =
            err instanceof Error && err.name === "AbortError"
              ? `⚠️ Timeout: API didn't respond within ${(await settings.get("timeout-seconds")) as number}s.`
              : `⚠️ Error: ${err instanceof Error ? err.message : String(err)}`;

          try { await ctx.messages.send(payload.channelId, errorMsg); } catch { /* ignore */ }
        }
      })(),
    );
  });
};

// ─── Plugin Cleanup ──────────────────────────────────────────────────────
const onUnload = (ctx: PluginContext) => {
  rateLimitMap.clear();
  userTokenMap.clear();
  channelLocks.clear();
  ctx.log("AI Chat plugin unloaded");
};

export { onLoad, onUnload };
