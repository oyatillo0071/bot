import { Bot, InlineKeyboard } from "grammy";
import { jsonDatabase as db } from "./jsonDb.js";
import * as cron from "node-cron";

const BOT_TOKEN = process.env.BOT_TOKEN || "";
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not defined in .env");
}

export const bot = new Bot(BOT_TOKEN);

// Temporary state for expenses
interface PendingExpense {
    amount: number;
    description: string;
    groupId: string;
    payerId: string;
    mode: 'equal' | 'manual';
    currentMemberIndex: number; // For manual mode
    membersToAsk: { id: string; firstName: string }[];
    tempAssignments: { debtorId: string; firstName: string; amount: number }[];
}

const pendingExpenses = new Map<string, PendingExpense>();
const pendingPayments = new Map<string, { debtId: string; amount?: number }>();

const TASKS = [
    { id: 'axlat', label: "🗑 Axlat to'kish", frequency: 1 },
    { id: 'supurish', label: "🧹 Supurish", frequency: 2 },
    { id: 'vanna', label: "🧼 Vanna tozalash", frequency: 7 }
];

// Helper to get active tasks for a specific date
function getActiveTasks(date: Date) {
    // Normalize to Tashkent time (UTC+5)
    const tashkentOffset = 5 * 60;
    const localTime = new Date(date.getTime() + (date.getTimezoneOffset() + tashkentOffset) * 60000);
    const daysSinceEpoch = Math.floor(localTime.getTime() / (1000 * 60 * 60 * 24));
    const dayOfWeek = localTime.getDay(); // 0 is Sunday

    const active = [];
    // Axlat: Daily
    active.push(TASKS[0]);
    
    // Supurish: Every 2 days
    if (daysSinceEpoch % 2 === 0) {
        active.push(TASKS[1]);
    }

    // Vanna: Weekly (Sunday)
    if (dayOfWeek === 0) {
        active.push(TASKS[2]);
    }
    
    return active;
}

// Helper to get task assignments for a group
function getTaskAssignments(groupId: string, date: Date = new Date()) {
    const group = db.getGroups().find(g => g.id === groupId);
    if (!group || group.members.length === 0) return [];
    
    const activeTasks = getActiveTasks(date);
    const N = group.members.length;
    
    return activeTasks.map((task) => {
        // Find original index in TASKS to keep rotation consistent
        const taskOriginalIndex = TASKS.findIndex(t => t.id === task.id);
        const index = (group.currentTurn + taskOriginalIndex) % N;
        const member = group.members[index];
        const user = db.getUsers().find(u => u.id === member.userId);
        return { task, user, userId: member.userId };
    });
}

// Helper function to get current user's turn
async function getCurrentTurnUser(groupId: string) {
  // This function is now less relevant but kept for backward compatibility if needed
  // or can be repurposed to return the first task person.
  const assignments = getTaskAssignments(groupId);
  return assignments.length > 0 ? assignments[0] : null;
}

// /kommunal command
bot.command("kommunal", async (ctx) => {
  const args = ctx.match.split(" ");
  const amount = parseInt(args[0]);
  if (isNaN(amount) || amount <= 0) {
    return await ctx.reply("Format: `/kommunal 150000` (miqdorni kiriting)", { parse_mode: "Markdown" });
  }

  const userId = ctx.from!.id.toString();
  const groupId = ctx.chat.id.toString();
  const group = db.getGroups().find(g => g.id === groupId);

  if (!group || group.members.length < 2) {
    return await ctx.reply("Guruhda kamida 2 kishi bo'lishi kerak.");
  }

  const splitAmount = Math.round(amount / group.members.length);
  const description = "Kommunal to'lov ⚡️🔥💦";

  for (const member of group.members) {
    if (member.userId === userId) continue;
    await db.addDebt(userId, member.userId, splitAmount, description, groupId);
  }

  await ctx.reply(
    `💡 **Kommunal to'lov qo'shildi!**\n` +
    `Jami: ${amount.toLocaleString()} so'm\n` +
    `Har bir kishi uchun: **${splitAmount.toLocaleString()}** so'mdan taqsimlandi. ✅`
  );
});

