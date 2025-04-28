// 配置设置
const config = {
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID
    },
    solana: {
        rpcEndpoint: process.env.RPC_ENDPOINT,
        wsEndpoint: process.env.WS_ENDPOINT
    },
    email: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
        to: process.env.EMAIL_TO
    },
    proxy: {
        url: process.env.PROXY_URL
    }
};

export default config; 