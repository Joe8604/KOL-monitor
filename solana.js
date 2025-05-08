import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import logger from './logger.js';
import { sendMessage } from './telegram.js';

// 加载环境变量
dotenv.config();

// Configuration
const RPC_NODES = [
    process.env.RPC_ENDPOINT,
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.rpc.extrnode.com',
    'https://solana-mainnet.g.alchemy.com/v2/demo'
].filter(Boolean);

console.log('RPC_ENDPOINT:', process.env.RPC_ENDPOINT);
console.log('Available RPC nodes:', RPC_NODES);

let currentRpcIndex = 0;
let subscriptions = new Map();

export async function createSolanaConnection() {
    if (RPC_NODES.length === 0) {
        throw new Error('No valid RPC nodes available');
    }
    
    const rpcEndpoint = RPC_NODES[currentRpcIndex];
    console.log(`Connecting to RPC node: ${rpcEndpoint}`);
    
    if (!rpcEndpoint.startsWith('http')) {
        throw new Error(`Invalid RPC endpoint: ${rpcEndpoint}`);
    }
    
    return new Connection(rpcEndpoint, 'confirmed');
}

export async function switchRpcNode() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_NODES.length;
    return await createSolanaConnection();
}

export async function monitorAddress(connection, address) {
    try {
        // 分离名称和地址
        const [name, pubkey] = address.split('|');
        if (!name || !pubkey) {
            throw new Error(`地址格式错误: ${address}`);
        }

        // 清理地址中的空格和特殊字符
        const cleanPubkey = pubkey.trim();
        
        // 验证地址格式
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleanPubkey)) {
            throw new Error(`地址格式无效: ${cleanPubkey}`);
        }

        // 创建公钥对象
        const publicKey = new PublicKey(cleanPubkey);
        
        // 获取账户信息
        const accountInfo = await connection.getAccountInfo(publicKey);
        if (!accountInfo) {
            throw new Error(`账户不存在: ${cleanPubkey}`);
        }

        // 订阅账户变更
        const subscriptionId = connection.onAccountChange(
            publicKey,
            async (accountInfo) => {
                try {
                    // 处理账户变更
                    await handleAccountChange(connection, publicKey, accountInfo, name);
                } catch (error) {
                    logger.error(`处理账户变更失败 (${name}|${cleanPubkey}):`, error);
                }
            },
            'confirmed'
        );

        logger.info(`开始监控地址: ${name}|${cleanPubkey}`);
        return subscriptionId;
    } catch (error) {
        logger.error(`监控地址失败 (${address}):`, error);
        throw error;
    }
}

export async function startMonitoring(connection) {
    try {
        const addresses = process.env.KOL_ADDRESSES?.split(',')?.filter(Boolean) || [];
        if (addresses.length === 0) {
            throw new Error('未设置 KOL_ADDRESSES 环境变量');
        }

        logger.info(`开始监控 ${addresses.length} 个地址...`);
        
        // 存储所有订阅ID
        const subscriptions = new Map();
        
        // 将地址分组，每组4个
        const groupSize = 4;
        const groups = [];
        for (let i = 0; i < addresses.length; i += groupSize) {
            groups.push(addresses.slice(i, i + groupSize));
        }

        logger.info(`地址已分为 ${groups.length} 组，每组最多 ${groupSize} 个地址`);

        // 为每组地址创建监控
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            logger.info(`开始监控第 ${i + 1}/${groups.length} 组地址...`);

            // 并行监控组内的地址
            const groupPromises = group.map(async (address) => {
                if (address.trim()) {
                    try {
                        const subscriptionId = await monitorAddress(connection, address.trim());
                        subscriptions.set(address, subscriptionId);
                        logger.info(`成功监控地址: ${address}`);
                    } catch (error) {
                        logger.error(`监控地址失败 (${address}):`, error);
                    }
                }
            });

            // 等待组内所有地址监控完成
            await Promise.all(groupPromises);

            // 如果不是最后一组，等待1秒
            if (i < groups.length - 1) {
                logger.info('等待1秒后继续下一组...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        logger.info('所有地址监控已启动');

        // 设置清理函数
        const cleanup = () => {
            for (const [address, subscriptionId] of subscriptions) {
                try {
                    connection.removeAccountChangeListener(subscriptionId);
                    logger.info(`停止监控地址: ${address}`);
                } catch (error) {
                    logger.error(`停止监控地址失败 (${address}):`, error);
                }
            }
        };

        // 注册清理函数
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        return cleanup;
    } catch (error) {
        logger.error('启动监控失败:', error);
        throw error;
    }
}

async function handleAccountChange(connection, publicKey, accountInfo, name) {
    try {
        // 获取最新的交易签名
        const signatures = await connection.getSignaturesForAddress(publicKey, {
            limit: 1
        });

        if (signatures && signatures.length > 0) {
            const signature = signatures[0].signature;
            
            // 获取交易详情
            const transaction = await connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0
            });

            if (transaction) {
                // 检查交易签名者
                const signers = transaction.transaction.message.staticAccountKeys
                    .filter((key, index) => transaction.transaction.message.isAccountSigner(index))
                    .map(key => key.toString());

                logger.info(`交易签名者数量: ${signers.length}`);
                
                // 检查是否有监控名单中的签名者
                let hasMonitoredSigner = false;
                for (const signer of signers) {
                    logger.info(`检查签名者: ${signer}`);
                    if (KOL_ADDRESS_MAP.has(signer)) {
                        hasMonitoredSigner = true;
                        logger.info(`✅ 找到监控名单中的签名者: ${signer}`);
                        break;
                    } else {
                        logger.info(`❌ 签名者不在监控名单中: ${signer}`);
                    }
                }

                if (!hasMonitoredSigner) {
                    logger.info('未找到监控名单中的签名者，跳过处理');
                    return;
                }

                // 构建消息
                const message = `🔔 检测到新交易\n\n` +
                    `名称: ${name}\n` +
                    `地址: ${publicKey.toString()}\n` +
                    `签名: ${signature}\n` +
                    `时间: ${new Date(transaction.blockTime * 1000).toLocaleString()}\n` +
                    `状态: ${transaction.meta?.err ? '失败' : '成功'}`;

                // 发送消息
                await sendMessage(message);
            }
        }
    } catch (error) {
        logger.error(`处理账户变更失败 (${name}|${publicKey.toString()}):`, error);
    }
} 