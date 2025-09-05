console.log("🚀 bot.js is starting...");
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Minimal web server so Render sees an open port + a pingable health route
app.get('/', (_req, res) => res.send('Bot is running 🚀'));
app.get('/healthz', (_req, res) => {
  console.log(`🩺 health ping @ ${new Date().toISOString()}`);
  res.send('ok');
});
app.listen(PORT, () => console.log(`✅ Web server listening on port ${PORT}`));

// === 1. Load credentials from .env ===
const token = process.env.BOT_TOKEN;
const mongoURI = process.env.MONGODB_URI;

// === 2. Connect to MongoDB Atlas ===
mongoose.connect(mongoURI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// === 3. Define User schema ===
const UserSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  lastDrinkDate: { type: Date, required: true },
  streak: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// === 4. Create the bot ===
const bot = new TelegramBot(token, { polling: true });
console.log("🤖 Bot started and polling...");

// === 5. Handle messages ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    bot.sendMessage(
      chatId,
      "Здравствуйте! Введите дату, когда вы пили алкоголь последний раз (в формате YYYY-MM-DD, например, 2025-08-12):"
    );
    return;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (datePattern.test(text)) {
    const lastDrink = new Date(text);
    let user = await User.findOne({ chatId });

    if (!user) {
      user = new User({ chatId, lastDrinkDate: lastDrink, streak: 0 });
    } else {
      user.lastDrinkDate = lastDrink;
      user.streak = 0;
    }

    await user.save();

    const diffDays = Math.floor((Date.now() - lastDrink.getTime()) / (1000 * 60 * 60 * 24));
    bot.sendMessage(chatId, `Дней без алкоголя: ${diffDays}`);
  }
});

// === 6. Handle Yes/No button responses ===
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  const user = await User.findOne({ chatId });
  if (!user) return;

  if (data === "yes") {
    user.streak = 0;
    user.lastDrinkDate = new Date();
    await user.save();
    bot.sendMessage(chatId, "Вы выпили вчера. Дней без алкоголя: 0");
  } else if (data === "no") {
    user.streak += 1;
    await user.save();
    bot.sendMessage(chatId, `Вы не выпивали вчера. Дней без алкоголя: ${user.streak}`);
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

// === 7. Daily reminder at 9 AM (single cron) ===
cron.schedule('0 9 * * *', async () => {
  try {
    const users = await User.find();
    console.log(`🕘 cron fired (Europe/Moscow): sending daily prompt to ${users.length} users`);
    await Promise.all(
      users.map(u =>
        bot.sendMessage(u.chatId, "Вы выпивали вчера?", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Yes", callback_data: "yes" }],
              [{ text: "No", callback_data: "no" }]
            ]
          }
        })
      )
    );
  } catch (e) {
    console.error("❌ cron error:", e);
  }
}, {
  timezone: "Europe/Moscow"
});
