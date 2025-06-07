import { Connection, PublicKey } from '@solana/web3.js';
import logger from './logger.js';
import fs from 'fs';

async function testTransaction() {
    try {
        // 创建日志文件
        const logFile = fs.createWriteStream('transaction_analysis.log', { flags: 'w' });
        
        // 创建 Solana 连接
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        
        // 交易哈希
        const signature1 = '3pMa3CK6sGjvM9xrd7ivry741NNzuJcXj1zASWv9beWhcw1DPpaH472As5oESAw1ygDYX9ZkZUBawjtUK8rLuKSe';
        const signature2 = '4RU1xpefoYgYWf1pjxGCA6gt13ZRyvrRYvuPtfaU9aDVqZyM6E5bcRPR1r6uLsVh8Xgouyp74bXtYgEP1B5WVBLf';
        
        // 获取交易信息
        const tx1 = await connection.getTransaction(signature1, {
            maxSupportedTransactionVersion: 0
        });
        const tx2 = await connection.getTransaction(signature2, {
            maxSupportedTransactionVersion: 0
        });

        if (!tx1 || !tx2) {
            logFile.write('交易不存在\n');
            return;
        }

        // 分析第一笔交易
        logFile.write('\n=== 第一笔交易分析 ===\n');
        logFile.write(`交易哈希: ${signature1}\n`);
        
        // 获取目标账户索引
        const identifiedSigner1 = tx1.transaction.message.staticAccountKeys[0];
        const targetAccountIndex1 = 0;

        logFile.write('\n账户信息:\n');
        logFile.write(`目标账户: ${identifiedSigner1}\n`);
        logFile.write(`目标账户索引: ${targetAccountIndex1}\n`);

        // 分析 SOL 余额变化
        if (targetAccountIndex1 !== -1) {
            const preSolBalance = tx1.meta.preBalances[targetAccountIndex1] / 1e9;
            const postSolBalance = tx1.meta.postBalances[targetAccountIndex1] / 1e9;
            const solChange = postSolBalance - preSolBalance;
            logFile.write(`\nSOL余额变化:\n`);
            logFile.write(`交易前: ${preSolBalance} SOL\n`);
            logFile.write(`交易后: ${postSolBalance} SOL\n`);
            logFile.write(`变化: ${solChange} SOL\n`);
            
            // 直接读取交易费用
            const fee = tx1.meta.fee / 1e9;
            logFile.write(`\n交易费用: ${fee} SOL\n`);
            
            logFile.write('uiTokenAmount: null\n');
        }

        // 分析代币余额变化
        logFile.write('\n代币余额变化:\n');
        const preBalances1 = tx1.meta.preTokenBalances || [];
        const postBalances1 = tx1.meta.postTokenBalances || [];

        // 获取所有涉及的代币
        const allTokens1 = new Set([
            ...preBalances1.map(b => b.mint),
            ...postBalances1.map(b => b.mint)
        ]);

        for (const tokenMint of allTokens1) {
            const preBalance = preBalances1.find(b => b.mint === tokenMint);
            const postBalance = postBalances1.find(b => b.mint === tokenMint);
            
            logFile.write(`\n代币: ${tokenMint}\n`);
            
            if (preBalance) {
                logFile.write(`账户: ${preBalance.owner}\n`);
                logFile.write(`交易前: ${JSON.stringify(preBalance.uiTokenAmount, null, 2)}\n`);
            } else {
                logFile.write('交易前: 无余额\n');
            }
            
            if (postBalance) {
                logFile.write(`账户: ${postBalance.owner}\n`);
                logFile.write(`交易后: ${JSON.stringify(postBalance.uiTokenAmount, null, 2)}\n`);
            } else {
                logFile.write('交易后: 无余额\n');
            }

            if (preBalance && postBalance) {
                // 检查是否为原生代币（uiAmount为null或0）
                if (preBalance.uiTokenAmount.uiAmount === null || postBalance.uiTokenAmount.uiAmount === null ||
                    preBalance.uiTokenAmount.uiAmount === 0 || postBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
                    const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
                    const change = postAmount - preAmount;
                    logFile.write(`变化: ${change}\n`);
                }
            } else if (preBalance) {
                if (preBalance.uiTokenAmount.uiAmount === null || preBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
                    logFile.write(`变化: -${preAmount}\n`);
                }
            } else if (postBalance) {
                if (postBalance.uiTokenAmount.uiAmount === null || postBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
                    logFile.write(`变化: +${postAmount}\n`);
                }
            }
            
            logFile.write('---\n');
        }

        // 分析第二笔交易
        logFile.write('\n=== 第二笔交易分析 ===\n');
        logFile.write(`交易哈希: ${signature2}\n`);
        
        // 获取目标账户索引
        const identifiedSigner2 = tx2.transaction.message.staticAccountKeys[0];
        const targetAccountIndex2 = 0;

        logFile.write('\n账户信息:\n');
        logFile.write(`目标账户: ${identifiedSigner2}\n`);
        logFile.write(`目标账户索引: ${targetAccountIndex2}\n`);

        // 分析 SOL 余额变化
        if (targetAccountIndex2 !== -1) {
            const preSolBalance = tx2.meta.preBalances[targetAccountIndex2] / 1e9;
            const postSolBalance = tx2.meta.postBalances[targetAccountIndex2] / 1e9;
            const solChange = postSolBalance - preSolBalance;
            logFile.write(`\nSOL余额变化:\n`);
            logFile.write(`交易前: ${preSolBalance} SOL\n`);
            logFile.write(`交易后: ${postSolBalance} SOL\n`);
            logFile.write(`变化: ${solChange} SOL\n`);
            
            // 直接读取交易费用
            const fee = tx2.meta.fee / 1e9;
            logFile.write(`\n交易费用: ${fee} SOL\n`);
            
            logFile.write('uiTokenAmount: null\n');
        }

        // 分析代币余额变化
        logFile.write('\n代币余额变化:\n');
        const preBalances2 = tx2.meta.preTokenBalances || [];
        const postBalances2 = tx2.meta.postTokenBalances || [];

        // 获取所有涉及的代币
        const allTokens2 = new Set([
            ...preBalances2.map(b => b.mint),
            ...postBalances2.map(b => b.mint)
        ]);

        for (const tokenMint of allTokens2) {
            const preBalance = preBalances2.find(b => b.mint === tokenMint);
            const postBalance = postBalances2.find(b => b.mint === tokenMint);
            
            logFile.write(`\n代币: ${tokenMint}\n`);
            
            if (preBalance) {
                logFile.write(`账户: ${preBalance.owner}\n`);
                logFile.write(`交易前: ${JSON.stringify(preBalance.uiTokenAmount, null, 2)}\n`);
            } else {
                logFile.write('交易前: 无余额\n');
            }
            
            if (postBalance) {
                logFile.write(`账户: ${postBalance.owner}\n`);
                logFile.write(`交易后: ${JSON.stringify(postBalance.uiTokenAmount, null, 2)}\n`);
            } else {
                logFile.write('交易后: 无余额\n');
            }

            if (preBalance && postBalance) {
                // 检查是否为原生代币（uiAmount为null或0）
                if (preBalance.uiTokenAmount.uiAmount === null || postBalance.uiTokenAmount.uiAmount === null ||
                    preBalance.uiTokenAmount.uiAmount === 0 || postBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
                    const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
                    const change = postAmount - preAmount;
                    logFile.write(`变化: ${change}\n`);
                }
            } else if (preBalance) {
                if (preBalance.uiTokenAmount.uiAmount === null || preBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const preAmount = parseFloat(preBalance.uiTokenAmount.uiAmountString || '0');
                    logFile.write(`变化: -${preAmount}\n`);
                }
            } else if (postBalance) {
                if (postBalance.uiTokenAmount.uiAmount === null || postBalance.uiTokenAmount.uiAmount === 0) {
                    logFile.write('变化: 原生代币，不计算变化\n');
                } else {
                    const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
                    logFile.write(`变化: +${postAmount}\n`);
                }
            }
            
            logFile.write('---\n');
        }

        // 关闭日志文件
        logFile.end();
        logger.info('分析完成，结果已写入 transaction_analysis.log');

    } catch (error) {
        logger.error(`测试失败: ${error.message}`);
        logger.error(error.stack);
    }
}

