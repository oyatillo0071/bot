import "dotenv/config";
import { bot } from "./bot.js";
import { jsonDatabase as db } from "./jsonDb.js";
async function main() {
    await db.init();
    console.log("JSON Ma'lumotlar bazasi yuklandi.");
    // Register commands for suggestions
    try {
        await bot.api.setMyCommands([
            { command: "start", description: "Botni ishga tushirish va yordam" },
            { command: "join", description: "Navbatchilik ro'yxatiga qo'shilish" },
            { command: "list", description: "Bugungi vazifalar ro'yxati" },
            { command: "navbat", description: "Navbatchilik tartibini o'zgartirish" },
            { command: "stats", description: "Umumiy holat va statistika" },
            { command: "xarajat", description: "Xarajat qo'shish (miqdor sabab)" },
            { command: "kommunal", description: "Kommunal to'lovni hammaga bo'lish" },
            { command: "qarzlar", description: "Kim kimdan qarzdorligini ko'rish" },
            { command: "toladim", description: "Qarzni to'laganlikni bildirish" },
        ]);
        console.log("Bot buyruqlari Telegramda ro'yxatga olindi.");
    }
    catch (err) {
        console.error("Buyruqlarni ro'yxatga olishda xatolik:", err);
    }
    console.log("Bot ishga tushmoqda...");
    bot.start({
        onStart: (botInfo) => {
            console.log(`Bot @${botInfo.username} sifatida ishga tushdi.`);
        },
    });
}
main().catch((err) => {
    console.error("Botni ishga tushirishda xatolik:", err);
    process.exit(1);
});