// /start command
bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Xush kelibsiz! Men kvartira boshqaruvchisi botman.\n\n" +
      "🧹 **NAVBATCHILIK:**\n" +
      "/join - Ro'yxatga qo'shilish\n" +
      "/list - Navbatchilar va jarimalar\n" +
      "/navbat - Tartibni o'zgartirish (reorder)\n" +
      "/done - Ishni tugatib rasm bilan yuboring\n" +
      "/stats - Umumiy holat va statistika\n\n" +
      "💰 **XARAJATLAR:**\n" +
      "/xarajat <miqdor> <nima uchun> - Xarajat qo'shish\n" +
      "/kommunal <miqdor> - Kommunal to'lovni hammaga bo'lish\n" +
      "/qarzlar - Kim kimdan qarzdor\n" +
      "/toladim - Qarzni to'laganingizni bildirish\n\n" +
      "🤫 **ANONIM XABAR:**\n" +
      "Bot bilan shaxsiy yozishmada `/anon Xabar` deb yozing.\n" +
      "Xabar guruhga ismingiz ko'rsatilmagan holda yuboriladi.\n\n" +
      "Yordam kerak bo'lsa, guruhda yozing!",
  );
});

// /navbat command (reorder)
bot.command("navbat", async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const group = db.getGroups().find(g => g.id === groupId);
  if (!group || group.members.length === 0) return await ctx.reply("Guruh topilmadi yoki a'zolar yo'q.");

  const keyboard = new InlineKeyboard();
  group.members.forEach((m, i) => {
      const user = db.getUsers().find(u => u.id === m.userId);
      keyboard.text(`${i + 1}. ${user?.firstName || "Noma'lum"}`, "ignore").row();
      if (i > 0) keyboard.text("⬆️ Yuqoriga", `move_up_${m.userId}`);
      if (i < group.members.length - 1) keyboard.text("⬇️ Pastga", `move_down_${m.userId}`);
      keyboard.row();
  });
  
  keyboard.text("✅ Tayyor", "navbat_done");

  await ctx.reply("Navbatchilik tartibini o'zgartirish:", { reply_markup: keyboard });
});

// /join command
bot.command("join", async (ctx) => {
  if (ctx.chat.type === "private") return await ctx.reply("Guruhda ishlating.");
  const userId = ctx.from?.id.toString() || "0";
  const groupId = ctx.chat.id.toString();
  const firstName = ctx.from?.first_name || "Noma'lum";

  await db.upsertUser({ id: userId, firstName, username: ctx.from?.username });
  await db.upsertGroup(groupId);
  const added = await db.addMember(groupId, userId);

  if (!added) return await ctx.reply(`${firstName}, siz allaqachon qo'shilgansiz.`);
  await ctx.reply(`${firstName} ro'yxatga qo'shildi! ✅`);
});

// /list command
bot.command("list", async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const assignments = getTaskAssignments(groupId);
  if (assignments.length === 0) return await ctx.reply("Ro'yxat bo'sh. /join qiling.");

  let text = "📋 **Bugungi vazifalar:**\n\n";
  assignments.forEach(a => {
      text += `${a.task.label}: **${a.user?.firstName || "Noma'lum"}**\n`;
  });

  const group = db.getGroups().find(g => g.id === groupId);
  if (group && group.penaltyDays > 0) text += `\n⚠️ Navbatchilarda **${group.penaltyDays} kun** jarima bor.`;
  await ctx.reply(text, { parse_mode: "Markdown" });
});

// /xarajat command
bot.command("xarajat", async (ctx) => {
  const args = ctx.match.split(" ");
  if (args.length < 2) return await ctx.reply("Format: `/xarajat 50000 non`", { parse_mode: "Markdown" });

  const amount = parseInt(args[0]);
  const description = args.slice(1).join(" ");
  if (isNaN(amount) || amount <= 0) return await ctx.reply("Miqdor xato.");

  const groupId = ctx.chat.id.toString();
  const group = db.getGroups().find(g => g.id === groupId);

  if (!group || group.members.length < 2) {
    return await ctx.reply("Guruhda kamida 2 kishi bo'lishi kerak.");
  }

  const keyboard = new InlineKeyboard()
    .text("Teng bo'lish", `split_all_${amount}`)
    .text("Maxsus (Manual)", `split_manual_init`)
    .row().text("Bekor qilish", "cancel_expense");

  pendingExpenses.set(ctx.from!.id.toString(), { 
      amount, 
      description, 
      groupId, 
      payerId: ctx.from!.id.toString(),
      mode: 'equal', 
      currentMemberIndex: 0,
      membersToAsk: [],
      tempAssignments: []
  });

  await ctx.reply(`💰 **Xarajat:** ${amount.toLocaleString()} so'm\n📝 **Sabab:** ${description}\n\nTaqsimlash turini tanlang:`, { reply_markup: keyboard });
});

