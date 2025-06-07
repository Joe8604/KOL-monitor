import { Connection, PublicKey } from '@solana/web3.js';
import logger from './logger.js';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

// 代币价格缓存
const tokenPriceCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000; // 5分钟

// 使用更多的 RPC 节点
const RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-mainnet.g.alchemy.com/v2/free',
    'https://solana.public-rpc.com',
    'https://rpc.ankr.com/solana',
    'https://solana-api.projectserum.com'
];

// 代理配置（可选）
const PROXY_CONFIG = {
    host: '127.0.0.1',
    port: 7897
};

// Jupiter API 配置
const JUPITER_BASE_URL = 'https://price.jup.ag/v4';

// 带重试的 fetch 函数
async function fetchWithRetry(url, options, retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            if (i === retries - 1) throw error;
            logger.warn(`请求失败，第 ${i + 1} 次重试: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// 获取 Solana 连接
async function getConnection() {
    for (const endpoint of RPC_ENDPOINTS) {
        try {
            const connection = new Connection(endpoint, 'confirmed');
            await connection.getVersion();
            logger.info(`成功连接到 RPC 节点: ${endpoint}`);
            return connection;
        } catch (error) {
            logger.warn(`RPC 节点 ${endpoint} 不可用: ${error.message}`);
        }
    }
    throw new Error('所有 RPC 节点都不可用');
}

// 从 Jupiter 获取代币价格
async function getTokenPriceFromJupiter(tokenMint) {
    try {
        const cacheKey = `price:${tokenMint}`;
        if (tokenPriceCache.has(cacheKey)) {
            const cached = tokenPriceCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_EXPIRY) {
                logger.info(`使用缓存的价格数据: ${tokenMint}`);
                return cached.data;
            }
        }

        const url = `${JUPITER_BASE_URL}/price?ids=${tokenMint}`;
        logger.info(`正在从 Jupiter 获取代币 ${tokenMint} 的价格...`);

        const response = await fetchWithRetry(url, {
            // 禁用代理以测试直接连接
            // agent: new HttpsProxyAgent({
            //     protocol: 'http:',
            //     host: PROXY_CONFIG.host,
            //     port: PROXY_CONFIG.port,
            //     rejectUnauthorized: false,
            //     keepAlive: true,
            //     timeout: 30000
            // }),
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Jupiter API 错误响应: ${errorText}`);
            throw new Error(`Jupiter API 请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        logger.info(`Jupiter API 响应数据: ${JSON.stringify(data, null, 2)}`);

        if (!data.data || !data.data[tokenMint]) {
            logger.warn(`未找到代币 ${tokenMint} 的价格信息`);
            tokenPriceCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        const priceData = data.data[tokenMint];
        const priceInfo = {
            price: priceData.price || 0,
            priceChange24h: priceData.priceChange24h || 0,
            volume24h: priceData.volume24h || 0
        };

        tokenPriceCache.set(cacheKey, { data: priceInfo, timestamp: Date.now() });
        return priceInfo;
    } catch (error) {
        logger.error(`获取代币价格失败: ${error.message}`);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            logger.error('网络连接问题，请检查网络环境或启用代理 (127.0.0.1:7897)');
        }
        // 尝试 Birdeye API
        return await getTokenPriceFromBirdeye(tokenMint);
    }
}

// 从 Birdeye 获取代币价格（备用）
async function getTokenPriceFromBirdeye(tokenMint) {
    try {
        const url = `https://public-api.birdeye.so/public/price?address=${tokenMint}`;
        logger.info(`正在从 Birdeye 获取代币 ${tokenMint} 的价格...`);
        const response = await fetchWithRetry(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 30000
        });
        const data = await response.json();
        if (data.success && data.data) {
            return { price: data.data.value };
        }
        logger.warn(`Birdeye 未找到代币 ${tokenMint} 的价格`);
        return null;
    } catch (error) {
        logger.error(`Birdeye 查询失败: ${error.message}`);
        return null;
    }
}

