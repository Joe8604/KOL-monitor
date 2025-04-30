import { Connection, PublicKey } from '@solana/web3.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { initializeBot, sendMessage } from './telegram.js';
import { createSolanaConnection, startMonitoring } from './solana.js';
import { sleep, testLatency, testTCP, testHTTPS, validateBotToken, checkTokenStatus, testNetworkConnection } from './utils.js';
import logger from './logger.js';
import dns from 'dns';
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

// Token Metadata Program ID
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// 请求限制配置
const REQUEST_LIMIT = {
    maxRetries: 3,
    retryDelay: 5000, // 5秒
    rateLimit: 5, // 每秒最多5个请求
    rateWindow: 1000, // 1秒
    dailyLimit: 10000, // 每天最多10000个请求
    minuteLimit: 300 // 每分钟最多300个请求
};

// 请求计数
let requestCount = {
    daily: 0,
    minute: 0,
    lastMinuteReset: Date.now(),
    lastDailyReset: Date.now()
};

// 上次请求时间
let lastRequestTime = 0;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
const envPath = `${process.cwd()}/.env`;
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

// 打印环境变量以调试
console.log('Environment variables:', {
    EMAIL_USER: process.env.EMAIL_USER ? 'set' : 'not set',
    EMAIL_PASS: process.env.EMAIL_PASS ? 'set' : 'not set',
    EMAIL_TO: process.env.EMAIL_TO ? 'set' : 'not set'
});

// 配置 Solana 连接
const RPC_NODES = [
    process.env.RPC_ENDPOINT || 'https://silent-quiet-leaf.solana-mainnet.quiknode.pro/0f5a74209a458203d8c55b249e5826fd92a03e34/',
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com'
].filter(Boolean);

const WS_NODES = [
    process.env.WS_ENDPOINT || 'wss://silent-quiet-leaf.solana-mainnet.quiknode.pro/0f5a74209a458203d8c55b249e5826fd92a03e34/',
    'wss://api.mainnet-beta.solana.com',
    'wss://solana-api.projectserum.com'
].filter(Boolean);

// 配置监控地址（包含用户指定的中间地址）
const KOL_ADDRESSES = process.env.KOL_ADDRESSES?.split(',')?.filter(Boolean) || [];
const KOL_NICKNAMES = process.env.KOL_NICKNAMES?.split(',')?.filter(Boolean) || [];

// 创建地址到昵称的映射
const KOL_ADDRESS_MAP = new Map();
KOL_ADDRESSES.forEach(address => {
    // 格式: 昵称|地址
    const [nickname, addr] = address.split('|');
    if (addr) {
        KOL_ADDRESS_MAP.set(addr, nickname);
    }
});

if (KOL_ADDRESSES.length === 0) {
    logger.warn('未配置监控地址（KOL_ADDRESSES），请检查 .env 文件');
}

// 配置流动性池地址（待解析索引 11 和 12）
const POOL_ADDRESSES = ['POOL_ADDRESS_11', 'POOL_ADDRESS_12']; // 替换为实际解析地址

// 配置通知
const EMAIL_USERS = [
    process.env.EMAIL_USER_1,
    process.env.EMAIL_USER_2,
    process.env.EMAIL_USER_3
].filter(Boolean);

const EMAIL_PASSWORDS = [
    process.env.EMAIL_PASS_1,
    process.env.EMAIL_PASS_2,
    process.env.EMAIL_PASS_3
].filter(Boolean);

const EMAIL_TO = process.env.EMAIL_TO;

// 配置网络选项
const NETWORK_OPTIONS = {
    proxy: process.env.PROXY_URL || null,
    timeout: 60000,
    agent: null,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Connection': 'keep-alive'
    }
};

// 配置 Telegram API 端点
const TELEGRAM_API_ENDPOINTS = [
    'https://api.telegram.org',
    'https://api1.telegram.org',
    'https://api2.telegram.org',
    'https://api3.telegram.org',
    'https://api4.telegram.org',
    'https://api5.telegram.org',
    'https://api6.telegram.org',
    'https://api7.telegram.org',
    'https://api8.telegram.org'
];