// Handle text input for manual split steps or payment amounts
bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from!.id.toString();
    const session = pendingExpenses.get(userId);
    const paySession = pendingPayments.get(userId);

    if (session && session.mode === 'manual' && session.membersToAsk.length > 0) {
        const val = parseInt(ctx.message.text.replace(/[^0-9]/g, ""));
        
        if (isNaN(val)) {
            return await ctx.reply("Iltimos, faqat raqam kiriting (masalan: 5000 yoki 0).");
        }

        const currentMember = session.membersToAsk[session.currentMemberIndex];
        
        if (val > 0) {
            session.tempAssignments.push({ 
                debtorId: currentMember.id, 
                firstName: currentMember.firstName, 
                amount: val 
            });
        }

        session.currentMemberIndex++;

        if (session.currentMemberIndex < session.membersToAsk.length) {
            // Ask next member
            const nextMember = session.membersToAsk[session.currentMemberIndex];
            await ctx.reply(`➡️ **${nextMember.firstName}** uchun qancha? (0 yozsangiz qarz yozilmaydi)`);
        } else {
            // Finish and show summary
            if (session.tempAssignments.length === 0) {
                pendingExpenses.delete(userId);
                return await ctx.reply("Hech kimga qarz yozilmadi. Xarajat bekor qilindi.");
            }

            let summary = `🧐 **Taqsimlashni tekshiring:**\n\n`;
            let total = 0;
            session.tempAssignments.forEach(a => {
                summary += `👤 ${a.firstName}: ${a.amount.toLocaleString()} so'm\n`;
                total += a.amount;
            });
            summary += `\n**Jami:** ${total.toLocaleString()} so'm\n**Xarajat:** ${session.amount.toLocaleString()} so'm`;

            const kb = new InlineKeyboard()
                .text("Tasdiqlash ✅", "confirm_manual_split")
                .text("Bekor qilish ❌", "cancel_expense");

            await ctx.reply(summary, { reply_markup: kb });
        }
        return;
    } else if (paySession) {
        const val = parseInt(ctx.message.text.replace(/[^0-9]/g, ""));
        if (isNaN(val) || val <= 0) {
            return await ctx.reply("Iltimos, musbat son kiriting (to'langan miqdorni).");
        }

        const debt = db.getDebts().find(d => d.id === paySession.debtId);
        if (!debt) {
            pendingPayments.delete(userId);
            return await ctx.reply("Qarz topilmadi.");
        }

        if (val > debt.amount) {
            return await ctx.reply(`Sizning qarzingiz ${debt.amount.toLocaleString()} so'm. Miqdor xato (katta bo'lishi mumkin emas).`);
        }

        paySession.amount = val;
        const payer = db.getUsers().find(u => u.id === debt.payerId);
        
        const summary = `💸 **To'lovni tasdiqlaysizmi?**\n` +
            `Kimga: **${payer?.firstName}**\n` +
            `Siz kiritgan miqdor: **${val.toLocaleString()}** so'm\n` +
            `Qarzning umumiy miqdori: ${debt.amount.toLocaleString()} so'm\n` +
            `Kutilayotgan qoldiq: ${(debt.amount - val).toLocaleString()} so'm`;

        const kb = new InlineKeyboard()
            .text("Ha, so'rov yuborilsin ✅", `send_pay_request_${paySession.debtId}_${val}`)
            .text("Bekor qilish ❌", "cancel_payment");

        await ctx.reply(summary, { reply_markup: kb });
        return;
    }
    await next();
});

