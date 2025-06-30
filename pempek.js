const axios = require('axios');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const readline = require('readline');
const moment = require('moment-timezone');

try {
  require('dotenv').config();
} catch (error) {
  console.log('dotenv not found, using environment variables');
}

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",
  hidden: "\x1b[8m",
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m"
};

const logger = {
  info: (msg) => console.log(`${colors.brightCyan}[ℹ]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.brightRed}[✗]${colors.reset} ${colors.red}${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.brightYellow}[⚠]${colors.reset} ${colors.yellow}${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.brightGreen}[✓]${colors.reset} ${colors.green}${msg}${colors.reset}`),
  processing: (msg) => console.log(`${colors.brightBlue}[➤]${colors.reset} ${colors.blue}${msg}${colors.reset}`),
  sending: (msg) => console.log(`${colors.brightMagenta}[⟳]${colors.reset} ${colors.magenta}${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.brightYellow}[◨]${colors.reset} ${colors.yellow}${msg}${colors.reset}`),
  network: (msg) => console.log(`${colors.brightCyan}[฿]${colors.reset} ${colors.cyan}${msg}${colors.reset}`),
  bridge: (msg) => console.log(`${colors.brightMagenta}[⇄]${colors.reset} ${colors.magenta}${msg}${colors.reset}`),
  timer: (msg) => console.log(`${colors.brightBlue}[⏱]${colors.reset} ${colors.blue}${msg}${colors.reset}`),
  stats: (msg) => console.log(`${colors.brightGreen}[↭]${colors.reset} ${colors.green}${msg}${colors.reset}`)
};

class OctraAutoTX {
    constructor() {
        this.rpcUrl = 'https://octra.network';
        this.microOCT = 1_000_000;
        this.nonce = 0;
    }

    getKeyPair(privateKey) {
        try {
            const privateKeyBytes = util.decodeBase64(privateKey);
            
            let signingKey;
            
            if (privateKeyBytes.length === 32) {
                signingKey = nacl.sign.keyPair.fromSeed(privateKeyBytes);
            } else if (privateKeyBytes.length === 64) {
                signingKey = nacl.sign.keyPair.fromSecretKey(privateKeyBytes);
            } else {
                throw new Error(`Invalid key size: ${privateKeyBytes.length} bytes, expected 32 or 64`);
            }
            
            return signingKey;
        } catch (error) {
            logger.error(`Key pair generation error: ${error.message}`);
            logger.error(`Private key length: ${privateKey.length} chars`);
            throw new Error('Invalid private key format');
        }
    }

