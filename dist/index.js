import "dotenv/config";
import { bot } from "./bot.js";
import { jsonDatabase as db } from "./jsonDb.js";
async function main() {
    await db.init();
    console.log("JSON Ma'lumotlar bazasi yuklandi.");
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
