import os
import logging
import asyncio
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Commitment
from solana.publickey import PublicKey
import json
import aiohttp
from typing import List, Dict

# Load environment variables
load_dotenv()

# Enable logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Configuration
RPC_NODES = [
    os.getenv('RPC_ENDPOINT'),
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.rpc.extrnode.com',
    'https://solana-mainnet.g.alchemy.com/v2/demo'
]

TELEGRAM_API_ENDPOINTS = [
    'https://api.telegram.org',
    'https://api1.telegram.org',
    'https://api2.telegram.org',
    'https://api3.telegram.org',
    'https://api4.telegram.org',
    'https://api5.telegram.org',
    'https://api6.telegram.org',
    'https://api7.telegram.org',
    'https://api8.telegram.org'
]

KOL_ADDRESSES = os.getenv('KOL_ADDRESSES', '').split(',')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

# Global variables
current_rpc_index = 0
last_working_endpoint = None
subscriptions = {}

async def check_network_status() -> str:
    """Check network status and return working endpoint."""
    global last_working_endpoint
    
    if last_working_endpoint:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(last_working_endpoint) as response:
                    if response.status == 200:
                        return last_working_endpoint
        except Exception as e:
            logger.error(f"Last working endpoint failed: {e}")
    
    for endpoint in TELEGRAM_API_ENDPOINTS:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(endpoint) as response:
                    if response.status == 200:
                        last_working_endpoint = endpoint
                        return endpoint
        except Exception as e:
            logger.error(f"Endpoint {endpoint} failed: {e}")
            await asyncio.sleep(5)
    
    return None

async def create_solana_connection() -> AsyncClient:
    """Create a new Solana connection."""
    global current_rpc_index
    rpc_endpoint = RPC_NODES[current_rpc_index]
    logger.info(f"Connecting to RPC node: {rpc_endpoint}")
    return AsyncClient(rpc_endpoint, commitment=Commitment("confirmed"))

async def switch_rpc_node() -> AsyncClient:
    """Switch to next RPC node."""
    global current_rpc_index
    current_rpc_index = (current_rpc_index + 1) % len(RPC_NODES)
    return await create_solana_connection()

async def monitor_address(address: str, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Monitor a specific Solana address."""
    while True:
        try:
            conn = await create_solana_connection()
            signature = await conn.get_signatures_for_address(PublicKey(address))
            
            if signature and signature.result:
                for sig in signature.result:
                    if sig.signature not in subscriptions.get(address, set()):
                        subscriptions[address] = subscriptions.get(address, set()) | {sig.signature}
                        message = f"🔔 New transaction detected!\nAddress: {address}\nSignature: {sig.signature}"
                        await context.bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=message)
            
            await asyncio.sleep(10)  # Check every 10 seconds
            
        except Exception as e:
            logger.error(f"Error monitoring address {address}: {e}")
            await switch_rpc_node()
            await asyncio.sleep(5)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a message when the command /start is issued."""
    user = update.effective_user
    await update.message.reply_html(
        f"Hi {user.mention_html()}! I'm your Solana monitoring bot. I will notify you of any transactions on the monitored addresses."
    )
    
    # Start monitoring all addresses
    for address in KOL_ADDRESSES:
        if address.strip():
            asyncio.create_task(monitor_address(address.strip(), context))

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a message when the command /help is issued."""
    help_text = """
Available commands:
/start - Start the bot and begin monitoring
/help - Show this help message
/status - Check bot and network status
"""
    await update.message.reply_text(help_text)

async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Check bot and network status."""
    working_endpoint = await check_network_status()
    status_text = f"Network Status: {'✅ Connected' if working_endpoint else '❌ Disconnected'}\n"
    status_text += f"Current RPC Node: {RPC_NODES[current_rpc_index]}\n"
    status_text += f"Monitored Addresses: {len(KOL_ADDRESSES)}\n"
    await update.message.reply_text(status_text)

def main() -> None:
    """Start the bot."""
    # Create the Application and pass it your bot's token
    application = Application.builder().token(os.getenv("TELEGRAM_BOT_TOKEN")).build()

    # Add command handlers
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(CommandHandler("status", status_command))

    # Start the Bot
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main() 