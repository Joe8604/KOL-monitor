// 配置设置
const config = {
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatIds: process.env.TELEGRAM_CHAT_IDS?.split(',')?.filter(Boolean) || []
    },
    solana: {
        rpcEndpoint: process.env.RPC_ENDPOINT,
        wsEndpoint: process.env.WS_ENDPOINT
    },
    email: {
        user: process.env.EMAIL_USER_1,
        pass: process.env.EMAIL_PASS_1,
        to: process.env.EMAIL_TO
    }
};

export default config; 