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
import config from './config.js';

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
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? 'set' : 'not set',
    TELEGRAM_CHAT_IDS: process.env.TELEGRAM_CHAT_IDS ? 'set' : 'not set',
    KOL_ADDRESSES: process.env.KOL_ADDRESSES ? 'set' : 'not set',
    EMAIL_USER_1: process.env.EMAIL_USER_1 ? 'set' : 'not set',
    EMAIL_PASS_1: process.env.EMAIL_PASS_1 ? 'set' : 'not set',
    EMAIL_USER_2: process.env.EMAIL_USER_2 ? 'set' : 'not set',
    EMAIL_PASS_2: process.env.EMAIL_PASS_2 ? 'set' : 'not set',
    EMAIL_USER_3: process.env.EMAIL_USER_3 ? 'set' : 'not set',
    EMAIL_PASS_3: process.env.EMAIL_PASS_3 ? 'set' : 'not set',
    EMAIL_TO: process.env.EMAIL_TO ? 'set' : 'not set'
});

// 验证必要的环境变量
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

if (!process.env.TELEGRAM_CHAT_IDS) {
    console.error('Error: TELEGRAM_CHAT_IDS is not set in .env file');
    process.exit(1);
}

if (!process.env.KOL_ADDRESSES) {
    console.error('Error: KOL_ADDRESSES is not set in .env file');
    process.exit(1);
}

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

// 全局变量
let bot = null;

// 检查网络状态
async function checkNetworkStatus() {
    const endpoints = [
        'https://api.telegram.org',
        'https://api1.telegram.org',
        'https://api2.telegram.org',
        'https://api3.telegram.org',
        'https://api4.telegram.org',
        'https://api5.telegram.org'
    ];
    
    for (const endpoint of endpoints) {
        logger.info(`测试端点 ${endpoint}...`);
        if (await testNetworkConnection(endpoint)) {
            logger.info(`找到可用端点: ${endpoint}`);
            return endpoint;
        }
        await sleep(NETWORK_OPTIONS.timeout);
    }
    
    throw new Error('所有API端点连接失败');
}

