import { Telegraf } from 'telegraf';
import { startMonitoring } from './solana.js';
import logger from './logger.js';
import config from './config.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { sleep } from './utils.js';

let bot;
let botConnected = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

const proxyUrl = process.env.PROXY_URL;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

// 重试函数
async function withRetry(fn, maxRetries = MAX_RETRIES, delay = RETRY_DELAY) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            logger.warn(`Attempt ${i + 1} failed: ${error.message}`);
            if (i < maxRetries - 1) {
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

export async function initializeBot() {
    try {
        logger.info('Initializing Telegram bot...');
        logger.info('Bot Token:', config.telegram.botToken ? 'set' : 'not set');
        logger.info('Chat ID:', config.telegram.chatId ? 'set' : 'not set');
        logger.info('Proxy URL:', proxyUrl ? 'set' : 'not set');

        if (!config.telegram.botToken || !config.telegram.chatId) {
            throw new Error('Telegram bot token or chat ID not configured');
        }

        bot = new Telegraf(config.telegram.botToken, {
            telegram: {
                agent: agent
            }
        });
        
        // Command handlers
        bot.command('start', async (ctx) => {
            try {
                const user = ctx.from;
                await ctx.replyWithHTML(
                    `🤖 Hi ${user.first_name}! I'm your Solana monitoring bot. I will notify you of any transactions on the monitored addresses.`
                );
                await startMonitoring(bot, config.telegram.chatId);
            } catch (error) {
                logger.error(`Error in /start command: ${error.message}`);
                await ctx.reply('Sorry, an error occurred while processing your request.');
            }
        });
        
        bot.command('help', async (ctx) => {
            try {
                const helpText = `
📚 Available commands:
/start - Start the bot and begin monitoring
/help - Show this help message
/status - Check bot and network status
`;
                await ctx.reply(helpText);
            } catch (error) {
                logger.error(`Error in /help command: ${error.message}`);
                await ctx.reply('Sorry, an error occurred while processing your request.');
            }
        });
        
        bot.command('status', async (ctx) => {
            try {
                const statusText = `Network Status: ${botConnected ? '✅ Connected' : '❌ Disconnected'}\nCurrent RPC Node: ${process.env.RPC_ENDPOINT}\nMonitored Addresses: ${process.env.KOL_ADDRESSES.split(',').length}`;
                await ctx.reply(statusText);
            } catch (error) {
                logger.error(`Error in /status command: ${error.message}`);
                await ctx.reply('Sorry, an error occurred while processing your request.');
            }
        });

        // 错误处理中间件
        bot.catch(async (err, ctx) => {
            logger.error(`Error in bot: ${err.message}`);
            if (ctx) {
                try {
                    await ctx.reply('Sorry, an error occurred while processing your request.');
                } catch (e) {
                    logger.error(`Failed to send error message: ${e.message}`);
                }
            }
        });

        // 测试连接
        try {
            const me = await withRetry(() => bot.telegram.getMe());
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

    try {
        await withRetry(async () => {
            await bot.telegram.sendMessage(config.telegram.chatId, message);
            logger.info(`Telegram message sent: ${message.substring(0, 50)}...`);
        });
    } catch (error) {
        logger.error(`Error sending Telegram message: ${error.message}`);
        throw error;
    }
} 