import { initializeBot, sendMessage } from './telegram.js';
import logger from './logger.js';
import config from './config.js';
import { Telegraf } from 'telegraf';

async function testBot() {
    try {
        logger.info('=== 开始测试 Bot ===');
        
        // 1. 初始化 Bot
        logger.info('\n1. 测试 Bot 初始化...');
        const bot = await initializeBot();
        logger.info('Bot 初始化成功 ✅');
        
        // 配置超时和重试
        bot.telegram.options.timeout = 30000; // 30秒超时
        bot.telegram.options.retryAfter = 2000; // 2秒后重试
        
        // 2. 测试发送消息到群组
        logger.info('\n2. 测试发送消息到群组...');
        const groupId = '-4627711652'; // 正确的群组 ID
        const groupMessage = '👥 群组测试消息\n\n' +
            '时间: ' + new Date().toLocaleString() + '\n' +
            '群组ID: ' + groupId + '\n' +
            '这是一条群组测试消息';
        
        try {
            await sendMessage(groupMessage, groupId);
            logger.info('发送消息到群组成功 ✅');
        } catch (error) {
            logger.error(`发送消息到群组失败: ${error.message}`);
        }
        
        // 3. 测试发送消息到所有聊天
        logger.info('\n3. 测试发送消息到所有聊天...');
        const testMessage = '🤖 Bot 测试消息\n\n' +
            '时间: ' + new Date().toLocaleString() + '\n' +
            '状态: 正常运行中\n' +
            '版本: 1.0.0';
        
        await sendMessage(testMessage);
        logger.info('发送消息到所有聊天成功 ✅');
        
        // 4. 测试发送消息到特定聊天
        logger.info('\n4. 测试发送消息到特定聊天...');
        if (config.telegram.chatIds && config.telegram.chatIds.length > 0) {
            const specificChatId = config.telegram.chatIds[0];
            const specificMessage = '📱 特定聊天测试消息\n\n' +
                '时间: ' + new Date().toLocaleString() + '\n' +
                '聊天ID: ' + specificChatId;
            
            await sendMessage(specificMessage, specificChatId);
            logger.info('发送消息到特定聊天成功 ✅');
        }
        
        // 5. 测试发送长消息
        logger.info('\n5. 测试发送长消息...');
        const longMessage = '📝 长消息测试\n\n' +
            '时间: ' + new Date().toLocaleString() + '\n' +
            '这是一条测试长消息，用于验证消息发送功能是否正常工作。\n' +
            '消息包含多行内容，测试格式化是否正确。\n' +
            '如果看到这条消息，说明长消息发送功能正常。\n\n' +
            '测试完成 ✅';
        
        await sendMessage(longMessage);
        logger.info('发送长消息成功 ✅');
        
        logger.info('\n=== Bot 测试完成 ===');
        
    } catch (error) {
        logger.error('Bot 测试失败:', error);
        process.exit(1);
    }
}

// 运行测试
testBot(); 