// Callback queries
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id.toString();

  if (data === "ignore") return await ctx.answerCallbackQuery();
  
  if (data === "navbat_done") {
      await ctx.editMessageText("✅ Navbatchilik tartibi saqlandi.");
      return await ctx.answerCallbackQuery();
  }

  if (data.startsWith("move_up_") || data.startsWith("move_down_")) {
      const targetUserId = data.replace("move_up_", "").replace("move_down_", "");
      const groupId = ctx.chat?.id.toString();
      if (!groupId) return;
      const group = db.getGroups().find(g => g.id === groupId);
      if (!group) return;

      const idx = group.members.findIndex(m => m.userId === targetUserId);
      if (idx === -1) return;

      const newMembers = [...group.members];
      if (data.startsWith("move_up_") && idx > 0) {
          [newMembers[idx - 1], newMembers[idx]] = [newMembers[idx], newMembers[idx - 1]];
      } else if (data.startsWith("move_down_") && idx < newMembers.length - 1) {
          [newMembers[idx], newMembers[idx + 1]] = [newMembers[idx + 1], newMembers[idx]];
      }

      await db.updateMembersOrder(groupId, newMembers);
      
      const keyboard = new InlineKeyboard();
      newMembers.forEach((m, i) => {
          const user = db.getUsers().find(u => u.id === m.userId);
          keyboard.text(`${i + 1}. ${user?.firstName || "Noma'lum"}`, "ignore").row();
          if (i > 0) keyboard.text("⬆️ Yuqoriga", `move_up_${m.userId}`);
          if (i < newMembers.length - 1) keyboard.text("⬇️ Pastga", `move_down_${m.userId}`);
          keyboard.row();
      });
      keyboard.text("✅ Tayyor", "navbat_done");

      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
      return await ctx.answerCallbackQuery();
  }

  if (data === "split_manual_init") {
    const session = pendingExpenses.get(userId);
    if (!session) return await ctx.answerCallbackQuery("Eski sessiya.");

    const group = db.getGroups().find(g => g.id === session.groupId);
    if (!group) return;

    // Filter members to ask (exclude payer)
    session.membersToAsk = group.members
        .filter(m => m.userId !== userId)
        .map(m => {
            const u = db.getUsers().find(user => user.id === m.userId);
            return { id: m.userId, firstName: u?.firstName || "Noma'lum" };
        });
    
    session.mode = 'manual';
    session.currentMemberIndex = 0;

    const firstMember = session.membersToAsk[0];
    await ctx.editMessageText(
        `✍️ **Manual taqsimlash boshlandi.**\n\n` +
        `Men har bir a'zoni so'rayman, siz summani yozasiz.\n\n` +
        `1️⃣ **${firstMember.firstName}** uchun qancha? (0 yozsangiz qarz yozilmaydi)`
    );

  } else if (data === "confirm_manual_split") {
    const session = pendingExpenses.get(userId);
    if (session && session.tempAssignments.length > 0) {
      for (const a of session.tempAssignments) {
        await db.addDebt(userId, a.debtorId, a.amount, session.description, session.groupId);
      }
      pendingExpenses.delete(userId);
      await ctx.editMessageText("✅ Xarajat muvaffaqiyatli saqlandi!");
    }
  } else if (data.startsWith("split_all_")) {
    const session = pendingExpenses.get(userId);
    const group = db.getGroups().find(g => g.id === session?.groupId);
    if (session && group) {
      const split = Math.round(session.amount / group.members.length);
      for (const m of group.members) if (m.userId !== userId) await db.addDebt(userId, m.userId, split, session.description, session.groupId);
      pendingExpenses.delete(userId);
      await ctx.editMessageText(`✅ Hamma uchun ${split.toLocaleString()} so'mdan bo'lindi.`);
    }
  } else if (data === "cancel_expense") {
    pendingExpenses.delete(userId);
    await ctx.editMessageText("❌ Bekor qilindi.");
  } else if (data.startsWith("pay_payer_")) {
    const payerId = data.split("_")[2];
    const groupId = ctx.chat?.id.toString();
    const myDebts = db.getDebts().filter(d => d.groupId === groupId && d.debtorId === userId && d.payerId === payerId && d.status === 'pending');
    
    if (myDebts.length === 0) return await ctx.editMessageText("Qarz topilmadi.");

    const keyboard = new InlineKeyboard();
    myDebts.forEach(d => {
        keyboard.text(`${d.amount.toLocaleString()} so'm (${d.description})`, `pay_init_${d.id}`).row();
    });
    keyboard.text("⬅️ Orqaga", "pay_back_to_list");

    await ctx.editMessageText("Qaysi qarzni to'ladingiz?", { reply_markup: keyboard });
  } else if (data === "pay_back_to_list") {
      const groupId = ctx.chat?.id.toString();
      const myDebts = db.getDebts().filter(d => d.groupId === groupId && d.debtorId === userId && d.status === 'pending');
      const payerIds = [...new Set(myDebts.map(d => d.payerId))];
      const keyboard = new InlineKeyboard();
      payerIds.forEach(pId => {
        const payer = db.getUsers().find(u => u.id === pId);
        keyboard.text(payer?.firstName || "Noma'lum", `pay_payer_${pId}`).row();
      });
      await ctx.editMessageText("Kimga to'ladingiz? Tanlang:", { reply_markup: keyboard });
  } else if (data.startsWith("pay_init_")) {
    const debtId = data.split("_")[2];
    const debt = db.getDebts().find(d => d.id === debtId);
    if (debt) {
        pendingPayments.set(userId, { debtId });
        await ctx.editMessageText(`💰 **To'lov: ${debt.amount.toLocaleString()} so'm (${debt.description})**\n\nQancha to'ladingiz? Miqdorni raqamda yozing.`);
    }
  } else if (data === "cancel_payment") {
    pendingPayments.delete(userId);
    await ctx.editMessageText("❌ To'lov bekor qilindi.");
  } else if (data.startsWith("send_pay_request_")) {
    const [,, , debtId, amountStr] = data.split("_");
    const amount = parseInt(amountStr);
    const debt = db.getDebts().find(d => d.id === debtId);
    if (debt) {
      const debtor = db.getUsers().find(u => u.id === debt.debtorId);
      const kb = new InlineKeyboard().text("Tasdiqlash ✅", `settle_${debt.id}_${amount}`).text("Inkor qilish ❌", "cancel_payment");
      await bot.api.sendMessage(Number(debt.payerId), `💰 **To'lov so'rovi:**\n${debtor?.firstName} sizga **${amount.toLocaleString()}** so'm to'laganini aytdi (Umumiy qarz: ${debt.amount.toLocaleString()}, Sabab: ${debt.description}). Tasdiqlaysizmi?`, { reply_markup: kb });
      pendingPayments.delete(userId);
      await ctx.editMessageText("✅ So'rov yuborildi. Pul egasi tasdiqlashi kutilmoqda.");
    }
  } else if (data.startsWith("settle_")) {
    const parts = data.split("_");
    const debtId = parts[1];
    const amount = parseInt(parts[2]);
    const debt = db.getDebts().find(d => d.id === debtId);
    if (debt && debt.payerId === userId) {
      await db.partialSettleDebt(debtId, amount);
      const remaining = debt.amount; // partialSettleDebt updates in-place if successful
      if (debt.status === 'settled') {
          await ctx.editMessageText(`✅ To'lov tasdiqlandi. Qarz to'liq yopildi.`);
      } else {
          await ctx.editMessageText(`✅ To'lov tasdiqlandi. Qolgan qarz: ${remaining.toLocaleString()} so'm.`);
      }
    }
  } else if (data.startsWith("task_done_")) {
    const parts = data.split("_");
    const taskId = parts[2];
    const photoId = parts.slice(3).join("_");
    const groupId = ctx.chat?.id.toString();
    if (!groupId) return;

    const task = TASKS.find(t => t.id === taskId);
    const chore = await db.createChore(groupId, userId, photoId, taskId);
    
    const kb = new InlineKeyboard()
        .text("Tasdiqlash ✅", `confirm_${chore.id}`)
        .text("Rad etish ❌", `reject_${chore.id}`);

    await ctx.editMessageText(`👤 **${ctx.from.first_name}** vazifani bajardi: **${task?.label}**\n\nGuruh a'zolari tasdiqlashi kutilmoqda.`, { reply_markup: kb });

  } else if (data.startsWith("confirm_") || data.startsWith("reject_")) {
    const choreId = parseInt(data.split("_")[1] || "0");
    const chore = db.getChores().find(c => c.id === choreId);
    if (chore && chore.userId !== userId && chore.status === 'pending') {
      const action = data.startsWith("confirm_") ? "confirmed" : "rejected";
      await db.updateChoreStatus(choreId, action);
      
      if (action === "confirmed") {
        const today = new Date().toISOString().split('T')[0];
        const confirmedToday = db.getChores().filter(c => 
            c.groupId === chore.groupId && 
            c.status === 'confirmed' && 
            c.createdAt.startsWith(today)
        );
        
        // If all 3 tasks are confirmed, we can move the turn
        // Note: For simplicity, we just notify. Turn moving logic is better in midnight cron
        // But we can decrement penalty if it exists.
        if (confirmedToday.length >= 3) {
            await db.decrementPenaltyOrMoveTurn(chore.groupId);
            await ctx.editMessageText(`✅ Tasdiqlandi. Bugungi barcha vazifalar bajarildi! ✨`);
        } else {
            const task = TASKS.find(t => t.id === chore.taskType);
            await ctx.editMessageText(`✅ Tasdiqlandi. **${task?.label}** bajarildi.`);
        }
      } else {
          await ctx.editMessageText("❌ Rad etildi.");
      }
    }
  }
  await ctx.answerCallbackQuery();
});

