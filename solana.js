import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

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

export async function monitorAddress(address, bot, chatId) {
    while (true) {
        try {
            const conn = await createSolanaConnection();
            const signatures = await conn.getSignaturesForAddress(new PublicKey(address));
            
            if (signatures && signatures.length > 0) {
                const addressSubscriptions = subscriptions.get(address) || new Set();
                
                for (const sig of signatures) {
                    if (!addressSubscriptions.has(sig.signature)) {
                        addressSubscriptions.add(sig.signature);
                        subscriptions.set(address, addressSubscriptions);
                        
                        const message = `🔔 New transaction detected!\nAddress: ${address}\nSignature: ${sig.signature}`;
                        await bot.sendMessage(chatId, message);
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
            
        } catch (error) {
            console.error(`Error monitoring address ${address}:`, error);
            await switchRpcNode();
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

export async function startMonitoring(bot, chatId) {
    const addresses = process.env.KOL_ADDRESSES.split(',');
    for (const address of addresses) {
        if (address.trim()) {
            monitorAddress(address.trim(), bot, chatId);
        }
    }
} 