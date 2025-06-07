import { Connection } from '@solana/web3.js';
import logger from './logger.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 测试交易哈希
const TEST_SIGNATURE = '5R3745S1TQdbyZYesW8qaT33JzqEJVFxwxoT6Mg5i1PgiP4McSaVDxRvZNNnUTTAQ8YysxqKe2iCyCTY4V1GYE9c';

// 从环境变量获取监控名单
const KOL_ADDRESSES = process.env.KOL_ADDRESSES?.split(',')?.map(addr => {
    const [_, address] = addr.split('|');
    return address;
}).filter(Boolean) || [];

// RPC 节点配置
const RPC_NODES = [
    process.env.RPC_ENDPOINT || 'https://silent-quiet-leaf.solana-mainnet.quiknode.pro/0f5a74209a458203d8c55b249e5826fd92a03e34/',
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com'
].filter(Boolean);

async function testSigners() {
    try {
        // 创建 Solana 连接
        const connection = new Connection(RPC_NODES[0], {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 30000,
            disableRetryOnRateLimit: false,
            httpHeaders: { 'Content-Type': 'application/json' }
        });
        
        // 获取交易详情
        const tx = await connection.getParsedTransaction(TEST_SIGNATURE, {
            maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.transaction) {
            logger.error('无法获取交易详情');
            return;
        }

        // 获取所有签名者
        const signers = tx.transaction.message.accountKeys
            .filter(key => key.signer)
            .map(key => key.pubkey.toBase58());

        logger.info(`交易签名者数量: ${signers.length}`);

        // 检查每个签名者是否在监控名单中
        for (const signer of signers) {
            logger.info(`检查签名者: ${signer}`);
            if (KOL_ADDRESSES.includes(signer)) {
                logger.info(`✅ 识别到监控名单签名者: ${signer}`);
                // 这里可以添加发送 Telegram 消息的逻辑
            } else {
                logger.info(`❌ 签名者不在监控名单中: ${signer}`);
            }
        }

        // 打印监控名单以进行对比
        logger.info('\n当前监控名单:');
        for (const addr of KOL_ADDRESSES) {
            logger.info(`- ${addr}`);
        }

    } catch (error) {
        logger.error(`测试失败: ${error.message}`);
    }
}

// 运行测试
testSigners().catch(error => {
    logger.error(`程序运行失败: ${error.message}`);
}); 