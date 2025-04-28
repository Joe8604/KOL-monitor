import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import logger from './logger.js';

// 加载环境变量
dotenv.config();

async function testToken() {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        
        if (!botToken || !chatId) {
            throw new Error('请检查环境变量配置: TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID');
        }
        
        logger.info('=== Token测试开始 ===');
        
        // 初始化Bot
        const bot = new Telegraf(botToken);
        
        // 测试getMe
        logger.info('测试getMe...');
        const me = await bot.telegram.getMe();
        logger.info('getMe成功:');
        logger.info(JSON.stringify(me, null, 2));
        
        // 测试getChat
        logger.info('测试getChat...');
        const chat = await bot.telegram.getChat(chatId);
        logger.info('getChat成功:');
        logger.info(JSON.stringify(chat, null, 2));
        
        // 测试sendMessage
        logger.info('测试sendMessage...');
        const message = await bot.telegram.sendMessage(
            chatId,
            '🔔 这是一条测试消息\n时间: ' + new Date().toLocaleString(),
            {
                parse_mode: 'HTML'
            }
        );
        logger.info('sendMessage成功:');
        logger.info(JSON.stringify(message, null, 2));
        
        logger.info('=== Token测试完成 ===');
        
    } catch (error) {
        logger.error('测试失败:');
        logger.error(error.message);
        if (error.response) {
            logger.error('错误响应:');
            logger.error(JSON.stringify(error.response, null, 2));
        }
        process.exit(1);
    }
}

testToken(); 