// /qarzlar command
bot.command("qarzlar", async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const debts = db.getDebts().filter(d => d.groupId === groupId && d.status === 'pending');
  if (debts.length === 0) return await ctx.reply("Qarzlar yo'q. ✨");

  // Group debts by debtorId
  const debtorGroups: Record<string, typeof debts> = {};
  debts.forEach(d => {
    if (!debtorGroups[d.debtorId]) debtorGroups[d.debtorId] = [];
    debtorGroups[d.debtorId].push(d);
  });

  let text = "📋 **Qarzlar ro'yxati:**\n\n";
  
  for (const debtorId in debtorGroups) {
    const debtorDebts = debtorGroups[debtorId];
    const debtor = db.getUsers().find(u => u.id === debtorId);
    let debtorTotal = 0;

    text += `👤 **${debtor?.firstName}**:\n`;

    // Group by payer within debtor
    const payerGroups: Record<string, typeof debts> = {};
    debtorDebts.forEach(d => {
      if (!payerGroups[d.payerId]) payerGroups[d.payerId] = [];
      payerGroups[d.payerId].push(d);
    });

    for (const payerId in payerGroups) {
      const group = payerGroups[payerId];
      const payer = db.getUsers().find(u => u.id === payerId);
      let groupTotal = 0;

      for (const d of group) {
        text += `  🔹 ➡️ **${payer?.firstName}**: ${d.amount.toLocaleString()} so'm (${d.description})\n`;
        groupTotal += d.amount;
        debtorTotal += d.amount;
      }
      if (Object.keys(payerGroups).length > 1) {
          text += `  💰 *${payer?.firstName} ga jami: ${groupTotal.toLocaleString()} so'm*\n`;
      }
    }
    
    text += `\n💵 **Umumiy qarz: ${debtorTotal.toLocaleString()} so'm**\n`;
    text += "────────────────────\n";
  }

  await ctx.reply(text + "To'lagan bo'lsangiz, /toladim buyrug'ini bosing.", { parse_mode: "Markdown" });
});

