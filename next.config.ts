import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // По умолчанию у Server Actions лимит тела запроса 1 МБ — этого не
    // хватает для вложений в Telegram-модуле (фото/документы/видео,
    // отправляемые администратором через sendConversationAttachment).
    // Реальный потолок всё равно ограничен самим Telegram — бот не может
    // загрузить файл больше 50 МБ, так что 300 МБ здесь просто запас.
    serverActions: {
      bodySizeLimit: "300mb",
    },
  },
};

export default nextConfig;
