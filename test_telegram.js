import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { sleep } from './utils.js';
import logger from './logger.js';
import dns from 'dns';
import net from 'net';
import https from 'https';
import http from 'http';

// 加载环境变量
dotenv.config();

// 配置代理
const proxyUrl = process.env.PROXY_URL;
let agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

// 测试DNS解析
async function testDNS(hostname) {
    try {
        logger.info(`\n测试DNS解析 ${hostname}...`);
        const addresses = await dns.promises.resolve4(hostname);
        logger.info(`DNS解析结果: ${addresses.join(', ')}`);
        return addresses;
    } catch (error) {
        logger.error(`DNS解析失败: ${error.message}`);
        return null;
    }
}

// 测试TCP连接
async function testTCP(hostname, port = 443) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 5000;
        
        socket.setTimeout(timeout);
        socket.on('timeout', () => {
            logger.error(`TCP连接超时 (${timeout}ms)`);
            socket.destroy();
            resolve(false);
        });
        
        socket.on('error', (error) => {
            logger.error(`TCP连接错误: ${error.message}`);
            resolve(false);
        });
        
        socket.on('connect', () => {
            logger.info(`TCP连接成功，本地端口: ${socket.localPort}`);
            socket.destroy();
            resolve(true);
        });
        
        logger.info(`尝试TCP连接到 ${hostname}:${port}...`);
        socket.connect(port, hostname);
    });
}