let currentTelegramEndpointIndex = 0;
let lastWorkingEndpoint = null;

// 配置 Telegram
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS?.split(',')?.filter(Boolean) || [];
if (TELEGRAM_CHAT_IDS.length === 0) {
    logger.warn('未配置 Telegram chat_id，请检查 .env 文件');
}

// 检查网络状态
async function checkNetworkStatus() {
    for (const endpoint of TELEGRAM_API_ENDPOINTS) {
        try {
            logger.info(`测试 API 端点: ${endpoint}`);
            const networkStatus = await testNetworkConnection(endpoint);
            if (!networkStatus) continue;

            const response = await fetch(`${endpoint}/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, {
                method: 'GET',
                timeout: 15000,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.ok) {
                    logger.info(`API 端点 ${endpoint} 可用`);
                    return endpoint;
                }
            }
        } catch (error) {
            logger.error(`测试端点 ${endpoint} 时出错: ${error.message}`);
        }
    }
    throw new Error('所有 API 端点均不可用');
}

// 检查 Bot 状态
async function checkBotStatus() {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('未设置 TELEGRAM_BOT_TOKEN 环境变量');
        if (!TELEGRAM_CHAT_IDS.length) throw new Error('未设置 TELEGRAM_CHAT_IDS 环境变量');

        validateBotToken(process.env.TELEGRAM_BOT_TOKEN);
        const tokenValid = await checkTokenStatus(process.env.TELEGRAM_BOT_TOKEN);
        if (!tokenValid) throw new Error('Bot Token 无效');

        const workingEndpoint = await checkNetworkStatus();
        logger.info(`使用 API 端点: ${workingEndpoint}`);

        const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
            telegram: { apiRoot: `${workingEndpoint}/bot` }
        });

        const botInfo = await bot.telegram.getMe();
        logger.info(`Bot 信息: ${JSON.stringify(botInfo, null, 2)}`);

        // 检查每个 chat_id
        for (const chatId of TELEGRAM_CHAT_IDS) {
            try {
                logger.info(`检查群组 ${chatId}...`);
                const chatInfo = await bot.telegram.getChat(chatId);
                logger.info(`群组 ${chatId} 信息: ${JSON.stringify(chatInfo, null, 2)}`);

                // 发送测试消息
                const message = await bot.telegram.sendMessage(
                    chatId,
                    '🔔 Bot 状态检查\n状态: ✅ 正常\n时间: ' + new Date().toLocaleString()
                );
                logger.info(`测试消息已发送到群组 ${chatId}: ${message.message_id}`);
            } catch (error) {
                logger.error(`群组 ${chatId} 检查失败: ${error.message}`);
                if (error.description?.includes('chat not found')) {
                    logger.error(`请确保机器人已加入群组 ${chatId}，并且群组ID正确`);
                }
                // 继续检查其他群组
                continue;
            }
        }

        // 如果至少有一个群组可用，就返回成功
        return true;
    } catch (error) {
        logger.error(`Bot 状态检查失败: ${error.message}`);
        return false;
    }
}

// 初始化邮件发送器
const transporters = EMAIL_USERS.map((user, index) => {
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { 
            user: user, 
            pass: EMAIL_PASSWORDS[index]
        },
        tls: {
            rejectUnauthorized: false
        },
        debug: true,
        logger: true,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
});

// 连接管理
let subscriptions = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 15000;
const CONNECTION_TIMEOUT = 30000;

let currentRpcIndex = 0;

async function createConnection() {
    const rpcEndpoint = RPC_NODES[currentRpcIndex];
    const wsEndpoint = WS_NODES[currentRpcIndex];
    logger.info(`尝试连接到 RPC 节点: ${rpcEndpoint}`);
    return new Connection(rpcEndpoint, {
        wsEndpoint: wsEndpoint,
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: CONNECTION_TIMEOUT,
        disableRetryOnRateLimit: false,
        httpHeaders: { 'Content-Type': 'application/json' }
    });
}

async function testConnection(conn) {
    try {
        const version = await conn.getVersion();
        logger.info('连接测试成功，节点版本:', JSON.stringify(version, null, 2));
        return true;
    } catch (error) {
        logger.error('连接测试失败:', error.message);
        return false;
    }
}

async function switchRpcNode() {
    currentRpcIndex = (currentRpcIndex + 1) % RPC_NODES.length;
    const newRpcEndpoint = RPC_NODES[currentRpcIndex];
    logger.info(`切换到下一个 RPC 节点: ${newRpcEndpoint}`);

    const connection = await createConnection();
    let retryDelay = 500;
    const maxRetries = 5;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const version = await connection.getVersion();
            logger.info(`新节点测试成功，版本: ${version['solana-core']}`);
            return connection;
        } catch (error) {
            logger.error(`新节点 ${newRpcEndpoint} 测试失败: ${error.message}`);
            if (error.message.includes('429')) {
                logger.info(`速率限制，等待 ${retryDelay}ms 后重试...`);
                await sleep(retryDelay);
                retryDelay *= 2;
            } else if (i < maxRetries - 1) {
                logger.info(`等待 ${RECONNECT_DELAY/1000} 秒后重试...`);
                await sleep(RECONNECT_DELAY);
            }
        }
    }

    if (currentRpcIndex < RPC_NODES.length - 1) {
        return await switchRpcNode();
    }
    currentRpcIndex = 0;
    logger.info(`所有节点不可用，回退到首选节点: ${RPC_NODES[0]}`);
    return await createConnection();
}

async function waitForConnection() {
    let connection = await createConnection();
    let attempts = 0;

    while (attempts < MAX_RECONNECT_ATTEMPTS) {
        try {
            if (await testConnection(connection)) return connection;
        } catch (error) {
            logger.error(`连接尝试 ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} 失败: ${error.message}`);
        }

        attempts++;
        if (attempts < MAX_RECONNECT_ATTEMPTS) {
            logger.info(`等待 ${RECONNECT_DELAY/1000} 秒后重试...`);
            await sleep(RECONNECT_DELAY);
            connection = attempts % 2 === 0 ? await switchRpcNode() : await createConnection();
        }
    }

    throw new Error('无法建立连接，已达到最大重试次数');
}

// 解析地址表查找
async function resolveAccountKeys(connection, message) {
    const accountKeys = (message.staticAccountKeys || []).map(key => key.toBase58());
    logger.info(`静态账户: ${message.staticAccountKeys?.length || 0} 个`, accountKeys);

    if (message.addressTableLookups?.length > 0) {
        logger.info(`地址表查找数量: ${message.addressTableLookups.length}`);
        for (const lookup of message.addressTableLookups) {
            try {
                const tableKey = new PublicKey(lookup.accountKey);
                logger.info(`获取地址表账户: ${lookup.accountKey}`);
                const tableAccount = await connection.getAccountInfo(tableKey);
                if (!tableAccount) {
                    logger.warn(`无法获取地址表账户: ${lookup.accountKey}`);
                    continue;
                }

                const tableData = tableAccount.data;
                logger.info(`地址表数据长度: ${tableData.length} 字节`);

                const writableAddresses = lookup.writableIndexes.map(index => {
                    try {
                        if (index * 32 >= tableData.length) {
                            logger.warn(`地址表索引 ${index} 超出数据范围，数据长度: ${tableData.length}`);
                            return `无效索引_${index}`;
                        }
                        const address = new PublicKey(tableData.slice(index * 32, (index + 1) * 32)).toBase58();
                        logger.info(`解析索引 ${index}: ${address}`);
                        return address;
                    } catch {
                        logger.warn(`无效的地址表索引: ${index}`);
                        return `无效索引_${index}`;
                    }
                });
                const readonlyAddresses = lookup.readonlyIndexes.map(index => {
                    try {
                        if (index * 32 >= tableData.length) {
                            logger.warn(`地址表索引 ${index} 超出数据范围，数据长度: ${tableData.length}`);
                            return `无效索引_${index}`;
                        }
                        const address = new PublicKey(tableData.slice(index * 32, (index + 1) * 32)).toBase58();
                        logger.info(`解析索引 ${index}: ${address}`);
                        return address;
                    } catch {
                        logger.warn(`无效的地址表索引: ${index}`);
                        return `无效索引_${index}`;
                    }
                });

                logger.info(`可写地址: ${writableAddresses.join(', ')}`);
                logger.info(`只读地址: ${readonlyAddresses.join(', ')}`);
                accountKeys.push(...writableAddresses, ...readonlyAddresses);
            } catch (error) {
                logger.error(`解析地址表 ${lookup.accountKey} 失败: ${error.message}`);
            }
        }
    }

    logger.info(`总账户数量: ${accountKeys.length}`);
    return accountKeys;
}

// 解析交易
async function parseTransaction(connection, signature) {
    try {
        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta || !tx.transaction) {
            logger.warn('无法获取交易详情');
            return null;
        }

        // 获取交易发起地址
        const signer = tx.transaction.message.accountKeys[0].pubkey.toBase58();
        
        // 检查代币余额变化
        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];
        const tokenChanges = {};

        // 分析SOL余额变化
        const solMint = 'So11111111111111111111111111111111111111112';
        const targetAccountIndex = tx.transaction.message.accountKeys.findIndex(
            key => key.pubkey.toBase58() === signer
        );

        if (targetAccountIndex !== -1) {
            const preSolBalance = tx.meta.preBalances[targetAccountIndex] / 1e9;
            const postSolBalance = tx.meta.postBalances[targetAccountIndex] / 1e9;
            const solChange = postSolBalance - preSolBalance;
            if (solChange !== 0) {
                tokenChanges[solMint] = {
                    pre: preSolBalance,
                    post: postSolBalance,
                    change: solChange
                };
            }
        }

        // 分析其他代币变化
        for (const balance of preBalances) {
            if (balance.owner === signer) {
                tokenChanges[balance.mint] = {
                    pre: balance.uiTokenAmount.uiAmount,
                    post: null,
                    change: 0
                };
            }
        }
        for (const balance of postBalances) {
            if (balance.owner === signer) {
                if (tokenChanges[balance.mint]) {
                    tokenChanges[balance.mint].post = balance.uiTokenAmount.uiAmount;
                    tokenChanges[balance.mint].change = balance.uiTokenAmount.uiAmount - tokenChanges[balance.mint].pre;
                } else {
                    tokenChanges[balance.mint] = {
                        pre: 0,
                        post: balance.uiTokenAmount.uiAmount,
                        change: balance.uiTokenAmount.uiAmount
                    };
                }
            }
        }

        // 构建交易信息
        const txInfo = {
            address: signer,
            operation: '未知',
            solChange: '0',
            tokenContract: '',
            tokenChange: '0'
        };

        // 转换代币变化格式
        for (const [mint, change] of Object.entries(tokenChanges)) {
            if (change.change !== 0) {
                const isBuy = change.change > 0;
                
                if (mint === solMint) {
                    txInfo.solChange = change.change.toString();
                    txInfo.operation = isBuy ? '买入' : '卖出';
                } else {
                    txInfo.tokenContract = mint;
                    txInfo.tokenChange = change.change.toString();
                    txInfo.operation = isBuy ? '买入' : '卖出';
                }
            }
        }

        logger.info('交易解析成功:', txInfo);
        return txInfo;

    } catch (error) {
        logger.error(`解析交易失败: ${error.message}`);
        return null;
    }
}

// 解析代币元数据
function parseMetadata(data) {
    try {
        // 跳过前8个字节（版本和密钥类型）
        const offset = 8;
        
        // 解析名称
        const nameLength = data.readUInt32LE(offset);
        const nameOffset = offset + 4;
        const name = data.slice(nameOffset, nameOffset + nameLength).toString('utf8');
        
        // 解析符号
        const symbolLength = data.readUInt32LE(nameOffset + nameLength);
        const symbolOffset = nameOffset + nameLength + 4;
        const symbol = data.slice(symbolOffset, symbolOffset + symbolLength).toString('utf8');
        
        return {
            name: name,
            symbol: symbol
        };
    } catch (error) {
        logger.error('解析代币元数据失败:', error.message);
        return null;
    }
}

// 监控地址
async function monitorAddresses() {
    try {
        logger.info('开始监控地址...');
        
        // 创建 Solana 连接
        const connection = await createSolanaConnection();
        
        // 将地址转换为 PublicKey 对象
        const publicKeys = [];
        for (const address of KOL_ADDRESSES) {
            try {
                const [, addr] = address.split('|');
                if (!addr) {
                    logger.warn(`地址格式错误: ${address}`);
                    continue;
                }
                publicKeys.push(new PublicKey(addr));
                logger.info(`添加监控地址: ${address}`);
            } catch (error) {
                logger.error(`处理地址 ${address} 时出错: ${error.message}`);
            }
        }

        if (publicKeys.length === 0) {
            logger.warn('没有有效的地址需要监控');
            return;
        }

        // 使用带延迟的批量订阅
        logger.info('开始订阅交易日志...');
        const SUBSCRIPTION_DELAY = 1000; // 每个订阅之间延迟1秒
        const BATCH_SIZE = 5; // 每批处理的地址数量

        for (let i = 0; i < publicKeys.length; i += BATCH_SIZE) {
            const batch = publicKeys.slice(i, i + BATCH_SIZE);
            for (const publicKey of batch) {
                try {
                    const subscriptionId = connection.onLogs(
                        publicKey,
                        async (logs) => {
                            try {
                                if (logs.err) {
                                    logger.warn(`交易错误: ${logs.err}`);
                                    return;
                                }

                                logger.info(`开始解析交易: ${logs.signature}`);
                                const txInfo = await parseTransaction(connection, logs.signature);
                                if (!txInfo) {
                                    logger.info('交易解析失败，跳过通知');
                                    return;
                                }

                                // 打印交易信息
                                logger.info('交易详情:');
                                logger.info(`发起地址: ${txInfo.address}`);
                                logger.info(`交易类型: ${txInfo.operation}`);
                                logger.info(`SOL变化: ${txInfo.solChange}`);
                                logger.info(`代币合约: ${txInfo.tokenContract}`);
                                logger.info(`代币变化: ${txInfo.tokenChange}`);

                                // 发送通知
                                await sendNotifications(txInfo, connection);

                            } catch (error) {
                                logger.error(`处理交易日志时出错: ${error.message}`);
                            }
                        },
                        'confirmed'
                    );

                    subscriptions.push(subscriptionId);
                    logger.info(`已订阅地址 ${publicKey.toBase58()} 的交易日志，订阅 ID: ${subscriptionId}`);

                    // 添加延迟，避免触发速率限制
                    await new Promise(resolve => setTimeout(resolve, SUBSCRIPTION_DELAY));
                } catch (error) {
                    logger.error(`订阅地址 ${publicKey.toBase58()} 时出错: ${error.message}`);
                }
            }

            // 每批处理完后添加额外延迟
            if (i + BATCH_SIZE < publicKeys.length) {
                logger.info(`等待 ${SUBSCRIPTION_DELAY/1000} 秒后继续下一批订阅...`);
                await new Promise(resolve => setTimeout(resolve, SUBSCRIPTION_DELAY));
            }
        }

    } catch (error) {
        logger.error(`监控地址时出错: ${error.message}`);
    }
}

// 重置计数器
function resetCounters() {
    const now = Date.now();
    
    // 每分钟重置
    if (now - requestCount.lastMinuteReset >= 60000) {
        requestCount.minute = 0;
        requestCount.lastMinuteReset = now;
    }
    
    // 每天重置
    if (now - requestCount.lastDailyReset >= 86400000) {
        requestCount.daily = 0;
        requestCount.lastDailyReset = now;
    }
}

// 检查是否超过限制
function checkLimits() {
    resetCounters();
    
    if (requestCount.daily >= REQUEST_LIMIT.dailyLimit) {
        throw new Error('已达到每日请求限制');
    }
    
    if (requestCount.minute >= REQUEST_LIMIT.minuteLimit) {
        throw new Error('已达到每分钟请求限制');
    }
    
    return true;
}

// 限制请求频率
async function rateLimitedFetch(url, options) {
    checkLimits();
    
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    // 如果距离上次请求时间小于最小间隔，等待
    if (timeSinceLastRequest < REQUEST_LIMIT.rateWindow / REQUEST_LIMIT.rateLimit) {
        const waitTime = (REQUEST_LIMIT.rateWindow / REQUEST_LIMIT.rateLimit) - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRequestTime = Date.now();
    requestCount.daily++;
    requestCount.minute++;
    
    return fetch(url, options);
}

// 获取代币市值
async function getTokenMarketCap(connection, tokenMint) {
    try {
        // 1. 获取代币供应量
        logger.info(`获取代币 ${tokenMint} 的供应量信息...`);
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));

        if (!mintInfo.value) {
            throw new Error(`无法获取代币 ${tokenMint} 的信息`);
        }

        const supply = mintInfo.value.data.parsed.info.supply;
        const decimals = mintInfo.value.data.parsed.info.decimals;
        const totalSupply = supply / Math.pow(10, decimals);
        logger.info(`代币供应量: ${totalSupply} (原始值: ${supply}, 小数位: ${decimals})`);

        // 2. 使用 DexScreener API 获取代币价格和市值信息
        const dexscreenerUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
        const response = await fetch(dexscreenerUrl);
        
        if (!response.ok) {
            throw new Error(`DexScreener API 请求失败: ${response.status} ${response.statusText}`);
        }

        const dexscreenerData = await response.json();
        
        if (!dexscreenerData.pairs || dexscreenerData.pairs.length === 0) {
            throw new Error('未找到代币交易对信息');
        }

        const tokenSymbol = dexscreenerData.pairs[0]?.baseToken?.symbol || 'Unknown';
        const priceUsd = dexscreenerData.pairs[0]?.priceUsd || 0;
        const change24h = dexscreenerData.pairs[0]?.priceChange?.h24 || 0;
        const marketCap = dexscreenerData.pairs[0]?.marketCap || 0;

        // 格式化市值
        const formatMarketCap = (value) => {
            if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
            if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
            if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
            return `$${value.toFixed(2)}`;
        };

        // 格式化供应量
        const formattedSupply = totalSupply.toLocaleString('en-US', {
            maximumFractionDigits: 2
        });

        return {
            symbol: tokenSymbol,
            price: priceUsd,
            priceChange24h: change24h,
            supply: formattedSupply,
            marketCap: formatMarketCap(marketCap),
            updateTime: new Date().toISOString()
        };

    } catch (error) {
        logger.error(`获取代币市值信息失败: ${error.message}`);
        return null;
    }
}

// 发送通知
async function sendNotifications(txInfo, connection) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;

    try {
        // 检查地址是否在监控名单中
        if (!KOL_ADDRESS_MAP.has(txInfo.address)) {
            logger.info(`地址 ${txInfo.address} 不在监控名单中，跳过通知`);
            return;
        }

        // 如果没有代币合约信息，不发送通知
        if (!txInfo.tokenContract || txInfo.tokenChange === '0') {
            logger.info('没有代币合约信息，跳过通知');
            return;
        }

        logger.info('开始构建通知消息...');
        
        // 获取地址对应的昵称
        const nickname = KOL_ADDRESS_MAP.get(txInfo.address);
        
        // 构建通知消息
        let message = `🔔 检测到新交易\n\n`;
        message += `交易发起地址：${nickname} (${txInfo.address})\n`;
        message += `操作类型：${txInfo.operation}\n`;
        
        // 处理 SOL 变化
        if (txInfo.solChange !== '0') {
            const solAmount = parseFloat(txInfo.solChange);
            const isBuy = txInfo.operation === '买入';
            message += `\nSOL 变化：${Math.abs(solAmount).toFixed(6)} ${isBuy ? '(买入)' : '(卖出)'}\n`;
        }

        // 处理代币变化
        if (txInfo.tokenContract && txInfo.tokenChange !== '0') {
            const tokenAmount = parseFloat(txInfo.tokenChange);
            const isBuy = txInfo.operation === '买入';
            message += `\n代币变化：\n`;
            
            // 获取代币市值信息
            const marketData = await getTokenMarketCap(connection, txInfo.tokenContract);
            if (marketData && marketData.symbol) {
                message += `-代币符号：${marketData.symbol}\n`;
            }
            
            message += `- 代币合约：${txInfo.tokenContract}\n`;
            message += `  数量：${Math.abs(tokenAmount).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 9
            })} ${isBuy ? '(买入)' : '(卖出)'}\n`;

            // 添加代币市值信息
            if (marketData) {
                message += `\n代币市值信息：\n`;
                message += `- 当前价格：$${marketData.price}\n`;
                message += `- 24h涨跌幅：${marketData.priceChange24h.toFixed(2)}%\n`;
                message += `- 总供应量：${marketData.supply}\n`;
                message += `- 市值：${marketData.marketCap}\n`;
                message += `- 数据更新时间：${marketData.updateTime}\n`;
            }
        }

        logger.info('通知消息内容:', message);

        // 发送 Telegram 通知到所有 chat_id
        for (const chatId of TELEGRAM_CHAT_IDS) {
            for (let i = 0; i < MAX_RETRIES; i++) {
                try {
                    logger.info(`尝试发送 Telegram 通知到 ${chatId} (第 ${i + 1} 次)...`);
                    const workingEndpoint = await checkNetworkStatus();
                    logger.info(`使用 Telegram API 端点: ${workingEndpoint}`);

                    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
                        telegram: { apiRoot: `${workingEndpoint}/bot`, timeout: 15000 }
                    });

                    const result = await bot.telegram.sendMessage(
                        chatId,
                        message,
                        { parse_mode: 'HTML', disable_web_page_preview: true }
                    );
                    
                    logger.info(`✅ Telegram 通知发送成功到 ${chatId}`);
                    logger.info(`消息 ID: ${result.message_id}`);
                    break;
                } catch (error) {
                    logger.error(`❌ Telegram 通知发送失败到 ${chatId} (第 ${i + 1} 次): ${error.message}`);
                    if (i < MAX_RETRIES - 1) {
                        logger.info(`等待 ${RETRY_DELAY/1000} 秒后重试...`);
                        await sleep(RETRY_DELAY);
                    }
                }
            }
        }

        // 发送邮件通知
        if (EMAIL_USERS.length > 0 && EMAIL_PASSWORDS.length > 0 && EMAIL_TO) {
            try {
                logger.info('开始发送邮件通知...');
                // 将多个邮件地址分割成数组
                const emailRecipients = EMAIL_TO.split(',').map(email => email.trim());
                
                const mailOptions = {
                    from: EMAIL_USERS[0], // 使用第一个邮箱作为发件人
                    to: emailRecipients,
                    subject: `🔔 KOL交易监控 - ${nickname} ${txInfo.operation}`,
                    text: message,
                    html: message.replace(/\n/g, '<br>')
                };

                // 尝试使用每个邮件发送器发送邮件
                for (let i = 0; i < transporters.length; i++) {
                    try {
                        const info = await transporters[i].sendMail(mailOptions);
                        logger.info(`✅ 邮件通知发送成功 (使用 ${EMAIL_USERS[i]})`);
                        logger.info(`邮件 ID: ${info.messageId}`);
                        logger.info(`接收地址: ${emailRecipients.join(', ')}`);
                        break; // 如果发送成功，跳出循环
                    } catch (error) {
                        logger.error(`❌ 使用 ${EMAIL_USERS[i]} 发送邮件失败: ${error.message}`);
                        if (i === transporters.length - 1) {
                            throw error; // 如果所有发送器都失败，抛出最后一个错误
                        }
                    }
                }
            } catch (error) {
                logger.error('❌ 邮件通知发送失败:', error.message);
            }
        } else {
            logger.warn('邮件通知未配置，跳过发送');
        }

    } catch (error) {
        logger.error('发送通知时出错:', error.message);
        throw error;
    }
}

// 解析流动性池地址
async function parsePoolAddresses() {
    try {
        const connection = await createConnection();
        const tableKey = new PublicKey('2hGypwKXKRW9zkjZ5tt9eSV1m9KREcseqLfK9qvTyAPb');
        const tableAccount = await connection.getAccountInfo(tableKey);
        if (tableAccount) {
            const indexes = [11, 12];
            const poolAddresses = [];
            indexes.forEach(index => {
                if (index * 32 < tableAccount.data.length) {
                    const address = new PublicKey(tableAccount.data.slice(index * 32, (index + 1) * 32)).toBase58();
                    logger.info(`索引 ${index} 的地址: ${address}`);
                    poolAddresses.push(address);
                }
            });
            logger.info(`解析的流动性池地址: ${poolAddresses.join(', ')}`);
            return poolAddresses;
        }
        logger.warn('无法获取地址表账户');
        return [];
    } catch (error) {
        logger.error(`解析流动性池地址失败: ${error.message}`);
        return [];
    }
}

// 测试特定交易
async function testTransactionParse(signature) {
    logger.info(`测试交易解析: ${signature}`);
    const connection = await waitForConnection();
    const txInfo = await parseTransaction(connection, signature);
    if (txInfo) {
        logger.info('解析结果:', JSON.stringify(txInfo, null, 2));
        await sendNotifications(txInfo, connection);
    } else {
        logger.error('无法解析交易');
    }
}

// 主程序
async function main() {
    try {
        logger.info('=== 启动监控程序 ===');

        // 验证环境变量
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_IDS.length || !KOL_ADDRESSES.length) {
            throw new Error('缺少必要的环境变量：TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS 或 KOL_ADDRESSES');
        }

        // 检查 Bot 状态
        logger.info('\n检查 Bot 状态...');
        const botStatus = await checkBotStatus();
        if (!botStatus) throw new Error('Bot 状态检查失败，程序退出');

        // 解析流动性池地址
        logger.info('\n解析流动性池地址...');
        const poolAddresses = await parsePoolAddresses();
        POOL_ADDRESSES.push(...poolAddresses);

        // 检查 Solana 连接
        logger.info('\n检查 Solana 连接...');
        const connection = await waitForConnection();
        if (!connection) throw new Error('无法建立 Solana 连接，程序退出');

        // 测试特定交易（可选）
        // await testTransactionParse('2Td6XPTuboLmGbq1yDc42wXSxwvYy49WtRKKoHVGD2TCD1wmdTTeveWykqbJZb7f2QHjDTyeVpxaMBQdUCEzvN96');

        // 开始监控地址
        logger.info('\n开始监控地址...');
        await monitorAddresses();

        // 保持程序运行并定期检查连接
        logger.info('监控程序正在运行...');
        while (true) {
            await sleep(60000);
            try {
                if (!(await testConnection(connection))) {
                    logger.warn('连接断开，尝试重新连接...');
                    connection = await waitForConnection();
                    await monitorAddresses();
                }
            } catch (error) {
                logger.error(`连接检查失败: ${error.message}`);
            }
        }
    } catch (error) {
        logger.error('程序运行出错:', error.message);
        const errorMessage = {
            address: '系统',
            tokenChanges: [],
            isDexTx: false,
            dexType: null,
            operation: `❌ 监控程序出错\n时间: ${new Date().toLocaleString()}\n错误: ${error.message}`
        };
        await sendNotifications(errorMessage, connection);
        process.exit(1);
    }
}

// 启动程序
main().catch(error => {
    logger.error('程序启动失败:', error.message);
    process.exit(1);
});