testTransaction();

// 测试代币余额变化分析
async function testTokenBalanceChanges() {
    logger.info('\n=== 测试代币余额变化分析 ===');
    
    // 测试用例1: 原生 SOL 交易
    const solTx = {
        meta: {
            preBalances: [1000000000, 0],  // 1 SOL
            postBalances: [500000000, 0],   // 0.5 SOL
            preTokenBalances: [],
            postTokenBalances: []
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };
    
    // 测试用例2: 包装 SOL 交易
    const wrappedSolTx = {
        meta: {
            preBalances: [1000000000, 0],
            postBalances: [1000000000, 0],
            preTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '1000000000', decimals: 9, uiAmount: 1.0 }
                }
            ],
            postTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '500000000', decimals: 9, uiAmount: 0.5 }
                }
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };
    
    // 测试用例3: 原生 SOL 和包装 SOL 混合交易
    const mixedSolTx = {
        meta: {
            preBalances: [1000000000, 0],  // 1 SOL
            postBalances: [500000000, 0],   // 0.5 SOL
            preTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '1000000000', decimals: 9, uiAmount: 1.0 }
                }
            ],
            postTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '500000000', decimals: 9, uiAmount: 0.5 }
                }
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };

    // 测试用例4: SOL 和 USDC 交易
    const solUsdcTx = {
        meta: {
            preBalances: [1000000000, 0],  // 1 SOL
            postBalances: [500000000, 0],   // 0.5 SOL
            preTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
                    uiTokenAmount: { amount: '0', decimals: 6, uiAmount: 0 }
                }
            ],
            postTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
                    uiTokenAmount: { amount: '1000000', decimals: 6, uiAmount: 1.0 }
                }
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };

    // 测试用例5: 包装 SOL 和 USDC 交易
    const wrappedSolUsdcTx = {
        meta: {
            preBalances: [1000000000, 0],
            postBalances: [1000000000, 0],
            preTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '1000000000', decimals: 9, uiAmount: 1.0 }
                },
                {
                    owner: 'testAddress',
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
                    uiTokenAmount: { amount: '0', decimals: 6, uiAmount: 0 }
                }
            ],
            postTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: { amount: '500000000', decimals: 9, uiAmount: 0.5 }
                },
                {
                    owner: 'testAddress',
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
                    uiTokenAmount: { amount: '1000000', decimals: 6, uiAmount: 1.0 }
                }
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };

    // 测试用例6: 实际交易
    const realTx = {
        meta: {
            preBalances: [1000000000, 0],
            postBalances: [500000000, 0],
            preTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: null
                }
            ],
            postTokenBalances: [
                {
                    owner: 'testAddress',
                    mint: 'So11111111111111111111111111111111111111112',
                    uiTokenAmount: null
                }
            ]
        },
        transaction: {
            message: {
                accountKeys: [
                    { pubkey: { toBase58: () => 'testAddress' } }
                ]
            }
        }
    };

    // 运行测试
    logger.info('\n测试用例1: 原生 SOL 交易');
    logger.info('原生 SOL 余额变化:');
    logger.info(`preBalance: ${solTx.meta.preBalances[0] / 1e9} SOL`);
    logger.info(`postBalance: ${solTx.meta.postBalances[0] / 1e9} SOL`);
    logger.info(`变化: ${(solTx.meta.postBalances[0] - solTx.meta.preBalances[0]) / 1e9} SOL`);
    logger.info('uiTokenAmount: null');
    const solResult = await parseTransaction(mockConnection, solTx);
    logger.info('解析结果:', JSON.stringify(solResult, null, 2));

    logger.info('\n测试用例2: 包装 SOL 交易');
    logger.info('包装 SOL 余额变化:');
    logger.info('preTokenBalance:', JSON.stringify(wrappedSolTx.meta.preTokenBalances[0].uiTokenAmount, null, 2));
    logger.info('postTokenBalance:', JSON.stringify(wrappedSolTx.meta.postTokenBalances[0].uiTokenAmount, null, 2));
    logger.info(`变化: ${wrappedSolTx.meta.postTokenBalances[0].uiTokenAmount.uiAmount - wrappedSolTx.meta.preTokenBalances[0].uiTokenAmount.uiAmount} SOL`);
    const wrappedSolResult = await parseTransaction(mockConnection, wrappedSolTx);
    logger.info('解析结果:', JSON.stringify(wrappedSolResult, null, 2));

    logger.info('\n测试用例3: 原生 SOL 和包装 SOL 混合交易');
    logger.info('原生 SOL 余额变化:');
    logger.info(`preBalance: ${mixedSolTx.meta.preBalances[0] / 1e9} SOL`);
    logger.info(`postBalance: ${mixedSolTx.meta.postBalances[0] / 1e9} SOL`);
    logger.info(`变化: ${(mixedSolTx.meta.postBalances[0] - mixedSolTx.meta.preBalances[0]) / 1e9} SOL`);
    logger.info('uiTokenAmount: null');
    logger.info('包装 SOL 余额变化:');
    logger.info('preTokenBalance:', JSON.stringify(mixedSolTx.meta.preTokenBalances[0].uiTokenAmount, null, 2));
    logger.info('postTokenBalance:', JSON.stringify(mixedSolTx.meta.postTokenBalances[0].uiTokenAmount, null, 2));
    logger.info(`变化: ${mixedSolTx.meta.postTokenBalances[0].uiTokenAmount.uiAmount - mixedSolTx.meta.preTokenBalances[0].uiTokenAmount.uiAmount} SOL`);
    const mixedSolResult = await parseTransaction(mockConnection, mixedSolTx);
    logger.info('解析结果:', JSON.stringify(mixedSolResult, null, 2));

    logger.info('\n测试用例4: SOL 和 USDC 交易');
    logger.info('原生 SOL 余额变化:');
    logger.info(`preBalance: ${solUsdcTx.meta.preBalances[0] / 1e9} SOL`);
    logger.info(`postBalance: ${solUsdcTx.meta.postBalances[0] / 1e9} SOL`);
    logger.info(`变化: ${(solUsdcTx.meta.postBalances[0] - solUsdcTx.meta.preBalances[0]) / 1e9} SOL`);
    logger.info('uiTokenAmount: null');
    logger.info('USDC 余额变化:');
    logger.info('preTokenBalance:', JSON.stringify(solUsdcTx.meta.preTokenBalances[0].uiTokenAmount, null, 2));
    logger.info('postTokenBalance:', JSON.stringify(solUsdcTx.meta.postTokenBalances[0].uiTokenAmount, null, 2));
    logger.info(`变化: ${solUsdcTx.meta.postTokenBalances[0].uiTokenAmount.uiAmount - solUsdcTx.meta.preTokenBalances[0].uiTokenAmount.uiAmount} USDC`);
    const solUsdcResult = await parseTransaction(mockConnection, solUsdcTx);
    logger.info('解析结果:', JSON.stringify(solUsdcResult, null, 2));

    logger.info('\n测试用例5: 包装 SOL 和 USDC 交易');
    logger.info('包装 SOL 余额变化:');
    logger.info('preTokenBalance:', JSON.stringify(wrappedSolUsdcTx.meta.preTokenBalances[0].uiTokenAmount, null, 2));
    logger.info('postTokenBalance:', JSON.stringify(wrappedSolUsdcTx.meta.postTokenBalances[0].uiTokenAmount, null, 2));
    logger.info(`变化: ${wrappedSolUsdcTx.meta.postTokenBalances[0].uiTokenAmount.uiAmount - wrappedSolUsdcTx.meta.preTokenBalances[0].uiTokenAmount.uiAmount} SOL`);
    logger.info('USDC 余额变化:');
    logger.info('preTokenBalance:', JSON.stringify(wrappedSolUsdcTx.meta.preTokenBalances[1].uiTokenAmount, null, 2));
    logger.info('postTokenBalance:', JSON.stringify(wrappedSolUsdcTx.meta.postTokenBalances[1].uiTokenAmount, null, 2));
    logger.info(`变化: ${wrappedSolUsdcTx.meta.postTokenBalances[1].uiTokenAmount.uiAmount - wrappedSolUsdcTx.meta.preTokenBalances[1].uiTokenAmount.uiAmount} USDC`);
    const wrappedSolUsdcResult = await parseTransaction(mockConnection, wrappedSolUsdcTx);
    logger.info('解析结果:', JSON.stringify(wrappedSolUsdcResult, null, 2));

    logger.info('\n测试用例6: 实际交易');
    logger.info('原生 SOL 余额变化:');
    logger.info(`preBalance: ${realTx.meta.preBalances[0] / 1e9} SOL`);
    logger.info(`postBalance: ${realTx.meta.postBalances[0] / 1e9} SOL`);
    logger.info(`变化: ${(realTx.meta.postBalances[0] - realTx.meta.preBalances[0]) / 1e9} SOL`);
    logger.info('uiTokenAmount:', JSON.stringify(realTx.meta.preTokenBalances[0].uiTokenAmount, null, 2));
    const realTxResult = await parseTransaction(mockConnection, realTx);
    logger.info('解析结果:', JSON.stringify(realTxResult, null, 2));
} 