    async makeApiCall(method, endpoint, data = null) {
        try {
            const url = `${this.rpcUrl}${endpoint}`;
            logger.info(`${method} ${endpoint}`);

            const config = {
                method: method,
                url: url,
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Pempek-Lahat-Auto-TX/1.0'
                }
            };

            if (method === 'POST' && data) {
                config.data = data;
                config.headers['Content-Type'] = 'application/json';
            }

            const response = await axios(config);
            return {
                status: response.status,
                data: response.data,
                text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
            };
        } catch (error) {
            if (error.response) {
                return {
                    status: error.response.status,
                    data: error.response.data,
                    text: error.response.statusText
                };
            }
            throw error;
        }
    }

    async getCurrentNonce(address) {
        try {
            const [balanceResult, stagingResult] = await Promise.all([
                this.makeApiCall('GET', `/balance/${address}`),
                this.makeApiCall('GET', '/staging')
            ]);

            let nonce = 0;

            if (balanceResult.status === 200 && balanceResult.data) {
                nonce = parseInt(balanceResult.data.nonce || 0);
            } else if (balanceResult.status === 404) {
                nonce = 0;
            }

            if (stagingResult.status === 200 && stagingResult.data) {
                const stagedTxs = stagingResult.data.staged_transactions || [];
                const ourTxs = stagedTxs.filter(tx => tx.from === address);
                if (ourTxs.length > 0) {
                    const maxStagedNonce = Math.max(...ourTxs.map(tx => parseInt(tx.nonce || 0)));
                    nonce = Math.max(nonce, maxStagedNonce);
                }
            }

            return nonce;
        } catch (error) {
            logger.warning(`Error getting nonce: ${error.message}`);
            return 0;
        }
    }

    async getBalance(address) {
        try {
            const result = await this.makeApiCall('GET', `/balance/${address}`);
            
            if (result.status === 200 && result.data) {
                return parseFloat(result.data.balance || 0);
            } else if (result.status === 404) {
                return 0;
            } else if (result.status === 200 && result.text) {
                const parts = result.text.trim().split();
                if (parts.length >= 2) {
                    return parseFloat(parts[0]) || 0;
                }
            }
            
            return 0;
        } catch (error) {
            logger.warning(`Error getting balance: ${error.message}`);
            return 0;
        }
    }

    createTransaction(fromAddress, privateKey, toAddress, amount, nonce) {
        try {
            const keyPair = this.getKeyPair(privateKey);
            
            const transaction = {
                from: fromAddress,
                to_: toAddress,                                    
                amount: String(Math.floor(amount * this.microOCT)), 
                nonce: parseInt(nonce),
                ou: amount < 1000 ? "1" : "3",
                timestamp: Date.now() / 1000 + Math.random() * 0.01
            };

            const message = JSON.stringify(transaction).replace(/\s+/g, '').replace(/,}/g, '}').replace(/,]/g, ']');
            const messageBytes = new TextEncoder().encode(message);
            const fullSignature = nacl.sign(messageBytes, keyPair.secretKey);
            const signature = fullSignature.slice(0, 64);
            const publicKey = util.encodeBase64(keyPair.publicKey);
            const finalTransaction = {
                ...transaction,
                signature: util.encodeBase64(signature),
                public_key: publicKey
            };

            logger.info(`${fromAddress.slice(0, 10)}... | Message: ${message.substring(0, 100)}...`);
            logger.info(`${fromAddress.slice(0, 10)}... | Signature: ${util.encodeBase64(signature).substring(0, 20)}...`);

            return finalTransaction;
        } catch (error) {
            logger.error(`Transaction creation error: ${error.message}`);
            throw error;
        }
    }

    async sendTransaction(wallet, toAddress, amount, memo = '') {
        try {
            const nonce = await this.getCurrentNonce(wallet.address);
            const tx = this.createTransaction(wallet.address, wallet.privateKey, toAddress, amount, nonce + 1);
            
            logger.info(`${wallet.name} | Nonce: ${nonce + 1}, Amount: ${amount} OCT`);
            logger.info(`${wallet.name} | Fee: ${tx.ou === "1" ? "0.001" : "0.003"} OCT`);
            
            const result = await this.makeApiCall('POST', '/send-tx', tx);

            if (result.status === 200) {
                let txHash = '';
                
                if (result.data && result.data.status === 'accepted') {
                    txHash = result.data.tx_hash || '';
                } else if (result.text && result.text.toLowerCase().startsWith('ok')) {
                    const parts = result.text.split();
                    txHash = parts[parts.length - 1] || '';
                }

                if (txHash) {
                    return {
                        success: true,
                        hash: txHash,
                        transaction: tx
                    };
                }
            }
            
            const errorMsg = result.data ? JSON.stringify(result.data) : result.text;
            return {
                success: false,
                error: errorMsg || 'Unknown error'
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

function loadWalletsFromEnv() {
    const wallets = [];
    
    for (let i = 1; i <= 10; i++) {
        const privateKey = process.env[`OCTRA_PRIVATE_KEY_${i}`];
        const address = process.env[`OCTRA_ADDRESS_${i}`];
        
        if (!privateKey || !address) continue;
        
        const addressRegex = /^oct[1-9A-HJ-NP-Za-km-z]{44}$/;
        if (!addressRegex.test(address)) {
            logger.warning(`Invalid address format for Wallet${i}: ${address}`);
            continue;
        }
        
        wallets.push({
            name: `Wallet${i}`,
            privateKey: privateKey,
            address: address
        });
    }
    
    return wallets;
}

function loadRecipientsFromEnv() {
    const recipients = [];
    
    for (let i = 1; i <= 10; i++) {
        const recipient = process.env[`RECIPIENT_${i}`];
        if (recipient) {
            const addressRegex = /^oct[1-9A-HJ-NP-Za-km-z]{44}$/;
            if (addressRegex.test(recipient)) {
                recipients.push(recipient);
            } else {
                logger.warning(`Invalid recipient address format: ${recipient}`);
            }
        }
    }
    
    return recipients;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function displayProgress(current, total, walletName = '', operation = '') {
    const percentage = ((current / total) * 100).toFixed(1);
    const progressBar = '█'.repeat(Math.floor(current / total * 20)) + '░'.repeat(20 - Math.floor(current / total * 20));
    
    logger.stats(`${walletName ? `[${walletName}] ` : ''}${operation} Progress: [${colors.brightGreen}${progressBar}${colors.reset}] ${current}/${total} (${percentage}%)`);
}

async function countdownTimer(seconds, message = 'Next operation in') {
    for (let i = seconds; i > 0; i--) {
        process.stdout.write(`\r${colors.brightBlue}[⏱]${colors.reset} ${colors.blue}${message}: ${colors.brightYellow}${i}s${colors.reset} ${colors.dim}${'█'.repeat(Math.floor((seconds - i + 1) / seconds * 20))}${'░'.repeat(20 - Math.floor((seconds - i + 1) / seconds * 20))}${colors.reset}`);
        await delay(1000);
    }
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
}

async function showLoadingAnimation() {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const loadingText = 'Initializing Pempek Lahat Auto-TX System';
    
    return new Promise(resolve => {
        const interval = setInterval(() => {
            process.stdout.write(`\r${colors.brightCyan}${frames[i % frames.length]} ${loadingText}${colors.reset}`);
            i++;
            if (i > 20) {
                clearInterval(interval);
                process.stdout.write('\r' + ' '.repeat(loadingText.length + 5) + '\r');
                resolve();
            }
        }, 100);
    });
}

function generateRandomAmount(min, max) {
    return (Math.random() * (max - min) + min).toFixed(6);
}

async function executeTransactions(wallets, recipients, amount, txPerWallet, isRandom = false, minAmount = 0.01, maxAmount = 0.1) {
    const octra = new OctraAutoTX();
    const totalTx = wallets.length * txPerWallet;
    let completedTx = 0;
    let successfulTx = 0;
    
    logger.bridge(`Starting Pempek Lahat transactions for ${wallets.length} wallets...`);
    logger.stats(`Configuration: ${txPerWallet} tx per wallet to ${recipients.length} recipients (randomized)`);
    logger.stats(`Amount: ${isRandom ? `Random ${minAmount}-${maxAmount}` : amount} OCT`);
    logger.network(`RPC Endpoint: ${octra.rpcUrl} (Python CLI Compatible)`);
    
    for (const wallet of wallets) {
        logger.wallet(`Processing ${wallet.name}: ${wallet.address}`);

        const balance = await octra.getBalance(wallet.address);
        logger.info(`${wallet.name} | Balance: ${colors.brightGreen}${balance.toFixed(6)} OCT${colors.reset}`);
        
        for (let i = 0; i < txPerWallet; i++) {
            const randomRecipient = recipients[Math.floor(Math.random() * recipients.length)];
            
            const txAmount = parseFloat(isRandom ? generateRandomAmount(minAmount, maxAmount) : amount);
            const currentTime = moment().tz('Asia/Jakarta').format('HH:mm:ss');
            
            displayProgress(completedTx, totalTx, wallet.name, 'Pempek TX');
            
            logger.sending(`${wallet.name} | [${currentTime}] Sending ${txAmount.toFixed(6)} OCT to ${randomRecipient.slice(0, 10)}... (Recipient${recipients.indexOf(randomRecipient) + 1})`);
            
            const result = await octra.sendTransaction(
                wallet, 
                randomRecipient,
                txAmount, 
                `Pempek TX ${i + 1} from ${wallet.name}`
            );
            
            completedTx++;
            
            if (result.success) {
                successfulTx++;
                logger.success(`${wallet.name} | TX ${i + 1}/${txPerWallet} ✓ Hash: ${colors.brightYellow}${result.hash}${colors.reset}`);
                logger.info(`${wallet.name} | Explorer: ${colors.underscore}https://octrascan.io/tx/${result.hash}${colors.reset}`);
                logger.info(`${wallet.name} | Sent to: Recipient${recipients.indexOf(randomRecipient) + 1} (${randomRecipient})`);
            } else {
                logger.error(`${wallet.name} | TX ${i + 1}/${txPerWallet} ✗ Error: ${result.error}`);
            }
            
            if (completedTx < totalTx) {
                logger.timer('Waiting 3 seconds before next transaction...');
                await countdownTimer(3, 'Next transaction in');
            }
        }
        
        if (wallets.indexOf(wallet) < wallets.length - 1) {
            logger.timer('Waiting 5 seconds before processing next wallet...');
            await countdownTimer(5, 'Next wallet processing in');
        }
    }
    
    displayProgress(completedTx, totalTx, '', 'Pempek Lahat Transactions COMPLETED');
    logger.success(`All transactions completed!`);
    logger.stats(`Success Rate: ${colors.brightYellow}${successfulTx}/${totalTx}${colors.reset} (${((successfulTx/totalTx)*100).toFixed(1)}%)`);
}

async function showWalletInfo(wallets) {
    const octra = new OctraAutoTX();
    
    logger.info('Fetching wallet information...');
    console.log(`
${colors.brightCyan}═══════════════════════════════════════════════════════════════${colors.reset}
${colors.brightYellow}                       WALLET INFO                          ${colors.reset}
${colors.brightCyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
    
    for (const wallet of wallets) {
        const balance = await octra.getBalance(wallet.address);
        const nonce = await octra.getCurrentNonce(wallet.address);
        
        try {
            const privateKeyBytes = util.decodeBase64(wallet.privateKey);
            logger.info(`${wallet.name} | Private key length: ${wallet.privateKey.length} chars, ${privateKeyBytes.length} bytes`);
        } catch (error) {
            logger.error(`${wallet.name} | Private key decode error: ${error.message}`);
        }
        
        console.log(`
${colors.brightWhite}${wallet.name}:${colors.reset}
  ${colors.cyan}Address:${colors.reset} ${wallet.address}
  ${colors.green}Balance:${colors.reset} ${colors.brightGreen}${balance.toFixed(6)} OCT${colors.reset}
  ${colors.yellow}Nonce:${colors.reset}   ${colors.brightYellow}${nonce}${colors.reset}
  ${colors.magenta}Method:${colors.reset}  ${colors.brightMagenta}Python CLI Compatible${colors.reset}
  ${colors.blue}PK Info:${colors.reset}  ${colors.blue}${wallet.privateKey.length} chars${colors.reset}`);
    }
    
    console.log(`
${colors.brightCyan}═══════════════════════════════════════════════════════════════${colors.reset}
    `);
}

async function main() {
    console.log(`${colors.brightCyan}Starting Pempek Lahat Auto-TX...${colors.reset}`);
    await showLoadingAnimation();
    
    console.log(`
${colors.brightYellow}
██████╗ ███████╗███╗   ███╗██████╗ ███████╗██╗  ██╗    ██╗      █████╗ ██╗  ██╗ █████╗ ████████╗
██╔══██╗██╔════╝████╗ ████║██╔══██╗██╔════╝██║ ██╔╝    ██║     ██╔══██╗██║  ██║██╔══██╗╚══██╔══╝
██████╔╝█████╗  ██╔████╔██║██████╔╝█████╗  █████╔╝     ██║     ███████║███████║███████║   ██║   
██╔═══╝ ██╔══╝  ██║╚██╔╝██║██╔═══╝ ██╔══╝  ██╔═██╗     ██║     ██╔══██║██╔══██║██╔══██║   ██║   
██║     ███████╗██║ ╚═╝ ██║██║     ███████╗██║  ██╗    ███████╗██║  ██║██║  ██║██║  ██║   ██║   
╚═╝     ╚══════╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
${colors.reset}
  `);

  const wallets = loadWalletsFromEnv();
  const recipients = loadRecipientsFromEnv();

  if (wallets.length === 0) {
    logger.error('No wallets found in environment variables!');
    logger.info('Configure OCTRA_PRIVATE_KEY_1, OCTRA_ADDRESS_1, etc. in .env file');
    console.log(`
${colors.yellow}Example .env format:
OCTRA_PRIVATE_KEY_1=your-base64-private-key
OCTRA_ADDRESS_1=your-wallet-address
RECIPIENT_1=target-address-1
RECIPIENT_2=target-address-2${colors.reset}
    `);
    process.exit(1);
  }

  if (recipients.length === 0) {
    logger.error('No recipients found in environment variables!');
    logger.info('Configure RECIPIENT_1, RECIPIENT_2, etc. in .env file');
    process.exit(1);
  }

  logger.success(`Pempek Lahat Configuration Complete!`);
  logger.success(`Found ${colors.brightGreen}${wallets.length}${colors.reset} wallet(s) and ${colors.brightGreen}${recipients.length}${colors.reset} recipient(s)`);
  
  for (const wallet of wallets) {
    logger.success(`${wallet.name}: ${wallet.address.slice(0, 10)}...${wallet.address.slice(-10)}`);
  }
  
  console.log('');
  for (let i = 0; i < recipients.length; i++) {
    logger.info(`Recipient ${i + 1}: ${recipients[i].slice(0, 10)}...${recipients[i].slice(-10)}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (query) => new Promise(resolve => rl.question(query, resolve));

  while (true) {
    console.log(`
${colors.brightYellow}🍤 Pempek Lahat Transaction Options:${colors.reset}
${colors.cyan}1.${colors.reset} Fixed Amount Transactions
${colors.cyan}2.${colors.reset} Random Amount Transactions
${colors.cyan}3.${colors.reset} Show Wallet Information

${colors.brightRed}Exit:${colors.reset}
${colors.cyan}4.${colors.reset} Exit Program
    `);

    const choice = await question(`${colors.brightCyan}🔹 Select option (1-4): ${colors.reset}`);
    
    if (choice === '4') {
      logger.info('Exiting Pempek Lahat Auto-TX... 🍤 Goodbye!');
      break;
    }

    if (choice === '3') {
      await showWalletInfo(wallets);
      continue;
    }

    if (!['1', '2'].includes(choice)) {
      logger.error('Invalid option selection');
      continue;
    }

    const isRandom = choice === '2';
    let amount = '0.1';
    let minAmount = 0.01;
    let maxAmount = 0.1;

    if (isRandom) {
      const minInput = await question(`${colors.brightYellow}Minimum amount (OCT): ${colors.reset}`);
      const maxInput = await question(`${colors.brightYellow}Maximum amount (OCT): ${colors.reset}`);
      
      minAmount = parseFloat(minInput) || 0.01;
      maxAmount = parseFloat(maxInput) || 0.1;
      
      if (minAmount >= maxAmount) {
        logger.error('Minimum amount must be less than maximum amount');
        continue;
      }
      
      logger.success(`Random range: ${colors.brightGreen}${minAmount} - ${maxAmount} OCT${colors.reset}`);
    } else {
      const amountInput = await question(`${colors.brightYellow}Amount per transaction (OCT): ${colors.reset}`);
      amount = amountInput || '0.1';
      logger.success(`Fixed amount: ${colors.brightGreen}${amount} OCT${colors.reset}`);
    }

    const txCountInput = await question(`${colors.brightMagenta}Transactions per wallet: ${colors.reset}`);
    const txPerWallet = parseInt(txCountInput) || 1;

    const startTime = Date.now();
    
    logger.bridge(`Starting ${isRandom ? 'Random' : 'Fixed'} amount Pempek Lahat transactions...`);
    logger.stats(`Configuration: ${txPerWallet} tx per wallet to ${recipients.length} recipients (randomized)`); // CHANGED: Added "randomized"

    await executeTransactions(wallets, recipients, amount, txPerWallet, isRandom, minAmount, maxAmount);

    const endTime = Date.now();
    const duration = Math.floor((endTime - startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    
    logger.success(`All Pempek Lahat transactions completed successfully! 🎉`);
    logger.stats(`Total execution time: ${colors.brightYellow}${minutes}m ${seconds}s${colors.reset}`);
    logger.info(`Explorer: ${colors.underscore}https://octrascan.io/${colors.reset}`);
    
    console.log(`
${colors.dim}═══════════════════════════════════════════════════════════════${colors.reset}
    `);
  }

  rl.close();
}

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  console.error(`${colors.brightRed}Stack trace:${colors.reset}\n${colors.red}${error.stack}${colors.reset}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

console.log(`${colors.brightCyan}Loading Pempek Lahat Auto-TX...${colors.reset}`);
main().catch(error => {
  logger.error(`Application error: ${error.message}`);
  console.error(`${colors.brightRed}Stack trace:${colors.reset}\n${colors.red}${error.stack}${colors.reset}`);
  process.exit(1);
});