// 测试HTTPS连接
async function testHTTPS(hostname) {
    return new Promise((resolve) => {
        const options = {
            hostname: hostname,
            port: 443,
            path: '/',
            method: 'HEAD',
            timeout: 5000,
            agent: agent,
            followRedirects: true,
            maxRedirects: 5
        };

        const req = https.request(options, (res) => {
            logger.info(`HTTPS状态码: ${res.statusCode}`);
            logger.info(`HTTPS响应头: ${JSON.stringify(res.headers, null, 2)}`);
            
            // 处理重定向
            if (res.statusCode === 302 || res.statusCode === 301) {
                const location = res.headers.location;
                logger.info(`检测到重定向: ${location}`);
                if (location) {
                    // 测试重定向目标
                    const redirectUrl = new URL(location);
                    logger.info(`测试重定向目标: ${redirectUrl.hostname}`);
                    testHTTPS(redirectUrl.hostname).then(resolve);
                    return;
                }
            }
            
            resolve(res.statusCode === 200 || res.statusCode === 302);
        });

        req.on('error', (error) => {
            logger.error(`HTTPS请求错误: ${error.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            logger.error('HTTPS请求超时');
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

// 测试HTTP连接
async function testHTTP(hostname) {
    return new Promise((resolve) => {
        const options = {
            hostname: hostname,
            port: 80,
            path: '/',
            method: 'HEAD',
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            logger.info(`HTTP状态码: ${res.statusCode}`);
            resolve(res.statusCode === 200);
        });

        req.on('error', (error) => {
            logger.error(`HTTP请求错误: ${error.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            logger.error('HTTP请求超时');
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

// 测试网络延迟
async function testLatency(hostname) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const socket = new net.Socket();
        
        socket.on('connect', () => {
            const latency = Date.now() - startTime;
            logger.info(`网络延迟: ${latency}ms`);
            socket.destroy();
            resolve(latency);
        });
        
        socket.on('error', () => {
            logger.error('无法测量网络延迟');
            resolve(null);
        });
        
        socket.connect(443, hostname);
    });
}

// 测试代理连接
async function testProxy(proxyUrl) {
    try {
        logger.info(`\n测试代理连接 ${proxyUrl}...`);
        const url = new URL(proxyUrl);
        
        // 测试代理服务器DNS解析
        logger.info(`测试代理服务器DNS解析 ${url.hostname}...`);
        const addresses = await dns.promises.resolve4(url.hostname);
        logger.info(`代理服务器IP: ${addresses.join(', ')}`);
        
        // 测试代理服务器TCP连接
        logger.info(`测试代理服务器TCP连接 ${url.hostname}:${url.port}...`);
        const tcpConnected = await testTCP(url.hostname, parseInt(url.port));
        logger.info(`代理服务器TCP连接: ${tcpConnected ? '✅ 成功' : '❌ 失败'}`);
        
        return tcpConnected;
    } catch (error) {
        logger.error(`代理测试失败: ${error.message}`);
        return false;
    }
}

// 测试网络连接
async function testNetworkConnection(endpoint) {
    try {
        logger.info(`\n测试网络连接 ${endpoint}...`);
        
        // 测试DNS解析
        const hostname = new URL(endpoint).hostname;
        const addresses = await testDNS(hostname);
        if (!addresses) {
            return false;
        }
        
        // 测试网络延迟
        const latency = await testLatency(hostname);
        if (!latency) {
            return false;
        }
        
        // 测试TCP连接
        const tcpConnected = await testTCP(hostname);
        if (!tcpConnected) {
            return false;
        }
        
        // 测试HTTPS连接
        const httpsConnected = await testHTTPS(hostname);
        if (!httpsConnected) {
            return false;
        }
        
        // 测试API端点
        try {
            logger.info(`测试API端点 ${endpoint}...`);
            const response = await fetch(endpoint, {
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            
            logger.info(`API端点状态码: ${response.status}`);
            logger.info(`API端点响应头: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);
            
            return response.ok;
        } catch (error) {
            logger.error(`API端点测试失败: ${error.message}`);
            return false;
        }
    } catch (error) {
        logger.error(`网络连接测试失败: ${error.message}`);
        return false;
    }
}

// 测试Bot命令
async function testBotCommands(bot, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            logger.info(`\n测试Bot命令 (尝试 ${i + 1}/${retries})...`);
            
            // 注册测试命令
            bot.command('test', async (ctx) => {
                try {
                    await ctx.reply('✅ 命令测试成功');
                } catch (error) {
                    logger.error(`命令处理失败: ${error.message}`);
                }
            });
            
            // 启动Bot
            await bot.launch({
                timeout: 30000,
                allowedUpdates: ['message', 'callback_query'],
                webhook: {
                    enabled: false
                }
            });
            logger.info('Bot启动: ✅ 成功');
            
            // 等待命令响应
            logger.info('等待命令响应...');
            await sleep(10000);
            
            // 停止Bot
            await bot.stop();
            logger.info('Bot已停止');
            
            return true;
        } catch (error) {
            logger.error(`Bot命令测试失败 (尝试 ${i + 1}/${retries}): ${error.message}`);
            if (i < retries - 1) {
                await sleep(5000);
            }
        }
    }
    return false;
}

// 测试Bot Token
async function testBotToken(endpoint, botToken, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            logger.info(`\n测试Bot Token (尝试 ${i + 1}/${retries})...`);
            
            // 测试网络连接
            if (!await testNetworkConnection(endpoint)) {
                throw new Error('网络连接测试失败');
            }
            
            // 使用不同的API方法测试Token
            const methods = ['getMe', 'getUpdates', 'getWebhookInfo'];
            for (const method of methods) {
                try {
                    logger.info(`测试方法 ${method}...`);
                    const response = await fetch(`${endpoint}/bot${botToken}/${method}`, {
                        method: 'GET',
                        timeout: 30000,
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0'
                        }
                    });
                    
                    logger.info(`响应状态码: ${response.status}`);
                    logger.info(`响应头: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);
                    
                    const data = await response.json();
                    logger.info(`响应数据: ${JSON.stringify(data, null, 2)}`);
                    
                    if (!data.ok) {
                        throw new Error(`API错误: ${data.description}`);
                    }
                    
                    logger.info(`Token验证成功 (方法: ${method})`);
                    if (method === 'getMe') {
                        logger.info(`Bot信息: ${JSON.stringify(data.result, null, 2)}`);
                    }
                    return true;
                } catch (error) {
                    logger.error(`Token验证失败 (方法: ${method}): ${error.message}`);
                    if (error.response) {
                        logger.error(`错误响应: ${JSON.stringify(error.response, null, 2)}`);
                    }
                }
            }
            
            throw new Error('所有API方法测试失败');
        } catch (error) {
            logger.error(`Bot Token测试失败 (尝试 ${i + 1}/${retries}): ${error.message}`);
            if (i < retries - 1) {
                logger.info(`等待5秒后重试...`);
                await sleep(5000);
            }
        }
    }
    return false;
}

// 测试发送消息
async function testSendMessage(bot, chatId, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            logger.info(`\n测试发送消息 (尝试 ${i + 1}/${retries})...`);
            
            // 检查chatId格式
            logger.info(`检查chatId格式: ${chatId}`);
            if (!/^-?\d+$/.test(chatId)) {
                throw new Error('chatId格式不正确，应为数字');
            }
            
            // 尝试不同的消息格式
            const messages = [
                '🔔 这是一条测试消息\n时间: ' + new Date().toLocaleString(),
                'Test message ' + new Date().toLocaleString(),
                '测试消息 ' + new Date().toLocaleString()
            ];
            
            for (const message of messages) {
                try {
                    logger.info(`尝试发送消息 (格式: ${message.substring(0, 20)}...)`);
                    logger.info(`使用chatId: ${chatId}`);
                    
                    // 先测试getChat方法
                    try {
                        logger.info('尝试获取Chat信息...');
                        const chatInfo = await bot.telegram.getChat(chatId);
                        logger.info('Chat信息:');
                        logger.info(JSON.stringify(chatInfo, null, 2));
                    } catch (error) {
                        logger.error(`获取Chat信息失败: ${error.message}`);
                        if (error.response) {
                            logger.error(`错误响应: ${JSON.stringify(error.response, null, 2)}`);
                        }
                        // 如果是401错误，可能是Token问题
                        if (error.message.includes('401')) {
                            logger.error('Token可能已失效或被撤销，请检查：');
                            logger.error('1. 确认Token是否正确');
                            logger.error('2. 检查Bot是否被禁用');
                            logger.error('3. 尝试从@BotFather获取新Token');
                            throw error;
                        }
                    }
                    
                    // 尝试直接使用API发送消息
                    try {
                        logger.info('尝试直接使用API发送消息...');
                        const response = await fetch(`${workingEndpoint}/bot${botToken}/sendMessage`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                chat_id: chatId,
                                text: message,
                                parse_mode: 'HTML'
                            })
                        });
                        
                        const data = await response.json();
                        logger.info('API响应:');
                        logger.info(JSON.stringify(data, null, 2));
                        
                        if (!data.ok) {
                            throw new Error(`API错误: ${data.description}`);
                        }
                        
                        logger.info('消息发送: ✅ 成功');
                        logger.info(`消息ID: ${data.result.message_id}`);
                        return true;
                    } catch (error) {
                        logger.error(`API发送消息失败: ${error.message}`);
                        if (error.response) {
                            logger.error(`错误响应: ${JSON.stringify(error.response, null, 2)}`);
                        }
                    }
                    
                    // 如果API调用也失败，尝试使用bot.telegram
                    logger.info('尝试使用bot.telegram发送消息...');
                    const result = await bot.telegram.sendMessage(
                        chatId,
                        message,
                        {
                            timeout: 30000,
                            parse_mode: 'HTML'
                        }
                    );
                    logger.info('消息发送: ✅ 成功');
                    logger.info(`消息ID: ${result.message_id}`);
                    return true;
                } catch (error) {
                    logger.error(`消息发送失败 (格式: ${message.substring(0, 20)}...): ${error.message}`);
                    if (error.response) {
                        logger.error(`错误响应: ${JSON.stringify(error.response, null, 2)}`);
                    }
                }
            }
            
            throw new Error('所有消息格式发送失败');
        } catch (error) {
            logger.error(`消息发送失败 (尝试 ${i + 1}/${retries}): ${error.message}`);
            if (i < retries - 1) {
                logger.info(`等待5秒后重试...`);
                await sleep(5000);
            }
        }
    }
    return false;
}

