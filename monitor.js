const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
require('dotenv').config();
const logger = require('./logger');

// 初始化 Solana 连接
const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed');

// 修改交易解析函数
async function parseTransaction(signature, address) {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    
    if (!tx || !tx.meta || !tx.transaction) {
      logger.warn(`无法获取交易详情: ${signature}`);
      return null;
    }

    // 分析代币余额变化
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    const tokenChanges = {};
    
    // 分析SOL余额变化
    const solMint = 'So11111111111111111111111111111111111111112';
    const targetAccountIndex = tx.transaction.message.accountKeys.findIndex(
      key => key.pubkey.toBase58() === address
    );
    
    if (targetAccountIndex !== -1) {
      const preSolBalance = tx.meta.preBalances[targetAccountIndex] / 1e9;
      const postSolBalance = tx.meta.postBalances[targetAccountIndex] / 1e9;
      
      tokenChanges[solMint] = {
        pre: preSolBalance,
        post: postSolBalance
      };
    }

    // 分析其他代币变化
    for (const balance of preBalances) {
      if (balance.owner === address) {
        tokenChanges[balance.mint] = {
          pre: balance.uiTokenAmount.uiAmount,
          post: null
        };
      }
    }
    for (const balance of postBalances) {
      if (balance.owner === address) {
        if (tokenChanges[balance.mint]) {
          tokenChanges[balance.mint].post = balance.uiTokenAmount.uiAmount;
        } else {
          tokenChanges[balance.mint] = {
            pre: null,
            post: balance.uiTokenAmount.uiAmount
          };
        }
      }
    }

    // 提取交易类型
    let transactionType = '未知';
    if (tx.transaction.message.instructions.length > 0) {
      const instruction = tx.transaction.message.instructions[0];
      if (instruction.programId.toBase58() === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
        // 根据代币变化判断是买入还是卖出
        const tokenChange = Object.entries(tokenChanges)
          .filter(([mint]) => mint !== solMint)
          .map(([_, change]) => change.post - change.pre)
          .find(change => change !== 0) || 0;
        
        transactionType = tokenChange > 0 ? '买入' : '卖出';
      } else if (instruction.programId.toBase58() === '11111111111111111111111111111111') {
        // 对于SOL转账，根据SOL变化判断
        const solChange = tokenChanges[solMint] ? (tokenChanges[solMint].post - tokenChanges[solMint].pre) : 0;
        transactionType = solChange > 0 ? '买入' : '卖出';
      }
    }

    // 构建交易信息对象
    const tradeInfo = {
      address: address,
      transactionType: transactionType,
      solChange: tokenChanges[solMint] ? (tokenChanges[solMint].post - tokenChanges[solMint].pre) : 0,
      tokenContract: Object.keys(tokenChanges).find(mint => mint !== solMint) || 'N/A',
      tokenChange: Object.entries(tokenChanges)
        .filter(([mint]) => mint !== solMint)
        .map(([_, change]) => change.post - change.pre)
        .find(change => change !== 0) || 0
    };

    return tradeInfo;

  } catch (error) {
    logger.error(`解析交易失败: ${error.message}`);
    return null;
  }
}

// 修改通知发送函数
async function sendNotification(tradeInfo) {
  if (!tradeInfo) return;

  const message = {
    address: tradeInfo.address,
    transactionType: tradeInfo.transactionType,
    solChange: tradeInfo.solChange,
    tokenContract: tradeInfo.tokenContract,
    tokenChange: tradeInfo.tokenChange
  };

  try {
    await axios.post(process.env.NOTIFICATION_URL, message);
    logger.info(`通知发送成功: ${JSON.stringify(message)}`);
  } catch (error) {
    logger.error(`发送通知失败: ${error.message}`);
  }
}

// 修改交易监听函数
async function monitorTransactions() {
  try {
    const subscription = connection.onLogs(
      new PublicKey(process.env.MONITOR_ADDRESS),
      async (logs) => {
        try {
          const tradeInfo = await parseTransaction(logs.signature, process.env.MONITOR_ADDRESS);
          if (tradeInfo) {
            await sendNotification(tradeInfo);
          }
        } catch (error) {
          logger.error(`处理交易失败: ${error.message}`);
        }
      },
      'confirmed'
    );

    logger.info(`已订阅地址 ${process.env.MONITOR_ADDRESS} 的交易日志，订阅 ID: ${subscription}`);
    return subscription;

  } catch (error) {
    logger.error(`启动监控失败: ${error.message}`);
    return null;
  }
}

// 启动监控
async function startMonitoring() {
  try {
    logger.info('正在连接到 Solana 节点...');
    const version = await connection.getVersion();
    logger.info(`成功连接到 Solana 节点，版本: ${version}`);

    // 验证监控地址
    try {
      const monitorAddress = new PublicKey(process.env.MONITOR_ADDRESS);
      logger.info(`监控地址有效: ${monitorAddress.toBase58()}`);
    } catch (error) {
      logger.error(`无效的监控地址: ${error.message}`);
      return;
    }

    // 开始监控交易
    const subscription = await monitorTransactions();
    if (!subscription) {
      logger.error('无法启动交易监控');
      return;
    }

    logger.info('交易监控已启动');
    
    // 处理程序退出
    process.on('SIGINT', async () => {
      logger.info('正在停止监控...');
      if (subscription) {
        await subscription.unsubscribe();
      }
      process.exit(0);
    });

  } catch (error) {
    logger.error(`启动监控失败: ${error.message}`);
  }
}

// 启动程序
startMonitoring(); 