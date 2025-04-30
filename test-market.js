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
        const tokenTotalSupply = supply / Math.pow(10, decimals);
        logger.info(`代币供应量: ${tokenTotalSupply} (原始值: ${supply}, 小数位: ${decimals})`);

        // 2. 获取代币符号
        logger.info('尝试从 DexScreener 获取代币符号...');
        const dexscreenerUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`;
        logger.info(`发送请求到 DexScreener: ${dexscreenerUrl}`);

        try {
            const dexscreenerResponse = await fetch(dexscreenerUrl);
            logger.info(`DexScreener API 响应状态: ${dexscreenerResponse.status}`);

            if (!dexscreenerResponse.ok) {
                const errorText = await dexscreenerResponse.text();
                logger.error(`DexScreener API 错误响应: ${errorText}`);
                throw new Error(`DexScreener API 请求失败: ${dexscreenerResponse.status} ${dexscreenerResponse.statusText}`);
            }

            const dexscreenerData = await dexscreenerResponse.json();
            logger.info(`DexScreener API 响应数据: ${JSON.stringify(dexscreenerData, null, 2)}`);

            const tokenSymbol = dexscreenerData.pairs?.[0]?.baseToken?.symbol || 'Unknown';
            const priceUsd = dexscreenerData.pairs?.[0]?.priceUsd || 0;
            const volume24h = dexscreenerData.pairs?.[0]?.volume?.h24 || 0;
            const liquidity = dexscreenerData.pairs?.[0]?.liquidity?.usd || 0;
            const marketCap = dexscreenerData.pairs?.[0]?.marketCap || 0;
            const change24h = dexscreenerData.pairs?.[0]?.priceChange?.h24 || 0;
            const totalSupply = dexscreenerData.pairs?.[0]?.baseToken?.totalSupply || 0;
            const decimals = dexscreenerData.pairs?.[0]?.baseToken?.decimals || 9;

            // 格式化市值
            const formatMarketCap = (value) => {
                if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
                if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
                if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
                return `$${value.toFixed(2)}`;
            };

            // 格式化供应量
            const formattedSupply = (totalSupply / Math.pow(10, decimals)).toLocaleString('en-US', {
                maximumFractionDigits: 2
            });

            console.log('\n代币市值信息:');
            console.log(`- 代币符号: ${tokenSymbol}`);
            console.log(`- 当前价格: $${priceUsd}`);
            console.log(`- 24h涨跌幅: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}%`);
            console.log(`- 总供应量: ${formattedSupply}`);
            console.log(`- 市值: ${formatMarketCap(marketCap)}`);
            console.log(`- 数据更新时间: ${new Date().toISOString()}`);

            const result = {
                symbol: tokenSymbol,
                price: priceUsd,
                change24h: change24h,
                totalSupply: formattedSupply,
                marketCap: formatMarketCap(marketCap),
                timestamp: new Date().toISOString()
            };

            // 更新缓存
            tokenPriceCache.set(tokenMint, {
                data: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            logger.error(`获取代币信息失败: ${error.message}`);
            return null;
        }

    } catch (error) {
        logger.error(`获取代币信息失败: ${error.message}`);
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
            console.log(`- 市值: $${marketData.marketCap.toLocaleString()}`);
        } else {
            console.log('\n无法获取代币市值信息');
        }
        
    } catch (error) {
        logger.error(`获取代币信息失败: ${error.message}`);
    }
}

getTokenMarketData(); 