// 从 Jupiter 获取代币信息
async function getTokenInfoFromJupiter(tokenMint) {
    try {
        const cacheKey = `info:${tokenMint}`;
        if (tokenPriceCache.has(cacheKey)) {
            const cached = tokenPriceCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_EXPIRY) {
                logger.info(`使用缓存的代币信息: ${tokenMint}`);
                return cached.data;
            }
        }

        const url = `${JUPITER_BASE_URL}/token/${tokenMint}`;
        logger.info(`正在从 Jupiter 获取代币 ${tokenMint} 的信息...`);

        const response = await fetchWithRetry(url, {
            // 禁用代理
            // agent: new HttpsProxyAgent({
            //     protocol: 'http:',
            //     host: PROXY_CONFIG.host,
            //     port: PROXY_CONFIG.port,
            //     rejectUnauthorized: false,
            //     keepAlive: true,
            //     timeout: 30000
            // }),
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`Jupiter API 错误响应: ${errorText}`);
            throw new Error(`Jupiter API 请求失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        logger.info(`Jupiter API 响应数据: ${JSON.stringify(data, null, 2)}`);

        if (!data.data) {
            logger.warn(`未找到代币 ${tokenMint} 的信息`);
            tokenPriceCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        const tokenData = data.data;
        const tokenInfo = {
            name: tokenData.name || '未知',
            symbol: tokenData.symbol || '未知',
            decimals: tokenData.decimals || 0,
            supply: tokenData.supply || '未知'
        };

        tokenPriceCache.set(cacheKey, { data: tokenInfo, timestamp: Date.now() });
        return tokenInfo;
    } catch (error) {
        logger.error(`获取代币信息失败: ${error.message}`);
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            logger.error('网络连接问题，请检查网络环境或启用代理 (127.0.0.1:7897)');
        }
        return null;
    }
}

// 从 Dexscreener 获取交易对信息
async function getPairInfoFromJupiterOrDexscreener(tokenMint) {
    try {
        const cacheKey = `pair:${tokenMint}`;
        if (tokenPriceCache.has(cacheKey)) {
            const cached = tokenPriceCache.get(cacheKey);
            if (Date.now() - cached.timestamp < CACHE_EXPIRY) {
                logger.info(`使用缓存的交易对信息: ${tokenMint}`);
                return cached.data;
            }
        }

        const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
        logger.info(`正在从 Dexscreener 获取代币 ${tokenMint} 的交易对信息...`);
        const response = await fetchWithRetry(url, {
            agent: new HttpsProxyAgent({
                protocol: 'http:',
                host: PROXY_CONFIG.host,
                port: PROXY_CONFIG.port,
                rejectUnauthorized: false,
                keepAlive: true,
                timeout: 30000
            }),
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 30000
        });

        if (!response.ok) {
            logger.error(`Dexscreener API 错误: ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        if (!data.pairs || data.pairs.length === 0) {
            logger.warn(`未找到代币 ${tokenMint} 的交易对，可能是无效的 mint 地址`);
            tokenPriceCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        const pair = data.pairs[0];
        const pairInfo = {
            pairAddress: pair.pairAddress,
            baseToken: pair.baseToken.address,
            quoteToken: pair.quoteToken.address,
            liquidity: pair.liquidity?.usd || 0
        };

        tokenPriceCache.set(cacheKey, { data: pairInfo, timestamp: Date.now() });
        return pairInfo;
    } catch (error) {
        logger.error(`Dexscreener 查询失败: ${error.message}`);
        return null;
    }
}

// 通过交易哈希获取交易对信息
async function getPairInfoByTxHash(txHash) {
    try {
        // 获取 Solana 交易详情
        const connection = await getConnection();
        logger.info(`正在从 Solana 获取交易 ${txHash} 的详情...`);
        
        const tx = await connection.getTransaction(txHash, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: null
        });
        
        if (!tx) {
            logger.error(`未找到交易 ${txHash}`);
            return null;
        }

        // 打印交易基本信息
        console.log('\n交易基本信息:');
        console.log(`- 交易哈希: ${txHash}`);
        console.log(`- 时间戳: ${new Date(tx.blockTime * 1000).toLocaleString()}`);
        console.log(`- 状态: ${tx.meta?.err ? '失败' : '成功'}`);
        console.log(`- 交易版本: ${tx.version || 'legacy'}`);

        // 检查 transaction.message 是否存在
        if (!tx.transaction || !tx.transaction.message) {
            logger.error(`交易 ${txHash} 缺少 message 数据`);
            return { message: '交易数据不完整' };
        }

        // 获取 accountKeys
        const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys || [];
        if (!Array.isArray(accountKeys) || accountKeys.length === 0) {
            logger.error(`交易 ${txHash} 缺少 accountKeys`);
            return { message: '无账户列表数据' };
        }

        // 打印账户列表
        console.log('\n账户列表:');
        accountKeys.forEach((key, index) => {
            console.log(`- 索引 ${index}: ${key.toString()}`);
        });

        // 检查是否为 Swap 交易
        let pairInfo = null;
        const knownDexPrograms = [
            '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
            'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'  // Jupiter
        ];

        // 合并外层和内层指令
        const allInstructions = [
            ...(tx.transaction.message.instructions || []),
            ...(tx.meta?.innerInstructions?.flatMap(inner => inner.instructions) || [])
        ];

        console.log('\n交易指令:');
        console.log(`指令数量: ${allInstructions.length}`);
        if (allInstructions.length === 0) {
            console.log('无指令数据');
        } else {
            allInstructions.forEach((instruction, index) => {
                const programIdIndex = instruction.programIdIndex;
                const programId = programIdIndex >= 0 && programIdIndex < accountKeys.length
                    ? accountKeys[programIdIndex].toString()
                    : '未知';
                console.log(`- 指令 ${index}: 程序 ID ${programId}`);
            });
        }

        for (const instruction of allInstructions) {
            const programIdIndex = instruction.programIdIndex;
            if (programIdIndex >= 0 && programIdIndex < accountKeys.length) {
                const programId = accountKeys[programIdIndex].toString();
                if (knownDexPrograms.includes(programId)) {
                    logger.info(`检测到 DEX 程序: ${programId}`);
                    const poolAddress = instruction.accounts[0] < accountKeys.length
                        ? accountKeys[instruction.accounts[0]].toString()
                        : null;
                    if (poolAddress) {
                        pairInfo = await getPairInfoFromJupiterOrDexscreener(poolAddress);
                    }
                    break;
                }
            }
        }

        // 打印代币余额变化
        if (tx.meta?.postTokenBalances && tx.meta?.preTokenBalances) {
            console.log('\n代币余额变化:');
            for (const postBalance of tx.meta.postTokenBalances) {
                const preBalance = tx.meta.preTokenBalances.find(
                    pre => pre.accountIndex === postBalance.accountIndex
                );
                const preAmount = preBalance ? Number(preBalance.uiTokenAmount.uiAmount) : 0;
                const postAmount = Number(postBalance.uiTokenAmount.uiAmount);
                const change = postAmount - preAmount;
                
                if (change !== 0) {
                    console.log(`- 代币: ${postBalance.mint}, accountIndex: ${postBalance.accountIndex}`);
                    console.log(`  变化: ${change > 0 ? '+' : ''}${change}`);
                    
                    // 验证 accountIndex
                    const accountIndex = postBalance.accountIndex;
                    if (accountIndex >= 0 && accountIndex < accountKeys.length) {
                        console.log(`  账户: ${accountKeys[accountIndex].toString()}`);
                    } else {
                        console.log(`  账户: 无效索引 ${accountIndex}（accountKeys 长度: ${accountKeys.length}）`);
                        logger.warn(`无效账户索引: ${accountIndex} for mint ${postBalance.mint}`);
                        continue;
                    }
                    
                    // 获取代币信息
                    const tokenInfo = await getTokenInfoFromJupiter(postBalance.mint);
                    if (tokenInfo) {
                        console.log('\n代币详细信息:');
                        console.log(`- 名称: ${tokenInfo.name}`);
                        console.log(`- 符号: ${tokenInfo.symbol}`);
                        console.log(`- 小数位: ${tokenInfo.decimals}`);
                        console.log(`- 总供应量: ${tokenInfo.supply}`);
                    }

                    // 获取代币价格
                    const priceInfo = await getTokenPriceFromJupiter(postBalance.mint);
                    if (priceInfo) {
                        console.log('\n代币价格信息:');
                        console.log(`- 当前价格: $${priceInfo.price}`);
                        console.log(`- 24h价格变化: ${priceInfo.priceChange24h > 0 ? '+' : ''}${priceInfo.priceChange24h}%`);
                        console.log(`- 24h交易量: $${priceInfo.volume24h?.toLocaleString() || 0}`);
                    }

                    // 获取交易对信息
                    const pairInfo = await getPairInfoFromJupiterOrDexscreener(postBalance.mint);
                    if (pairInfo) {
                        console.log('\n交易对信息:');
                        console.log(`- 交易对地址: ${pairInfo.pairAddress}`);
                        console.log(`- 基础代币: ${pairInfo.baseToken}`);
                        console.log(`- 报价代币: ${pairInfo.quoteToken}`);
                        console.log(`- 流动性: $${pairInfo.liquidity?.toLocaleString() || 0}`);
                    } else {
                        console.log('\n未找到交易对信息');
                    }
                }
            }
        }

        if (!pairInfo) {
            console.log('\n未检测到 DEX 交易，可能为代币转账或其他操作');
            if (tx.meta?.postTokenBalances) {
                console.log('涉及的代币地址:');
                tx.meta.postTokenBalances.forEach(balance => {
                    console.log(`- ${balance.mint}`);
                });
            }
        }

        return pairInfo || { message: '未找到交易对信息' };
    } catch (error) {
        logger.error(`获取交易对信息失败: ${error.message}`);
        console.error('错误详情:', error.stack);
        return null;
    }
}

// 测试函数
async function testDexInfo() {
    try {
        // 测试交易哈希
        const txHashes = [
            '4gDiXX4FaFhoV6ypVC749embby8vb6ehdnHg8zdqHVopJpyRxA7MBMhKPmNveAVStPTfWV9gpd4y9YCZYJ2RU3WK',
            '5B9kX6Shz9x7yNbWq2rcx84mKbgK3TUmeyU9ux73mBnRbqiNdBysnzE4GLo1tQg65P5mbmbhHehM3a4dqH3uZvqp'
        ];

        for (const txHash of txHashes) {
            console.log(`\n正在查询交易 ${txHash} 的交易对信息...`);
            const result = await getPairInfoByTxHash(txHash);
            if (result) {
                console.log('\n最终交易对信息:');
                console.log(JSON.stringify(result, null, 2));
            }
        }
    } catch (error) {
        logger.error(`测试失败: ${error.message}`);
        console.error('错误详情:', error.stack);
    }
}

// 运行测试
testDexInfo();