// /toladim command
bot.command("toladim", async (ctx) => {
  const userId = ctx.from!.id.toString();
  const groupId = ctx.chat.id.toString();
  const myDebts = db.getDebts().filter(d => d.groupId === groupId && d.debtorId === userId && d.status === 'pending');
  
  if (myDebts.length === 0) return await ctx.reply("Sizda hozircha qarz yo'q. ✨");

  // Get unique payers
  const payerIds = [...new Set(myDebts.map(d => d.payerId))];
  const keyboard = new InlineKeyboard();
  
  payerIds.forEach(pId => {
    const payer = db.getUsers().find(u => u.id === pId);
    keyboard.text(payer?.firstName || "Noma'lum", `pay_payer_${pId}`).row();
  });

  await ctx.reply("Kimga to'ladingiz? Tanlang:", { reply_markup: keyboard });
});

// Helper to get general status for a group
async function getGeneralStatus(groupId: string) {
  const group = db.getGroups().find(g => g.id === groupId);
  if (!group) return null;

  let text = "🏢 **KVARTIRA UMUMIY HOLATI** 📊\n\n";

  // 1. Current Assignments
  const assignments = getTaskAssignments(groupId);
  if (assignments.length > 0) {
    text += "📋 **Bugungi vazifalar:**\n";
    assignments.forEach(a => {
        text += `${a.task.label}: **${a.user?.firstName || "Noma'lum"}**\n`;
    });
    if (group.penaltyDays > 0) {
        text += `⚠️ *Guruhda jarima:* ${group.penaltyDays} kun\n`;
    }
  } else {
    text += `📋 **Vazifalar:** Ro'yxat bo'sh.\n`;
  }
  text += "────────────────────\n";

  // 2. Debts Summary
  const debts = db.getDebts().filter(d => d.groupId === groupId && d.status === 'pending');
  if (debts.length > 0) {
    text += "💰 **Qarzlar (Kimdan qancha):**\n";
    const debtorGroups: Record<string, number> = {};
    debts.forEach(d => {
        debtorGroups[d.debtorId] = (debtorGroups[d.debtorId] || 0) + d.amount;
    });

    for (const debtorId in debtorGroups) {
        const user = db.getUsers().find(u => u.id === debtorId);
        text += `👤 ${user?.firstName}: **${debtorGroups[debtorId].toLocaleString()}** so'm\n`;
    }
    text += "*(Batafsil ko'rish uchun: /qarzlar)*\n";
  } else {
    text += "💰 **Qarzlar:** Hozircha hamma hisob-kitob qilingan. ✨\n";
  }
  text += "────────────────────\n";

  // 3. Rent Countdown (Assuming 2nd of every month)
  const today = new Date();
  const nextRentDate = new Date(today.getFullYear(), today.getMonth(), 2);
  if (today.getDate() > 2) {
    nextRentDate.setMonth(nextRentDate.getMonth() + 1);
  }
  const diffTime = Math.abs(nextRentDate.getTime() - today.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  text += `🏠 **Kvartira to'lovi:** ${nextRentDate.toLocaleDateString('uz-UZ')} da\n`;
  text += `📅 **Qoldi:** ${diffDays} kun\n`;
  text += "────────────────────\n";

  // 4. Activity Stats (Top workers)
  const chores = db.getChores().filter(c => c.groupId === groupId && c.status === 'confirmed');
  text += "🏆 **Ishlar statistikasi:**\n";
  group.members.slice(0, 5).forEach(m => { // Top 5 members for summary
    const user = db.getUsers().find(u => u.id === m.userId);
    const count = chores.filter(c => c.userId === m.userId).length;
    text += `▫️ ${user?.firstName}: ${count} marta\n`;
  });

  return text;
}

// /statistika command
bot.command(["statistika", "stats"], async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const statusText = await getGeneralStatus(groupId);
  if (statusText) {
    await ctx.reply(statusText, { parse_mode: "Markdown" });
  } else {
    await ctx.reply("Guruh topilmadi. Avval /join buyrug'ini bosing.");
  }
});