// 检查 Bot 状态
async function checkBotStatus() {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            throw new Error('未设置 TELEGRAM_BOT_TOKEN 环境变量');
        }
        
        const chatIds = process.env.TELEGRAM_CHAT_IDS?.split(',')?.filter(Boolean) || [];
        if (chatIds.length === 0) {
            throw new Error('未设置 TELEGRAM_CHAT_IDS 环境变量');
        }
        
        // 验证 Bot Token 格式
        logger.info('验证 Bot Token 格式...');
        validateBotToken(process.env.TELEGRAM_BOT_TOKEN);
        logger.info('Bot Token 格式验证: ✅ 成功');
        
        // 检查 Token 状态
        const tokenValid = await checkTokenStatus(process.env.TELEGRAM_BOT_TOKEN);
        if (!tokenValid) {
            throw new Error('Token 无效，请检查 Token 是否正确或联系 @BotFather');
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
            throw new Error('所有 API 端点连接失败');
        }
        
        // 测试 getMe
        logger.info('测试 getMe...');
        try {
            const me = await bot.telegram.getMe();
            logger.info('getMe 成功:');
            logger.info(JSON.stringify(me, null, 2));
        } catch (error) {
            logger.error(`getMe 测试失败: ${error.message}`);
            throw error;
        }
        
        // 测试 getChat
        logger.info('测试 getChat...');
        for (const chatId of chatIds) {
            try {
                const chat = await bot.telegram.getChat(chatId);
                logger.info(`getChat 成功 (${chatId}):`);
                logger.info(JSON.stringify(chat, null, 2));
            } catch (error) {
                logger.error(`getChat 测试失败 (${chatId}): ${error.message}`);
                throw error;
            }
        }
        
        // 发送状态检查消息到所有聊天群
        logger.info('发送状态检查消息...');
        const statusMessage = `🔔 Bot 状态检查\n\n` +
            `状态: ✅ 正常\n` +
            `时间: ${new Date().toLocaleString()}\n` +
            `版本: ${process.env.npm_package_version || '1.0.0'}`;

        for (const chatId of chatIds) {
            try {
                await bot.telegram.sendMessage(chatId, statusMessage, {
                    parse_mode: 'HTML'
                });
                logger.info(`状态检查消息已发送到 ${chatId}`);
            } catch (error) {
                logger.error(`发送状态检查消息失败 (${chatId}): ${error.message}`);
                throw error;
            }
        }
        
        logger.info('Bot 状态检查: ✅ 通过');
        return true;
    } catch (error) {
        logger.error('Bot 状态检查失败:', error);
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

        // 获取所有签名者
        const signers = tx.transaction.message.accountKeys
            .filter(key => key.signer)
            .map(key => key.pubkey.toBase58());

        logger.info(`交易签名者数量: ${signers.length}`);

        // 检查每个签名者是否在监控名单中
        let identifiedSigner = null;
        for (const signer of signers) {
            logger.info(`检查签名者: ${signer}`);
            // 检查地址是否在监控名单中（支持昵称|地址格式）
            const isMonitored = KOL_ADDRESSES.some(address => {
                const [_, addr] = address.split('|');
                return addr === signer || address === signer;
            });
            
            if (isMonitored) {
                logger.info(`✅ 识别到监控名单签名者: ${signer}`);
                identifiedSigner = signer;
                break;
            } else {
                logger.info(`❌ 签名者不在监控名单中: ${signer}`);
            }
        }

        if (!identifiedSigner) {
            logger.info('未找到监控名单中的签名者，跳过处理');
            return null;
        }

        // 创建交易信息对象
        const txInfo = {
            address: identifiedSigner,
            operation: '未知',
            solChange: '0',
            sourceTokenContract: '',
            sourceTokenChange: '0',
            targetTokenContract: '',
            targetTokenChange: '0',
            isDexTx: false,
            dexType: null
        };

        // 分析交易指令
        const instructions = tx.transaction.message.instructions;
        const innerInstructions = tx.meta.innerInstructions || [];
        
        // 检查是否是 DEX swap 交易
        let isDexTx = false;
        let dexType = null;
        
        // 检查交易指令中是否包含 DEX 相关的程序ID
        const DEX_PROGRAMS = {
            // Raydium
            RAYDIUM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
            RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
            RAYDIUM_LIQUIDITY_POOL: '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv',
            RAYDIUM_STABLE_SWAP: '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h',
            
            // Orca
            ORCA: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
            ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
            
            // Jupiter
            JUPITER: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
            JUPITER_V4: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
            
            // Serum
            SERUM: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
            
            // Saber
            SABER: 'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ',
            
            // Aldrin
            ALDRIN: 'AMM55ShdkoGRB5jVYPjWziwk8m5MpwyDgsMWHaMSQWH6',
            
            // Lifinity
            LIFINITY: '2R5B9x7YbXDPcMF3rrs3an3vVB5rW3NvQNAsJfaPVKboop',
            LIFINITY_V2: 'LFNTYraetVioAPnGJht4yNg2aUZFXR776cMeBXts5mq',
            
            // Meteora
            METEORA: 'DLP7r863x3iH33Pb7Wft3GoesvXhZDL3LkpZd5vD9BUb',
            
            // Phoenix
            PHOENIX: 'PHX6sCzYfQfkmrY4EtZmcwYAcVGzmfR2kjvQ3qJheHH',
            
            // Drift (for perpetuals DEX)
            DRIFT: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
            
            // Pump.fun
            PUMP_FUN: '6EF8rrecthR5Dk3v8uyC4mrL9TF1H4C3XHkW1HCCeFP',
            
            // SPL Token Program
            SPL_TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            
            // MEV 相关程序
            JUPITER_MEV: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter MEV
            MEV_PROGRAM: 'MEV1111111111111111111111111111111111111111',    // 通用 MEV 程序
            MEV_BOT: '7rhxnjnQ7rhxnLV8C77o6d8oz26AgK8x8m5ePsdeRawjqvojbjnQ',  // MEV Bot 地址
        };

        // 检查主指令
        for (const ix of instructions) {
            const programId = ix.programId.toBase58();
            if (Object.values(DEX_PROGRAMS).includes(programId)) {
                isDexTx = true;
                dexType = Object.keys(DEX_PROGRAMS).find(key => DEX_PROGRAMS[key] === programId);
                logger.info(`检测到 ${dexType} DEX 交易`);
                break;
            }
        }

        // 检查内部指令
        if (!isDexTx) {
            for (const inner of innerInstructions) {
                for (const ix of inner.instructions) {
                    const programId = ix.programId.toBase58();
                    if (Object.values(DEX_PROGRAMS).includes(programId)) {
                        isDexTx = true;
                        dexType = Object.keys(DEX_PROGRAMS).find(key => DEX_PROGRAMS[key] === programId);
                        logger.info(`检测到 ${dexType} DEX 交易（内部指令）`);
                        break;
                    }
                }
                if (isDexTx) break;
            }
        }

        // 如果不是通过程序ID识别的DEX交易，尝试其他方式识别
        if (!isDexTx) {
            // 1. 检查代币余额变化模式
            const tokenChanges = {};
            for (const balance of tx.meta.preTokenBalances) {
                if (balance.owner === identifiedSigner) {
                    tokenChanges[balance.mint] = {
                        pre: balance.uiTokenAmount.uiAmount,
                        post: null,
                        change: 0
                    };
                }
            }
            for (const balance of tx.meta.postTokenBalances) {
                if (balance.owner === identifiedSigner) {
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

            // 检查是否有典型的SWAP模式：一个代币减少，另一个代币增加
            const changedTokens = Object.entries(tokenChanges).filter(([_, change]) => change.change !== 0);
            if (changedTokens.length >= 2) {
                const hasDecrease = changedTokens.some(([_, change]) => change.change < 0);
                const hasIncrease = changedTokens.some(([_, change]) => change.change > 0);
                
                if (hasDecrease && hasIncrease) {
                    isDexTx = true;
                    dexType = 'UNKNOWN_DEX';
                    logger.info('检测到可能的SWAP交易（通过代币变化模式）');
                }
            }

            // 2. 检查交易指令中的特定模式
            if (!isDexTx) {
                const swapPatterns = [
                    'swap',
                    'exchange',
                    'trade',
                    'pump',
                    'buy',
                    'sell',
                    'route',    // 添加路由相关关键词
                    'mev',      // 添加 MEV 相关关键词
                    'jupiter',  // 添加 Jupiter 相关关键词
                    'fill',     // 添加 Fill 相关关键词
                    'interact'  // 添加 Interact 相关关键词
                ];
                
                for (const ix of instructions) {
                    const data = ix.data?.toString()?.toLowerCase() || '';
                    if (swapPatterns.some(pattern => data.includes(pattern))) {
                        isDexTx = true;
                        dexType = 'UNKNOWN_DEX';
                        logger.info('检测到可能的SWAP交易（通过指令模式）');
                        break;
                    }
                }
            }

            // 3. 检查交易涉及的账户类型
            if (!isDexTx) {
                const accountKeys = await resolveAccountKeys(connection, tx.transaction.message);
                const liquidityPoolPatterns = [
                    'pool',
                    'liquidity',
                    'market',
                    'vault',
                    'reserve',
                    'route',    // 添加路由相关关键词
                    'mev',      // 添加 MEV 相关关键词
                    'jupiter',  // 添加 Jupiter 相关关键词
                    'fill',     // 添加 Fill 相关关键词
                    'interact'  // 添加 Interact 相关关键词
                ];
                
                for (const key of accountKeys) {
                    if (liquidityPoolPatterns.some(pattern => key.toLowerCase().includes(pattern))) {
                        isDexTx = true;
                        dexType = 'UNKNOWN_DEX';
                        logger.info('检测到可能的SWAP交易（通过账户类型）');
                        break;
                    }
                }
            }

            // 4. 检查 MEV 特征
            if (!isDexTx) {
                // 检查是否有多个中间账户
                const accountKeys = await resolveAccountKeys(connection, tx.transaction.message);
                const intermediateAccounts = accountKeys.filter(key => 
                    key !== identifiedSigner && 
                    !key.includes('system') && 
                    !key.includes('token')
                );

                // 检查 MEV Bot 交易模式
                const mevBotPatterns = [
                    'mev bot',
                    'mevbot',
                    '7rhxn',  // MEV Bot 地址前缀
                    'fill',
                    'interact',
                    'transfer from',
                    'transfer to'
                ];

                // 检查账户名称中是否包含 MEV Bot 特征
                const hasMevBot = intermediateAccounts.some(account => 
                    mevBotPatterns.some(pattern => account.toLowerCase().includes(pattern))
                );

                // 检查交易指令中是否包含 MEV Bot 相关操作
                const hasMevBotInstruction = instructions.some(ix => {
                    const data = ix.data?.toString()?.toLowerCase() || '';
                    return mevBotPatterns.some(pattern => data.includes(pattern));
                });

                // 检查是否有典型的 MEV Bot 交易模式
                const hasMevBotPattern = accountKeys.some(key => 
                    key.includes('MEV Bot') || 
                    key.includes('transfer from') || 
                    key.includes('transfer to')
                );

                if (hasMevBot || hasMevBotInstruction || hasMevBotPattern) {
                    isDexTx = true;
                    dexType = 'MEV_BOT';
                    logger.info('检测到 MEV Bot 交易');
                } else if (intermediateAccounts.length >= 2) {
                    // 检查是否有典型的 MEV 路由模式
                    const hasJupiterAccount = intermediateAccounts.some(account => 
                        account.includes('jupiter') || 
                        account.includes('route')
                    );

                    if (hasJupiterAccount) {
                        isDexTx = true;
                        dexType = 'JUPITER_MEV';
                        logger.info('检测到可能的 MEV 路由交易');
                    }
                }
            }
        }

        // 如果不是 DEX swap 交易，直接返回 null
        if (!isDexTx) {
            logger.info('非 DEX swap 交易，跳过处理');
            return null;
        }

        // 分析代币余额变化
        const preBalances = tx.meta.preTokenBalances || [];
        const postBalances = tx.meta.postTokenBalances || [];
        const tokenChanges = {};

        logger.info('分析代币余额变化:');
        logger.info(`preBalances: ${JSON.stringify(preBalances, null, 2)}`);
        logger.info(`postBalances: ${JSON.stringify(postBalances, null, 2)}`);

        // 分析SOL余额变化
        const solMint = 'So11111111111111111111111111111111111111112';
        const targetAccountIndex = tx.transaction.message.accountKeys.findIndex(
            key => key.pubkey.toBase58() === identifiedSigner
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
                logger.info(`SOL变化: ${solChange}`);
            }
        }

        // 分析其他代币变化
        for (const balance of preBalances) {
            if (balance.owner === identifiedSigner) {
                // 使用 amount 字符串而不是 uiAmount
                const amount = balance.uiTokenAmount?.amount || '0';
                const decimals = balance.uiTokenAmount?.decimals || 0;
                const preAmount = parseFloat(amount) / Math.pow(10, decimals);
                
                tokenChanges[balance.mint] = {
                    pre: preAmount,
                    post: null,
                    change: 0
                };
                logger.info(`预余额变化 - 代币: ${balance.mint}, 数量: ${preAmount}`);
            }
        }

        // 如果有 postBalances，处理它们
        if (postBalances.length > 0) {
            for (const balance of postBalances) {
                if (balance.owner === identifiedSigner) {
                    const amount = balance.uiTokenAmount?.amount || '0';
                    const decimals = balance.uiTokenAmount?.decimals || 0;
                    const postAmount = parseFloat(amount) / Math.pow(10, decimals);
                    
                    if (tokenChanges[balance.mint]) {
                        tokenChanges[balance.mint].post = postAmount;
                        tokenChanges[balance.mint].change = postAmount - tokenChanges[balance.mint].pre;
                    } else {
                        tokenChanges[balance.mint] = {
                            pre: 0,
                            post: postAmount,
                            change: postAmount
                        };
                    }
                    logger.info(`后余额变化 - 代币: ${balance.mint}, 数量: ${postAmount}, 变化: ${tokenChanges[balance.mint].change}`);
                }
            }
        } else {
            // 如果没有 postBalances，使用 preBalances 作为参考
            for (const [mint, change] of Object.entries(tokenChanges)) {
                if (change.post === null) {
                    // 假设余额没有变化
                    change.post = change.pre;
                    change.change = 0;
                }
            }
        }

        // 构建交易信息
        txInfo.operation = '未知';
        txInfo.isDexTx = isDexTx;
        txInfo.dexType = dexType;

        // 定义源代币合约地址
        const SOURCE_TOKENS = {
            SOL: 'So11111111111111111111111111111111111111112',
            USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
        };

        // 分析代币变化
        let sourceToken = null;
        let targetToken = null;
        let sourceTokenCount = 0;

        logger.info('分析代币变化:', JSON.stringify(tokenChanges, null, 2));

        // 首先检查是否有代币余额变化
        const changedTokens = Object.entries(tokenChanges).filter(([_, change]) => change.change !== 0);
        if (changedTokens.length === 0) {
            logger.info('没有发现代币余额变化');
            return null;
        }

        for (const [mint, change] of changedTokens) {
            logger.info(`处理代币变化: ${mint}, 变化量: ${change.change}`);

            // 检查是否是源代币
            if (Object.values(SOURCE_TOKENS).includes(mint)) {
                sourceTokenCount++;
                sourceToken = {
                    mint: mint,
                    change: change.change
                };
                logger.info(`识别为源代币: ${mint}`);
            } else {
                targetToken = {
                    mint: mint,
                    change: change.change
                };
                logger.info(`识别为目标代币: ${mint}`);
            }
        }

        // 如果找到了源代币和目标代币，且目标代币不是源代币之一，则处理交易
        if (sourceToken && targetToken && !Object.values(SOURCE_TOKENS).includes(targetToken.mint)) {
            txInfo.sourceTokenContract = sourceToken.mint;
            
            // 如果源代币是 SOL，检查是否是包装的 SOL
            if (sourceToken.mint === SOURCE_TOKENS.SOL) {
                const wrappedSolBalance = preBalances.find(balance => 
                    balance.mint === SOURCE_TOKENS.SOL && balance.owner === identifiedSigner
                );
                
                if (wrappedSolBalance && wrappedSolBalance.uiTokenAmount) {
                    // 如果是包装的 SOL，使用 uiTokenAmount
                    const preAmount = wrappedSolBalance.uiTokenAmount.amount || '0';
                    const decimals = wrappedSolBalance.uiTokenAmount.decimals || 0;
                    const preSolBalance = parseFloat(preAmount) / Math.pow(10, decimals);
                    
                    const postWrappedSolBalance = postBalances.find(balance => 
                        balance.mint === SOURCE_TOKENS.SOL && balance.owner === identifiedSigner
                    );
                    const postAmount = postWrappedSolBalance?.uiTokenAmount?.amount || '0';
                    const postSolBalance = parseFloat(postAmount) / Math.pow(10, decimals);
                    const solChange = postSolBalance - preSolBalance;
                    
                    txInfo.sourceTokenChange = solChange.toString();
                    logger.info(`包装SOL作为源代币的变化: ${solChange}`);
                } else {
                    // 如果是原生 SOL，使用 preBalances 和 postBalances
                    const targetAccountIndex = tx.transaction.message.accountKeys.findIndex(
                        key => key.pubkey.toBase58() === identifiedSigner
                    );
                    if (targetAccountIndex !== -1) {
                        const preSolBalance = tx.meta.preBalances[targetAccountIndex] / 1e9;
                        const postSolBalance = tx.meta.postBalances[targetAccountIndex] / 1e9;
                        const solChange = postSolBalance - preSolBalance;
                        txInfo.sourceTokenChange = solChange.toString();
                        logger.info(`原生SOL作为源代币的变化: ${solChange}`);
                    }
                }
            } else {
                txInfo.sourceTokenChange = sourceToken.change.toString();
            }
            
            txInfo.targetTokenContract = targetToken.mint;
            txInfo.targetTokenChange = targetToken.change.toString();
            txInfo.operation = targetToken.change > 0 ? '买入' : '卖出';
            logger.info('成功识别源代币和目标代币');
        } else {
            logger.info('未找到有效的源代币或目标代币，或交易仅在源代币之间进行，跳过处理');
            logger.info(`源代币: ${sourceToken ? sourceToken.mint : 'null'}`);
            logger.info(`目标代币: ${targetToken ? targetToken.mint : 'null'}`);
            return null;
        }

        // 如果有SOL变化，记录它
        const solChange = tokenChanges[solMint]?.change;
        if (solChange) {
            txInfo.solChange = solChange.toString();
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
                                logger.info(`源代币合约: ${txInfo.sourceTokenContract}`);
                                logger.info(`源代币变化: ${txInfo.sourceTokenChange}`);
                                logger.info(`目标代币合约: ${txInfo.targetTokenContract}`);
                                logger.info(`目标代币变化: ${txInfo.targetTokenChange}`);

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
            updateTime: new Date().toLocaleString('zh-CN', { 
                timeZone: 'Asia/Shanghai',
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        };

    } catch (error) {
        logger.error(`获取代币市值信息失败: ${error.message}`);
        return null;
    }
}

// 发送通知
async function sendNotifications(txInfo, connection) {
    try {
        // 检查地址是否在监控名单中
        if (!KOL_ADDRESS_MAP.has(txInfo.address)) {
            logger.info(`地址 ${txInfo.address} 不在监控名单中，跳过通知`);
            return;
        }

        // 如果没有代币合约信息，不发送通知
        if (!txInfo.sourceTokenContract || !txInfo.targetTokenContract || 
            txInfo.sourceTokenChange === '0' || txInfo.targetTokenChange === '0') {
            logger.info('没有完整的代币合约信息，跳过通知');
            return;
        }

        logger.info('开始构建通知消息...');
        
        // 获取地址对应的昵称
        const nickname = KOL_ADDRESS_MAP.get(txInfo.address);
        
        // 获取当前时间并转换为 UTC+8
        const now = new Date();
        const formattedTime = now.toLocaleString('zh-CN', { 
            timeZone: 'Asia/Shanghai',
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // 构建通知消息
        let message = `🔔 检测到新交易\n\n`;
        message += `交易发起地址：${nickname} (${txInfo.address})\n`;
        message += `时间：${formattedTime}\n`;
        message += `操作类型：${txInfo.operation}\n\n`;
        
        // 处理源代币变化
        if (txInfo.sourceTokenContract && txInfo.sourceTokenChange !== '0') {
            const sourceAmount = parseFloat(txInfo.sourceTokenChange);
            const sourceMarketData = await getTokenMarketCap(connection, txInfo.sourceTokenContract);
            const sourceSymbol = sourceMarketData?.symbol || 'Unknown';
            message += `${sourceSymbol}变化：${Math.abs(sourceAmount).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6
            })}（${txInfo.operation}）\n\n`;
        }
        
        // 处理目标代币变化
        if (txInfo.targetTokenContract && txInfo.targetTokenChange !== '0') {
            const targetAmount = parseFloat(txInfo.targetTokenChange);
            const targetMarketData = await getTokenMarketCap(connection, txInfo.targetTokenContract);
            message += `代币变化：\n`;
            if (targetMarketData && targetMarketData.symbol) {
                message += `- 代币符号：${targetMarketData.symbol}\n`;
            }
            message += `- 代币合约：${txInfo.targetTokenContract}\n`;
            message += `  数量：${Math.abs(targetAmount).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 6
            })}（${txInfo.operation}）\n\n`;

            if (targetMarketData) {
                message += `代币市值信息：\n`;
                message += `- 当前价格：$${targetMarketData.price}\n`;
                message += `- 24h涨跌幅：${targetMarketData.priceChange24h.toFixed(2)}%\n`;
                message += `- 总供应量：${targetMarketData.supply}\n`;
                message += `- 市值：${targetMarketData.marketCap}\n`;
                message += `- 数据更新时间：${targetMarketData.updateTime}\n`;
            }
        }

        // 发送邮件通知
        if (process.env.EMAIL_ENABLED === 'true' && EMAIL_TO) {
            let emailSent = false;
            let workingTransporterIndex = -1;

            // 首先尝试所有发件人，找到第一个可用的
            const startIndex = global.workingEmailIndex || 0;  // 如果是第一次运行，从0开始
            for (let i = startIndex; i < transporters.length + startIndex; i++) {
                const actualIndex = i % transporters.length;  // 确保索引在有效范围内
                try {
                    await transporters[actualIndex].sendMail({
                        from: EMAIL_USERS[actualIndex],
                        to: EMAIL_TO,
                        subject: `🔔 KOL交易监控 - ${nickname} ${txInfo.operation}`,
                        text: message
                    });
                    logger.info(`✅ 邮件通知已发送 (发件人: ${EMAIL_USERS[actualIndex]})`);
                    emailSent = true;
                    workingTransporterIndex = actualIndex;
                    break;
                } catch (error) {
                    logger.error(`邮件发送失败 (发件人: ${EMAIL_USERS[actualIndex]}): ${error.message}`);
                }
            }

            // 如果找到了可用的发件人，后续邮件都使用这个发件人
            if (workingTransporterIndex !== -1) {
                // 更新全局发件人索引，供后续使用
                global.workingEmailIndex = workingTransporterIndex;
            } else {
                logger.error('所有发件人尝试失败，邮件通知未发送');
            }
        }

        // 发送通知到所有配置的聊天ID
        for (const chatId of process.env.TELEGRAM_CHAT_IDS?.split(',')?.filter(Boolean) || []) {
            try {
                await bot.telegram.sendMessage(chatId, message, {
                    parse_mode: 'HTML'
                });
                logger.info(`✅ 交易通知已发送到 ${chatId}`);
            } catch (error) {
                logger.error(`发送交易通知失败 (${chatId}): ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`发送通知失败: ${error.message}`);
    }
}

// 主程序
async function main() {
    try {
        logger.info('=== 启动监控程序 ===');

        // 验证环境变量
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_IDS || !KOL_ADDRESSES.length) {
            throw new Error('缺少必要的环境变量：TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS 或 KOL_ADDRESSES');
        }

        // 初始化 Telegram Bot
        logger.info('\n初始化 Telegram Bot...');
        
        // 验证Bot Token格式
        logger.info('验证Bot Token格式...');
        validateBotToken(process.env.TELEGRAM_BOT_TOKEN);
        logger.info('Bot Token格式验证: ✅ 成功');
        
        // 检查Token状态
        const tokenValid = await checkTokenStatus(process.env.TELEGRAM_BOT_TOKEN);
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

        const botOptions = {
            telegram: {
                apiRoot: workingEndpoint,
                testEnv: false
            }
        };

        // 如果设置了代理环境变量，使用代理
        if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
            const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
            const { HttpsProxyAgent } = await import('https-proxy-agent');
            botOptions.telegram.agent = new HttpsProxyAgent(proxyUrl);
            logger.info(`使用代理: ${proxyUrl}`);
        }

        // 初始化Bot
        logger.info('\n初始化Bot...');
        try {
            bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, botOptions);
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
        } catch (error) {
            logger.error(`getMe测试失败: ${error.message}`);
            throw error;
        }

        // 测试每个chatId的getChat
        const chatIds = process.env.TELEGRAM_CHAT_IDS.split(',').map(id => id.trim());
        for (const chatId of chatIds) {
            logger.info(`\n测试聊天ID: ${chatId}`);
            try {
                const chat = await bot.telegram.getChat(chatId);
                logger.info('getChat成功:');
                logger.info(JSON.stringify(chat, null, 2));
            } catch (error) {
                logger.error(`getChat测试失败: ${error.message}`);
                throw error;
            }
        }

        // 启动Bot
        logger.info('启动Bot...');
        await bot.launch({
            timeout: 30000,
            allowedUpdates: ['message'],
            webhook: {
                enabled: false,
                domain: workingEndpoint.replace('https://', ''),
                port: 8443
            }
        });
        logger.info('Bot启动成功');

        // 检查 Bot 状态并发送状态消息
        logger.info('\n检查 Bot 状态...');
        const botStatus = await checkBotStatus();
        if (!botStatus) {
            throw new Error('Bot 状态检查失败');
        }

        // 检查 Solana 连接
        logger.info('\n检查 Solana 连接...');
        const connection = await waitForConnection();
        if (!connection) throw new Error('无法建立 Solana 连接，程序退出');

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
