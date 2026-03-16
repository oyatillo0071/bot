# Apartment Manager Bot (O'zbek tilida)

Kvartiradagi navbatchilik va uy ishlarini boshqarish uchun Telegram bot.

## Xususiyatlar
- `/join` orqali navbatga qo'shilish.
- `/list` orqali navbatchilar ro'yxatini ko'rish.
- `/done` (rasm bilan) orqali vazifani topshirish.
- Boshqa a'zolar tomonidan vazifani tasdiqlash.
- Har kuni soat 9:00 da avtomatik eslatma.

## O'rnatish

1. Loyihani yuklab oling.
2. `.env` faylini yarating va quyidagilarni kiriting:
   ```env
   BOT_TOKEN=your_telegram_bot_token
   DATABASE_URL=your_postgresql_url
   ```
3. Kutubxonalarni o'rnating:
   ```bash
   npm install
   ```
4. Prisma sxemasini yarating:
   ```bash
   npx prisma db push
   ```
5. Botni ishga tushiring:
   ```bash
   npm run dev
   ```

## Railway'ga joylash (Deployment)
Ushbu loyiha Railway platformasiga moslashtirilgan. Shunchaki repozitoriyani ulab, `BOT_TOKEN` va `DATABASE_URL` (Railway Postgres) o'zgaruvchilarini qo'shing.