// /anon command
bot.command("anon", async (ctx) => {
  if (ctx.chat.type !== "private") {
    return await ctx.reply("Ushbu buyruq faqat bot bilan shaxsiy yozishmada ishlaydi. 🤫");
  }

  const message = ctx.match;
  if (!message) {
    return await ctx.reply("Anonim xabar yuborish uchun: `/anon Xabar matni`", { parse_mode: "Markdown" });
  }

  const userId = ctx.from!.id.toString();
  const userGroups = db.getGroups().filter(g => g.members.some(m => m.userId === userId));

  if (userGroups.length === 0) {
    return await ctx.reply("Siz hech qanday guruhga a'zo emassiz.");
  }

  if (userGroups.length === 1) {
    const groupId = userGroups[0].id;
    try {
      await bot.api.sendMessage(Number(groupId), `🤫 **ANONIM XABAR:**\n\n${message}`);
      await ctx.reply("Xabaringiz guruhga anonim tarzda yuborildi. ✅");
    } catch (err) {
      await ctx.reply("Xabarni yuborishda xatolik yuz berdi.");
    }
  } else {
    // If user is in multiple groups, ask which one
    const keyboard = new InlineKeyboard();
    userGroups.forEach(g => {
        keyboard.text(`Guruh: ${g.id}`, `send_anon_${g.id}_${message.substring(0, 20)}`).row();
    });
    // This part is a bit complex due to message length in callback data. 
    // Let's simplify for now: just use the first group if they are in any.
    // Or just inform them.
    const groupId = userGroups[0].id;
    try {
        await bot.api.sendMessage(Number(groupId), `🤫 **ANONIM XABAR:**\n\n${message}`);
        await ctx.reply("Xabaringiz guruhga anonim tarzda yuborildi. ✅");
    } catch (err) {
        await ctx.reply("Xabarni yuborishda xatolik yuz berdi.");
    }
  }
});

