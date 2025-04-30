# KOL Monitor

监控 Solana KOL 地址交易并发送通知的应用程序。

## 部署到 Railway

2. 创建新项目
3. 连接 GitHub 仓库
4. 配置环境变量：
   - `TELEGRAM_BOT_TOKEN`: Telegram 机器人 token
   - `TELEGRAM_CHAT_ID`: Telegram 聊天 ID
   - `RPC_ENDPOINT`: Solana RPC 节点地址
   - `WS_ENDPOINT`: Solana WebSocket 节点地址
   - `EMAIL_USER1`: 邮件1发送账号
   - `EMAIL_PASS1`: 邮件1发送密码
   - `EMAIL_USER2`: 邮件2发送账号
   - `EMAIL_PASS2`: 邮件2发送密码
   - `EMAIL_USER3`: 邮件1发送账号
   - `EMAIL_PASS3`: 邮件1发送密码
   - `EMAIL_TO`: 接收通知的邮箱地址

## 本地开发

1. 克隆仓库
2. 安装依赖：
   ```bash
   npm install
   ```
3. 创建 `.env` 文件并配置环境变量
4. 启动应用：
   ```bash
   npm start
   ```

## 环境变量说明

- `TELEGRAM_BOT_TOKEN`: Telegram 机器人的 API token
- `TELEGRAM_CHAT_ID`: 接收通知的 Telegram 聊天 ID
- `RPC_ENDPOINT`: Solana RPC 节点地址（例如：https://api.mainnet-beta.solana.com）
- `WS_ENDPOINT`: Solana WebSocket 节点地址（例如：wss://api.mainnet-beta.solana.com
- `EMAIL_USER_1`: 邮件1发送账号
- `EMAIL_PASS_1`: 邮件1发送密码
- `EMAIL_USER_2`: 邮件2发送账号
- `EMAIL_PASS_2`: 邮件2发送密码
- `EMAIL_USER_3`: 邮件3发送账号
- `EMAIL_PASS_3`: 邮件3发送密码
- `EMAIL_TO`: 接收通知的邮箱地址（多个邮箱用逗号分隔） 

## 功能特点

- 监控多个KOL地址的交易
- 实时检测代币余额变化
- 通过Telegram发送通知
- 通过邮件发送通知
- 支持SOL和SPL代币的监控

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



