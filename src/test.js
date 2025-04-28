const telegram = require('./telegram');
const logger = require('./logger');

async function main() {
    try {
        // 初始化机器人
        await telegram.initializeBot();
        
        // 发送测试消息
        const message = '测试消息：机器人已成功启动！';
        const success = await telegram.sendMessage(message);
        
        if (success) {
            logger.info('测试消息发送成功');
        } else {
            logger.error('测试消息发送失败');
        }
    } catch (error) {
        logger.error('测试过程中发生错误:', error);
    }
}

main(); 