// Photos for /done
bot.on("message:photo", async (ctx) => {
  const caption = ctx.message.caption || "";
  if (!caption.includes("/done")) return;
  
  const userId = ctx.from!.id.toString();
  const groupId = ctx.chat.id.toString();
  const assignments = getTaskAssignments(groupId);
  
  const userTask = assignments.find(a => a.userId === userId);
  if (!userTask) {
      return await ctx.reply("Bugun sizga vazifa berilmagan. 🤷‍♂️");
  }

  const kb = new InlineKeyboard();
  const activeTasks = getActiveTasks(new Date());
  activeTasks.forEach(t => {
      kb.text(t.label, `task_done_${t.id}_${ctx.message.photo[ctx.message.photo.length - 1].file_id}`).row();
  });

  await ctx.reply("Qaysi vazifani bajardingiz? Tanlang:", { reply_markup: kb });
});

// Cron Jobs
// 1. Daily morning summary (8:00 AM)
cron.schedule("0 8 * * *", async () => {
    const groups = db.getGroups();
    for (const group of groups) {
      const statusText = await getGeneralStatus(group.id);
      if (statusText) {
          try {
              await bot.api.sendMessage(Number(group.id), statusText, { parse_mode: "Markdown" });
          } catch (err) {
              console.error(`Daily summary error for ${group.id}:`, err);
          }
      }
    }
}, { timezone: "Asia/Tashkent" });

// 2. Midnight penalty and turn movement check
cron.schedule("0 0 * * *", async () => {
  const groups = db.getGroups();
  for (const group of groups) {
    if (group.members.length === 0) continue;
    
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Check how many UNIQUE tasks were confirmed yesterday
    const confirmedYesterday = db.getChores().filter(c => 
        c.groupId === group.id && 
        c.status === 'confirmed' && 
        c.createdAt.startsWith(yesterdayStr)
    );
    const uniqueTasksDone = new Set(confirmedYesterday.map(c => c.taskType)).size;

    // Get number of tasks that WERE active yesterday
    const activeYesterday = getActiveTasks(yesterday);

    if (uniqueTasksDone < activeYesterday.length) {
      // Penalty for incomplete tasks
      await db.addPenalty(group.id);
      try { 
          await bot.api.sendMessage(
              Number(group.id), 
              `⚠️ **JARIMA!**\nKecha barcha vazifalar (${activeYesterday.length} ta) to'liq bajarilmadi. Guruhga +1 kun jarima qo'shildi.`
          ); 
      } catch {}
    } else {
        await db.decrementPenaltyOrMoveTurn(group.id);
    }
  }
}, { timezone: "Asia/Tashkent" });

const times = ["0 9 * * *", "0 12 * * *", "0 20 * * *", "40 22 * * *"];
times.forEach(t => cron.schedule(t, async () => {
  const groups = db.getGroups();
  for (const group of groups) {
    const assignments = getTaskAssignments(group.id);
    if (assignments.length > 0) {
        let text = "🔔 **BUGUNGI VAZIFALAR:**\n\n";
        assignments.forEach(a => {
            text += `${a.task.label}: [${a.user?.firstName || "Noma'lum"}](tg://user?id=${a.userId})\n`;
        });
        text += "\nIshni tugatib rasm + /done yuboring.";
        try { 
            await bot.api.sendMessage(Number(group.id), text, { parse_mode: "Markdown" }); 
        } catch {}
    }
  }
}, { timezone: "Asia/Tashkent" }));

// Monthly rent reminder: 2nd of every month at 10:00
cron.schedule("0 10 2 * *", async () => {
  const groups = db.getGroups();
  for (const group of groups) {
    try {
      await bot.api.sendMessage(
        Number(group.id),
        "📢 **DIQQAT! BUGUN TO'LOV KUNI!** 💰\n\n" +
        "Bugun oyning 2-sanasi. Kvartira to'lovini amalga oshirishni unutmang! 🏠💸"
      );
    } catch (err) {
      console.error(`Rent reminder error for ${group.id}:`, err);
    }
  }
}, {
  timezone: "Asia/Tashkent"
});
