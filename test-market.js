import { Connection, PublicKey } from '@solana/web3.js';
import logger from './logger.js';
import axios from 'axios';

// 代币价格缓存
const tokenPriceCache = new Map();
const CACHE_EXPIRY = 5 * 60 * 1000; // 5分钟

// 使用更多的 RPC 节点
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
  'https://solana.public-rpc.com',
  'https://api.rpcpool.com',
  'https://solana-mainnet.rpc.extrnode.com'
];

// Token Metadata Program 地址
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Birdeye API 配置
const BIRDEYE_API_KEY = 'ff559fc1e4474e1d9c26e66238b6b3f8';
const BIRDEYE_API_URL = 'https://public-api.birdeye.so';

async function getConnection() {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const connection = new Connection(endpoint, 'confirmed');
      // 测试连接
      await connection.getVersion();
      return connection;
    } catch (error) {
      logger.warn(`RPC 节点 ${endpoint} 不可用: ${error.message}`);
    }
  }
  throw new Error('所有 RPC 节点都不可用');
}

async function getMetadataAddress(mintAddress) {
  const seeds = [
    Buffer.from('metadata'),
    TOKEN_METADATA_PROGRAM.toBuffer(),
    new PublicKey(mintAddress).toBuffer(),
  ];
  const [metadataAddress] = await PublicKey.findProgramAddress(seeds, TOKEN_METADATA_PROGRAM);
  return metadataAddress;
}

function parseMetadata(data) {
  try {
    // 跳过前 1 个字节的版本号
    const offset = 1;
    
    // 解析更新权限
    const updateAuthority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    
    // 解析铸造者
    const mint = new PublicKey(data.slice(offset + 32, offset + 64)).toBase58();
    
    // 解析名称长度
    const nameLength = data[offset + 64];
    
    // 解析名称
    const name = data.slice(offset + 65, offset + 65 + nameLength).toString('utf8');
    
    // 解析符号长度
    const symbolLength = data[offset + 65 + nameLength];
    
    // 解析符号
    const symbol = data.slice(offset + 66 + nameLength, offset + 66 + nameLength + symbolLength).toString('utf8');
    
    // 解析 URI 长度
    const uriLength = data[offset + 66 + nameLength + symbolLength];
    
    // 解析 URI
    const uri = data.slice(
      offset + 67 + nameLength + symbolLength,
      offset + 67 + nameLength + symbolLength + uriLength
    ).toString('utf8');
    
    return {
      updateAuthority,
      mint,
      name,
      symbol,
      uri
    };
  } catch (error) {
    logger.warn(`解析元数据失败: ${error.message}`);
    return null;
  }
}

async function retryWithBackoff(fn, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') || error.message.includes('Too many requests')) {
        const delay = Math.pow(2, i) * 1000; // 指数退避
        logger.warn(`请求被限制，等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

async function getTokenPriceFromRaydium(tokenAddress) {
  try {
    const response = await axios.get(`https://api.raydium.io/v2/main/pairs?tokenMint=${tokenAddress}`);
    if (response.data && response.data.data && response.data.data.length > 0) {
      const pair = response.data.data[0];
      return {
        price: pair.price,
        volume24h: pair.volume24h,
        liquidity: pair.liquidity
      };
    }
    return null;
  } catch (error) {
    logger.warn(`从 Raydium 获取价格失败: ${error.message}`);
    return null;
  }
}

