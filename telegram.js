import { Telegraf } from 'telegraf';
import { startMonitoring } from './solana.js';
import logger from './logger.js';
import config from './config.js';
import { 
    sleep, 
    validateBotToken, 
    checkTokenStatus, 
    testNetworkConnection 
} from './utils.js';

let bot;
let botConnected = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2秒

// 重试函数
async function withRetry(fn, maxRetries = MAX_RETRIES, delay = RETRY_DELAY) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            logger.warn(`尝试 ${i + 1} 失败: ${error.message}`);
            if (i < maxRetries - 1) {
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

export async function initializeBot() {
    try {
        logger.info('=== Telegram Bot 初始化开始 ===');
        
        // 检查环境变量
        if (!config.telegram.botToken) {
            throw new Error('请检查环境变量配置: TELEGRAM_BOT_TOKEN');
        }
        
        if (!config.telegram.chatIds || config.telegram.chatIds.length === 0) {
            throw new Error('请检查环境变量配置: TELEGRAM_CHAT_IDS');
        }
        
        // 验证Bot Token格式
        logger.info('验证Bot Token格式...');
        validateBotToken(config.telegram.botToken);
        logger.info('Bot Token格式验证: ✅ 成功');
        
        // 检查Token状态
        const tokenValid = await checkTokenStatus(config.telegram.botToken);
        if (!tokenValid) {
            throw new Error('Token无效，请检查Token是否正确或联系 @BotFather');
        }
        
        logger.info('环境变量检查: ✅ 通过');
        
        // 测试网络连接
        const endpoints = [
            'https://api.telegram.org',
            'https://api1.telegram.org',
            'https://api2.telegram.org',
            'https://api3.telegram.org',
            'https://api4.telegram.org',
            'https://api5.telegram.org'
        ];
        
        let workingEndpoint = null;
        for (const endpoint of endpoints) {
            logger.info(`\n测试端点 ${endpoint}...`);
            if (await testNetworkConnection(endpoint)) {
                workingEndpoint = endpoint;
                logger.info(`找到可用端点: ${endpoint}`);
                break;
            }
            await sleep(2000);
        }
        
        if (!workingEndpoint) {
            throw new Error('所有API端点连接失败');
        }
        
        // 初始化Bot
        logger.info('\n初始化Bot...');
        try {
            bot = new Telegraf(config.telegram.botToken, {
                telegram: {
                    apiRoot: workingEndpoint,
                    testEnv: false
                }
            });
            logger.info('Bot初始化成功');
        } catch (error) {
            logger.error(`Bot初始化失败: ${error.message}`);
            throw error;
        }
        
        // 测试getMe
        logger.info('测试getMe...');
        try {
            const me = await bot.telegram.getMe();
            logger.info('getMe成功:');
            logger.info(JSON.stringify(me, null, 2));
            botConnected = true;
        } catch (error) {
            logger.error(`getMe测试失败: ${error.message}`);
            throw error;
        }
        
        // 测试getChat
        logger.info('测试getChat...');
        for (const chatId of config.telegram.chatIds) {
            try {
                const chat = await bot.telegram.getChat(chatId);
                logger.info(`getChat成功 (${chatId}):`);
                logger.info(JSON.stringify(chat, null, 2));
            } catch (error) {
                logger.error(`getChat测试失败 (${chatId}): ${error.message}`);
                throw error;
            }
        }
        
        // 不再启动机器人，直接返回
        logger.info('Bot 初始化完成');
        return bot;
        
    } catch (error) {
        logger.error('Telegram Bot 初始化失败:', error);
        throw error;
    }
}

export async function sendMessage(message, specificChatId = null) {
    try {
        if (specificChatId) {
            // 发送到指定的聊天ID
            await bot.telegram.sendMessage(specificChatId, message);
            logger.info(`Telegram消息已发送到 ${specificChatId}: ${message.substring(0, 50)}...`);
        } else {
            // 发送到所有配置的聊天ID
            for (const chatId of config.telegram.chatIds) {
                await bot.telegram.sendMessage(chatId, message);
                logger.info(`Telegram消息已发送到 ${chatId}: ${message.substring(0, 50)}...`);
            }
        }
    } catch (error) {
        logger.error(`发送Telegram消息失败: ${error.message}`);
        throw error;
    }
} 