// 测试连接函数
async function testConnection(endpoint, botToken) {
    try {
        logger.info(`\n=== 测试连接 ${endpoint} ===`);
        
        // 测试代理
        if (proxyUrl) {
            const proxyConnected = await testProxy(proxyUrl);
            if (!proxyConnected) {
                logger.error('代理连接失败，尝试直接连接...');
            }
        }
        
        // 解析域名
        const hostname = new URL(endpoint).hostname;
        const addresses = await testDNS(hostname);
        if (!addresses) {
            return false;
        }
        
        // 测试网络延迟
        await testLatency(hostname);
        
        // 测试TCP连接
        logger.info(`测试TCP连接 ${hostname}:443...`);
        const tcpConnected = await testTCP(hostname);
        logger.info(`TCP连接: ${tcpConnected ? '✅ 成功' : '❌ 失败'}`);
        
        // 测试HTTPS连接
        logger.info(`测试HTTPS连接 ${hostname}...`);
        const httpsConnected = await testHTTPS(hostname);
        logger.info(`HTTPS连接: ${httpsConnected ? '✅ 成功' : '❌ 失败'}`);
        
        // 测试HTTP连接
        logger.info(`测试HTTP连接 ${hostname}...`);
        const httpConnected = await testHTTP(hostname);
        logger.info(`HTTP连接: ${httpConnected ? '✅ 成功' : '❌ 失败'}`);
        
        if (!tcpConnected && !httpsConnected && !httpConnected) {
            return false;
        }
        
        // 测试Bot Token
        return await testBotToken(endpoint, botToken);
    } catch (error) {
        logger.error(`连接失败: ${error.message}`);
        return false;
    }
}