// 获取代币市值
async function getTokenMarketCap(connection, tokenMint) {
    // 检查缓存
    const cachedData = tokenPriceCache.get(tokenMint);
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_EXPIRY) {
        logger.info(`使用缓存的代币价格信息: ${tokenMint}`);
        return cachedData.data;
    }

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

        // 2. 获取代币价格
        let price = null;
        const dataSources = [
            {
                name: 'Birdeye',
                url: `${BIRDEYE_API_URL}/defi/price`,
                headers: {
                    'accept': 'application/json',
                    'x-chain': 'solana',
                    'X-API-KEY': BIRDEYE_API_KEY
                },
                params: {
                    address: tokenMint
                },
                getPrice: (data) => {
                    logger.info(`Birdeye API 响应数据: ${JSON.stringify(data)}`);
                    if (data.success === false) {
                        logger.warn(`Birdeye API 返回错误: ${data.message}`);
                        return null;
                    }
                    return data.data?.value || null;
                }
            },
            {
                name: 'CoinGecko',
                url: `https://api.coingecko.com/api/v3/simple/token_price/solana`,
                params: {
                    contract_addresses: tokenMint,
                    vs_currencies: 'usd'
                },
                getPrice: (data) => data[tokenMint.toLowerCase()]?.usd || null
            },
            {
                name: 'Raydium',
                url: `https://api.raydium.io/v2/main/price?ids=${tokenMint}`,
                getPrice: (data) => data[tokenMint]?.price || null
            },
            {
                name: 'Jupiter',
                url: 'https://quote-api.jup.ag/v4/tokens',
                getPrice: (data) => data.tokens[tokenMint]?.price || null
            }
        ];

        for (const source of dataSources) {
            try {
                logger.info(`尝试从 ${source.name} 获取代币价格...`);

                // 配置 fetch 选项
                const fetchOptions = {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        ...(source.headers || {})
                    }
                };

                // 构建请求 URL
                let url = source.url;
                if (source.params) {
                    const params = new URLSearchParams(source.params);
                    url += `?${params.toString()}`;
                }

                logger.info(`发送请求到 ${source.name}: ${url}`);
                const response = await fetch(url, fetchOptions);

                logger.info(`API 响应状态: ${response.status}`);
                if (!response.ok) {
                    logger.warn(`从 ${source.name} 获取价格失败: HTTP ${response.status}`);
                    const errorData = await response.text();
                    logger.warn(`API 响应数据: ${errorData}`);
                    continue;
                }

                const data = await response.json();
                price = source.getPrice(data);

                if (price) {
                    logger.info(`从 ${source.name} 获取到代币价格: $${price}`);
                    break;
                } else {
                    logger.warn(`从 ${source.name} 获取的价格数据无效: ${JSON.stringify(data)}`);
                }
            } catch (error) {
                logger.error(`从 ${source.name} 获取代币价格失败: ${error.message}`);
                continue;
            }
        }

        if (!price) {
            logger.warn('无法从任何数据源获取代币价格');
            return null;
        }

        // 3. 计算市值
        const marketCap = (price * totalSupply) / 1e6; // 转换为 M
        logger.info(`代币信息: 价格=$${price}, 供应量=${totalSupply}, 市值=$${marketCap}M`);

        const result = {
            price: price,
            supply: totalSupply,
            marketCap: marketCap.toFixed(2)
        };

        // 更新缓存
        tokenPriceCache.set(tokenMint, {
            data: result,
            timestamp: Date.now()
        });

        return result;

    } catch (error) {
        logger.error(`获取代币市值失败: ${error.message}`);
        logger.error(`错误堆栈: ${error.stack}`);
        return null;
    }
}

async function getTokenMarketData() {
    const tokenMintAddress = '8Qtbdsz1bKN1gi9U8xgvBEE8b7vhAdzqDKzKGCnmpump';
    
    try {
        // 获取 RPC 连接
        const connection = await getConnection();
        
        // 获取代币市值信息
        const marketData = await getTokenMarketCap(connection, tokenMintAddress);
        
        if (marketData) {
            console.log('\n代币市值信息:');
            console.log(`- 代币地址: ${tokenMintAddress}`);
            console.log(`- 当前价格: $${marketData.price}`);
            console.log(`- 总供应量: ${marketData.supply.toLocaleString()}`);
            console.log(`- 市值: $${marketData.marketCap}M`);
        } else {
            console.log('\n无法获取代币市值信息');
        }
        
    } catch (error) {
        logger.error(`获取代币信息失败: ${error.message}`);
    }
}

getTokenMarketData(); 