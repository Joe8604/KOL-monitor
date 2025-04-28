import { testNetworkConnection, checkTokenStatus } from './utils.js';
import logger from './logger.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

async function main() {
    try {
        logger.info('=== 测试网络连接 ===');
        
        // 测试网络连接
        const networkStatus = await testNetworkConnection('https://api.telegram.org');
        if (!networkStatus) {
            logger.error('网络连接测试失败');
            return;
        }
        
        // 检查Token状态
        const tokenValid = await checkTokenStatus(process.env.TELEGRAM_BOT_TOKEN);
        if (!tokenValid) {
            logger.error('Token状态检查失败');
            return;
        }
        
        logger.info('✅ 所有测试通过');
    } catch (error) {
        logger.error(`测试失败: ${error.message}`);
    }
}

main().catch(error => {
    logger.error(`程序运行出错: ${error.message}`);
    process.exit(1);
}); 