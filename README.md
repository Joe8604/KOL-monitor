# KOL交易监控工具

这是一个用于监控Solana KOL地址交易的工具，当监控的地址发生交易时，会通过Telegram和邮件发送通知。

## 功能特点

- 监控多个KOL地址的交易
- 实时检测代币余额变化
- 通过Telegram发送通知
- 通过邮件发送通知
- 支持SOL和SPL代币的监控

## 安装步骤

1. 克隆仓库
```bash
git clone <repository-url>
cd kol-monitor
```

2. 安装依赖
```bash
npm install
```

3. 配置环境变量
复制`.env.example`文件为`.env`，并填写相应的配置信息：
```bash
cp .env.example .env
```

4. 编辑`.env`文件，填写以下信息：
- RPC_ENDPOINT: Solana RPC节点地址
- WS_ENDPOINT: Solana WebSocket节点地址
- KOL_ADDRESSES: 要监控的KOL地址列表（用逗号分隔）
- TELEGRAM_BOT_TOKEN: Telegram机器人token
- TELEGRAM_CHAT_ID: Telegram聊天ID
- EMAIL_USER: 发件人邮箱
- EMAIL_PASS: 邮箱密码
- EMAIL_TO: 收件人邮箱

## 使用方法

启动监控：
```bash
npm start
```

## 通知内容

当检测到交易时，会发送包含以下信息的通知：
- 交易地址
- 交易签名
- 交易链接
- 代币变化详情（包括SOL和SPL代币）

## 注意事项

1. 确保RPC节点稳定可靠
2. 建议使用专用邮箱发送通知
3. 定期检查监控状态
4. 注意保护敏感信息 