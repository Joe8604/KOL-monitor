import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';
import logger from './logger.js';

// 配置
const BIRDEYE_API_KEY = 'ff559fc1e4474e1d9c26e66238b6b3f8';

// Solana 费用计算
async function getSolanaFee() {
    try {
        logger.info('开始获取 Solana 费用数据...');
        
        // 直接连接
        const connection = new Connection('https://api.mainnet-beta.solana.com');
        
        logger.info('正在获取 Solana 费用...');
        // 获取当前费用
        const fees = await connection.getRecentPrioritizationFees();
        const fee = fees[0]?.prioritizationFee || 5000; // 默认费用为 5000 lamports
        const feeInSol = fee / LAMPORTS_PER_SOL;
        
        logger.info('正在获取 SOL 价格...');
        // 使用 CoinGecko API 获取 SOL 价格
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        
        if (!response.ok) {
            throw new Error(`CoinGecko API 请求失败: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data.solana || !data.solana.usd) {
            throw new Error('CoinGecko API 返回数据格式错误');
        }
        
        const solPrice = data.solana.usd;
        const feeInUsd = feeInSol * solPrice;
        
        logger.info('Solana 费用数据获取成功');
        
        return {
            network: 'Solana',
            feeInNative: `${feeInSol.toFixed(9)} SOL`,
            feeInUsd: `$${feeInUsd.toFixed(4)}`,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        };
    } catch (error) {
        logger.error(`获取 Solana 费用失败: ${error.message}`);
        logger.error(`错误详情: ${error.stack}`);
        return null;
    }
}

// BSC 费用计算
async function getBSCFee() {
    try {
        // 获取 BNB 价格
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd');
        const data = await response.json();
        const bnbPrice = data.binancecoin.usd;
        
        // BSC 基础 gas 价格（Gwei）
        const baseGasPrice = 3;
        // 标准交易 gas 限制
        const gasLimit = 21000;
        
        const feeInBnb = (baseGasPrice * gasLimit) / 1e9;
        const feeInUsd = feeInBnb * bnbPrice;
        
        return {
            network: 'BSC',
            feeInNative: `${feeInBnb.toFixed(8)} BNB`,
            feeInUsd: `$${feeInUsd.toFixed(4)}`,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        };
    } catch (error) {
        logger.error(`获取 BSC 费用失败: ${error.message}`);
        return null;
    }
}

// 主函数
async function main() {
    console.log('\n=== 交易费用计算 ===\n');
    
    // 获取 Solana 费用
    const solanaFee = await getSolanaFee();
    if (solanaFee) {
        console.log('Solana 交易费用:');
        console.log(`- 费用: ${solanaFee.feeInNative}`);
        console.log(`- 美元: ${solanaFee.feeInUsd}`);
        console.log(`- 时间: ${solanaFee.timestamp}\n`);
    }
    
    // 获取 BSC 费用
    const bscFee = await getBSCFee();
    if (bscFee) {
        console.log('BSC 交易费用:');
        console.log(`- 费用: ${bscFee.feeInNative}`);
        console.log(`- 美元: ${bscFee.feeInUsd}`);
        console.log(`- 时间: ${bscFee.timestamp}\n`);
    }
    
    // 比较
    if (solanaFee && bscFee) {
        const solanaFeeUsd = parseFloat(solanaFee.feeInUsd.replace('$', ''));
        const bscFeeUsd = parseFloat(bscFee.feeInUsd.replace('$', ''));
        const ratio = bscFeeUsd / solanaFeeUsd;
        
        console.log('费用比较:');
        console.log(`- BSC 费用是 Solana 的 ${ratio.toFixed(1)} 倍`);
    }
}

// 运行程序
main().catch(console.error); 