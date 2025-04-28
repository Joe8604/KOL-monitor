import { Telegraf } from 'telegraf';
import { startMonitoring } from './solana.js';
import logger from './logger.js';
import config from './config.js';
import HttpsProxyAgent from 'https-proxy-agent';

let bot;
let botConnected = false;

// 配置代理
const proxyUrl = process.env.PROXY_URL || 'http://127.0.0.1:7890'; // 默认使用本地代理
const agent = new HttpsProxyAgent(proxyUrl);

export async function initializeBot() {
    try {
        // 添加调试信息
        logger.info('Initializing Telegram bot...');
        logger.info('Bot Token:', config.telegram.botToken ? 'set' : 'not set');
        logger.info('Chat ID:', config.telegram.chatId ? 'set' : 'not set');
        logger.info('Proxy URL:', proxyUrl ? 'set' : 'not set');

        if (!config.telegram.botToken || !config.telegram.chatId) {
            throw new Error('Telegram bot token or chat ID not configured');
        }

        bot = new Telegraf(config.telegram.botToken);
        
        // Command handlers
        bot.command('start', async (ctx) => {
            const user = ctx.from;
            await ctx.replyWithHTML(
                `Hi ${user.first_name}! I'm your Solana monitoring bot. I will notify you of any transactions on the monitored addresses.`
            );
            await startMonitoring(bot, config.telegram.chatId);
        });
        
        bot.command('help', async (ctx) => {
            const helpText = `
Available commands:
/start - Start the bot and begin monitoring
/help - Show this help message
/status - Check bot and network status
`;
            await ctx.reply(helpText);
        });
        
        bot.command('status', async (ctx) => {
            const statusText = `Network Status: ✅ Connected\nCurrent RPC Node: ${process.env.RPC_ENDPOINT}\nMonitored Addresses: ${process.env.KOL_ADDRESSES.split(',').length}`;
            await ctx.reply(statusText);
        });

        // 处理连接事件
        bot.on('polling_error', (error) => {
            logger.error('Telegram polling error:', error);
            botConnected = false;
        });

        bot.on('webhook_error', (error) => {
            logger.error('Telegram webhook error:', error);
            botConnected = false;
        });

        // 测试连接
        try {
            const me = await bot.telegram.getMe();
            logger.info('Telegram bot connected successfully:', me.username);
            botConnected = true;
        } catch (error) {
            logger.error('Failed to connect to Telegram:', error);
            throw error;
        }

        // 启动机器人
        await bot.launch();
        logger.info('Telegram bot launched successfully');

    } catch (error) {
        logger.error('Error initializing Telegram bot:', error);
        throw error;
    }

    return bot;
}

export async function sendMessage(message) {
    if (!bot) {
        throw new Error('Bot not initialized');
    }
    await bot.telegram.sendMessage(config.telegram.chatId, message);
}

export function isConnected() {
    return botConnected;
} 