// 验证Bot Token格式
function validateBotToken(token) {
    if (!token) {
        throw new Error('Bot Token不能为空');
    }
    
    // 检查Token格式
    const tokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!tokenRegex.test(token)) {
        throw new Error('Bot Token格式不正确，应为数字:字母数字组合');
    }
    
    // 检查Token长度
    const parts = token.split(':');
    if (parts.length !== 2) {
        throw new Error('Bot Token格式不正确，应包含一个冒号');
    }
    
    // 检查Bot ID
    const botId = parts[0];
    if (!/^\d+$/.test(botId)) {
        throw new Error('Bot ID必须为数字');
    }
    
    // 检查Token哈希
    const tokenHash = parts[1];
    if (tokenHash.length < 30) {
        throw new Error('Token哈希长度不足');
    }
    
    return true;
}

// 检查Token状态
async function checkTokenStatus(token) {
    try {
        logger.info('\n检查Token状态...');
        
        // 尝试从BotFather获取Token信息
        const botFatherResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
            method: 'GET',
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        if (!botFatherResponse.ok) {
            const errorData = await botFatherResponse.json();
            if (errorData.description.includes('bot was blocked') || 
                errorData.description.includes('bot was deleted')) {
                throw new Error('Bot已被封禁或删除，请创建新机器人');
            }
            throw new Error(`Token状态检查失败: ${errorData.description}`);
        }
        
        const data = await botFatherResponse.json();
        if (data.ok) {
            logger.info('Token状态: ✅ 有效');
            logger.info(`Bot信息: ${JSON.stringify(data.result, null, 2)}`);
            return true;
        }
        
        return false;
    } catch (error) {
        logger.error(`Token状态检查失败: ${error.message}`);
        return false;
    }
}

// 主测试函数
async function main() {
    let bot = null;
    try {
        logger.info('=== Telegram连接测试开始 ===');
        
        // 检查环境变量
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        
        if (!botToken || !chatId) {
            throw new Error('请检查环境变量配置: TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID');
        }
        
        // 验证Bot Token格式
        logger.info('验证Bot Token格式...');
        validateBotToken(botToken);
        logger.info('Bot Token格式验证: ✅ 成功');
        
        // 检查Token状态
        const tokenValid = await checkTokenStatus(botToken);
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
        
        // 初始化Bot
        logger.info('\n初始化Bot...');
        try {
            bot = new Telegraf(botToken, {
                telegram: {
                    apiRoot: workingEndpoint,
                    testEnv: false,
                    agent: null
                }
            });
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
        
        // 测试getChat
        logger.info('测试getChat...');
        try {
            const chat = await bot.telegram.getChat(chatId);
            logger.info('getChat成功:');
            logger.info(JSON.stringify(chat, null, 2));
        } catch (error) {
            logger.error(`getChat测试失败: ${error.message}`);
            throw error;
        }
        
        // 测试sendMessage
        logger.info('测试sendMessage...');
        try {
            const message = await bot.telegram.sendMessage(
                chatId,
                '🔔 这是一条测试消息\n时间: ' + new Date().toLocaleString(),
                {
                    parse_mode: 'HTML'
                }
            );
            logger.info('sendMessage成功:');
            logger.info(JSON.stringify(message, null, 2));
        } catch (error) {
            logger.error(`sendMessage测试失败: ${error.message}`);
            throw error;
        }
        
        // 测试Bot命令
        logger.info('测试Bot命令...');
        try {
            // 注册测试命令
            bot.command('test', async (ctx) => {
                try {
                    // 确保ctx和message存在
                    if (!ctx || !ctx.message) {
                        logger.error('无效的命令上下文');
                        return;
                    }
                    
                    // 发送响应
                    await ctx.reply('✅ 命令测试成功');
                    logger.info('命令响应发送成功');
                } catch (error) {
                    logger.error(`命令处理失败: ${error.message}`);
                }
            });
            
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
            
            // 等待命令响应
            logger.info('等待命令响应...');
            await sleep(10000);
            
            // 停止Bot
            logger.info('停止Bot...');
            await bot.stop();
            logger.info('Bot已停止');
            
            logger.info('Bot命令测试: ✅ 成功');
        } catch (error) {
            logger.error(`Bot命令测试失败: ${error.message}`);
            if (error.stack) {
                logger.error(`错误堆栈: ${error.stack}`);
            }
            throw error;
        }
        
        logger.info('\n测试完成');
        
    } catch (error) {
        logger.error(`测试失败: ${error.message}`);
        if (error.response) {
            logger.error(`错误响应: ${JSON.stringify(error.response, null, 2)}`);
        }
    } finally {
        // 确保Bot被正确停止
        if (bot) {
            try {
                logger.info('停止Bot...');
                await bot.stop();
                logger.info('Bot已停止');
            } catch (error) {
                logger.error(`停止Bot失败: ${error.message}`);
            }
        }
        process.exit(0);
    }
}

// 运行测试
main().catch(error => {
    logger.error(`程序运行失败: ${error.message}`);
    process.exit(1);
}); 