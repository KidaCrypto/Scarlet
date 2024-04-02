import moment from 'moment';
import { Connection, GetProgramAccountsFilter, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl, } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import CryptoJS from 'crypto-js';
import bs58 from 'bs58';
import { v4 as uuid } from 'uuid';
import { SOL_DECIMALS } from '../../constants';
import { RecentTask, Task } from '../../App';

export function sleep(ms: number) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(true);
        }, ms);
    });
}

/**
 * Returns the number with 'en' locale settings, ie 1,000
 * @param x number
 * @param minDecimal number
 * @param maxDecimal number
 */
 export function toLocaleDecimal(x: string | number, minDecimal: number, maxDecimal: number) {
    x = Number(x);
    return x.toLocaleString('en', {
        minimumFractionDigits: minDecimal,
        maximumFractionDigits: maxDecimal,
    });
}

export function shortenNumber(x: number | string) {
    if(typeof x === "string") {
        x = Number(x);
    }

    if(x >= 1e12) {
        return `${toLocaleDecimal(x / 1e12, 3, 3)}T`;
    }

    if(x >= 1e9) {
        return `${toLocaleDecimal(x / 1e9, 3, 3)}B`;
    }

    if(x >= 1e6) {
        return `${toLocaleDecimal(x / 1e6, 3, 3)}M`;
    }

    if(x >= 1e3) {
        return `${toLocaleDecimal(x / 1e3, 3, 3)}k`;
    }

    return toLocaleDecimal(x, 3, 3);
}

/**
 * Runs the function if it's a function, returns the result or undefined
 * @param fn
 * @param args
 */
export const runIfFunction = (fn: any, ...args: any): any | undefined => {
    if(typeof(fn) == 'function'){
        return fn(...args);
    }

    return undefined;
}

/**
 * Returns the ellipsized version of string
 * @param x string
 * @param leftCharLength number
 * @param rightCharLength number
 */
export function ellipsizeThis(x: string, leftCharLength: number, rightCharLength: number) {
    if(!x) {
        return x;
    }

    let totalLength = leftCharLength + rightCharLength;

    if(totalLength >= x.length) {
        return x;
    }

    return x.substring(0, leftCharLength) + "..." + x.substring(x.length - rightCharLength, x.length);
}

/**
 * Returns the new object that has no reference to the old object to avoid mutations.
 * @param obj
 */
export const cloneObj = <T = any>(obj: {[key: string]: any}) => {
    return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * @returns string
 */
export const getRandomColor = () => {
    var letters = '0123456789ABCDEF'.split('');
    var color = '#';
    for (var i = 0; i < 6; i++ ) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

export const getRandomNumber = (min: number, max: number, isInteger = false, decimals: number = 3) => {
    let rand = min + (Math.random() * (max - min));
    if(isInteger) {
        return Math.round(rand);
    }

    // to x decimals
    return Math.floor(rand * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export const getRandomChance = () => {
    return getRandomNumber(0, 100);
}

export const getRandomNumberAsString = (min: number, max: number, isInteger = false) => {
    return getRandomNumber(min, max, isInteger).toString();
}

export const getRandomChanceAsString = () => {
    return getRandomNumberAsString(0, 100);
}

export const getUTCMoment = () => {
    return moment().utc();
}

export const getUTCDatetime = () => {
    return getUTCMoment().format('YYYY-MM-DD HH:mm:ss');
}

export const getUTCDate = () => {
    return getUTCMoment().format('YYYY-MM-DD');
}

export const getRPCEndpoint = async() => {
    let customNode = await getCustomNode();
    return customNode? customNode : clusterApiUrl("mainnet-beta");
}

// This is the same for all of the below, and
// you probably won't need it except for debugging
// in most cases.
function bytesToHex(bytes: Uint8Array) {
    return Array.from(
      bytes,
      byte => byte.toString(16).padStart(2, "0")
    ).join("");
  }

export const setPassword = async(password: string) => {
    await chrome.storage.sync.set({ password });
}

export const getPassword = async() => {
    let value = await chrome.storage.sync.get("password");
    return value.password as string;
}

export const setIV = async(iv: string) => {
    await chrome.storage.sync.set({ iv });
}

export const getIV = async() => {
    let value = await chrome.storage.sync.get("iv");
    return value.iv as string;
}

export const setSecretKey = async(filename: string, secretKey: string) => {
    await chrome.storage.sync.set({ [filename]: secretKey });
}

export const getSecretKey = async(filename: string) => {
    let value = await chrome.storage.sync.get(filename);
    return value[filename] as string;
}

export const setPendingTasks = async(tasks: Task[]) => {
    let taskString = JSON.stringify(tasks);
    await chrome.storage.sync.set({ tasks: taskString });
}

export const getPendingTasks = async() => {
    let value = await chrome.storage.sync.get("tasks");
    if(!value.tasks) {
        return [];
    }

    return JSON.parse(value.tasks) as Task[];
}

export const setRecentTasks = async(tasks: RecentTask[]) => {
    let taskString = JSON.stringify(tasks);
    await chrome.storage.sync.set({ recent_tasks: taskString });
}

export const getRecentTasks = async() => {
    let value = await chrome.storage.sync.get("recent_tasks");
    if(!value.recent_tasks) {
        return [];
    }

    return JSON.parse(value.recent_tasks) as RecentTask[];
}

export const setCustomNode = async(node: string) => {
    await chrome.storage.sync.set({ node });
}

export const getCustomNode = async() => {
    let value = await chrome.storage.sync.get("node");
    return value.node;
}

export const setRetryCount = async(retryCount: number) => {
    await chrome.storage.sync.set({ retryCount });
}

export const getRetryCount = async() => {
    let value = await chrome.storage.sync.get("retryCount");
    return value.retryCount ?? 3; // default 3 retries
}

export const removePassword = async() => {
    await chrome.storage.sync.remove("password");
}

const encrypt = async(secretKey: string, password: string) => {
    var passHex = bytesToHex(new TextEncoder().encode(password));
    var ivHex = bytesToHex(new TextEncoder().encode(uuid()));
    let iv = CryptoJS.enc.Utf8.parse(ivHex);
    await setIV(ivHex);
  
    // Encrypt the plaintext
    var cipherText = CryptoJS.AES.encrypt(secretKey, passHex, { iv });
    return cipherText.toString();
}

const decrypt = async(cipherText: string, password: string) => {
    // IV is a hex string
    let ivHex = await getIV();
    let iv = CryptoJS.enc.Utf8.parse(ivHex);
    var passHex = bytesToHex(new TextEncoder().encode(password));
    var decrypted = CryptoJS.AES.decrypt(cipherText, passHex, { iv });

    return decrypted.toString(CryptoJS.enc.Utf8);
}

export const loadOrGenerateKeypair = async(filename: string) => {
    let password = await getPassword();
    if(!password) return;
    let encrypted = await getSecretKey(filename); 
    if(!encrypted) {
        let keypair = Keypair.generate();
        let secretKey = bs58.encode(keypair.secretKey);
        encrypted = await encrypt(secretKey, password);
        setSecretKey(filename, encrypted);
        return keypair;
    }

    let decrypted = bs58.decode(await decrypt(encrypted, password));
    let keypair = Keypair.fromSecretKey(decrypted);
    return keypair;
}

export const getAdminAccount = async() => {
    return await loadOrGenerateKeypair("admin");
}

export const getAdminAccountSecretKey = async() => {
    let keypair = await getAdminAccount();
    if(!keypair) {
        return "";
    }
    return bs58.encode(keypair.secretKey);
}

export //get associated token accounts that stores the SPL tokens
const getTokenAccounts = async(connection: Connection, address: string) => {
  try {
    const filters: GetProgramAccountsFilter[] = [
        {
          dataSize: 165,    //size of account (bytes), this is a constant
        },
        {
          memcmp: {
            offset: 32,     //location of our query in the account (bytes)
            bytes: address,  //our search criteria, a base58 encoded string
          },            
        }];

    const accounts = await connection.getParsedProgramAccounts(
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), //Associated Tokens Program
        {filters: filters}
    );

    /* accounts.forEach((account, i) => {
        //Parse the account data
        const parsedAccountInfo:any = account.account.data;
        const mintAddress:string = parsedAccountInfo["parsed"]["info"]["mint"];
        const tokenBalance: number = parsedAccountInfo["parsed"]["info"]["tokenAmount"]["uiAmount"];
        //Log results
        console.log(`Token Account No. ${i + 1}: ${account.pubkey.toString()}`);
        console.log(`--Token Mint: ${mintAddress}`);
        console.log(`--Token Balance: ${tokenBalance}`);
    }); */
    return accounts;
  }

  catch {
    return [];
  }
};


export //get associated token accounts that stores the SPL tokens
const getToken2022Accounts = async(connection: Connection, address: string) => {
  try {
    const accounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { programId: TOKEN_2022_PROGRAM_ID }
    );

    /* accounts.forEach((account, i) => {
        //Parse the account data
        const parsedAccountInfo:any = account.account.data;
        const mintAddress:string = parsedAccountInfo["parsed"]["info"]["mint"];
        const tokenBalance: number = parsedAccountInfo["parsed"]["info"]["tokenAmount"]["uiAmount"];
        //Log results
        console.log(`Token Account No. ${i + 1}: ${account.pubkey.toString()}`);
        console.log(`--Token Mint: ${mintAddress}`);
        console.log(`--Token Balance: ${tokenBalance}`);
    }); */
    return accounts.value;
  }

  catch {
    return [];
  }
};

// check if the uuid is valid as sanitization
export const isValidUUID = (uuid: string) => {
    return (uuid.match(/^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i)?.length ?? 0) > 0;
}

// check if the email is valid
export const isValidMail = (email: string) => {
    let matches = email.match(/[\w-+.]+@([\w-]+\.)+[\w-]{2,10}/g);
    return matches && matches.length > 0;
}

/**
 * Convert bigint inside obj into string (faciliate JSON.stringify)
 * @param { any } obj
 */
export const convertBigIntToString = (obj : any) => {
    if (typeof obj === 'object') {
        for (let key in obj) {
            if (typeof obj[key] === 'bigint') {
                obj[key] = obj[key].toString();
            } else if (typeof obj[key] === 'object') {
                obj[key] = convertBigIntToString(obj[key]);
            }
        }
    }

    return obj;
}

/* 
export const getAddressNftDetails = async(isPublicKey: boolean, account: string) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");
    let publicKey = getPlayerPublicKey(isPublicKey, account);
    const result = await connection.getAssetsByOwner({ ownerAddress: publicKey.toBase58() });

    // let rawMonsters = result.items.filter(x => x.grouping[0].group_value === getMonsterCollectionAddress());

    return result;
}
 */
export const getAddressSOLBalance = async(publicKey: PublicKey) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    const result = await connection.getBalance(publicKey);
    return result / 1000000000;
}

export const sendSOLTo = async(account: string, amount: number, keypair?: Keypair) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    let lamports = Math.round(amount * 1000000000);

    let currentKeypair = keypair ?? await getAdminAccount();
    if(!currentKeypair) throw Error("Keypair not found");

    let transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: currentKeypair.publicKey,
            toPubkey: new PublicKey(account),
            lamports,
        })
    );
    // Send and confirm transaction
    // Note: feePayer is by default the first signer, or payer, if the parameter is not set
    let txSignature = await connection.sendTransaction(transaction, [currentKeypair]);

    return txSignature;
}

export const sendTokensTo = async(sendTo: string, token: string, tokenDecimals: number, amount: number, keypair?: Keypair) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");
    let currentKeypair = keypair ?? await getAdminAccount();
    if(!currentKeypair) throw Error("Keypair not found");

    const mintToken = new PublicKey(token);
    const recipientAddress = new PublicKey(sendTo);

    const transactionInstructions: TransactionInstruction[] = [];

    // get the sender's token account
    const associatedTokenFrom = await getAssociatedTokenAddress(
      mintToken,
      currentKeypair.publicKey
    );

    const fromAccount = await getAccount(connection, associatedTokenFrom);
    let {
        associatedTokenTo,
        transaction: createTransaction,
    } = await getOrCreateAssociatedAccount(mintToken, currentKeypair.publicKey, recipientAddress);

    if(createTransaction) {
        transactionInstructions.push(createTransaction);
    }

    // the actual instructions
    transactionInstructions.push(
      createTransferInstruction(
        fromAccount.address, // source
        associatedTokenTo, // dest
        currentKeypair.publicKey,
        Math.round(amount * tokenDecimals),
      )
    );

    // send the transactions
    const transaction = new Transaction().add(...transactionInstructions);
    // Send and confirm transaction
    // Note: feePayer is by default the first signer, or payer, if the parameter is not set
    const signature = await connection.sendTransaction(transaction, [currentKeypair]);
    return signature;
}

// return associatedTokenAddress and transaction
// if associatedTokenAddress exists, transaction is null
export const getOrCreateAssociatedAccount = async(mintToken: PublicKey, payer: PublicKey, recipient: PublicKey) => {
    const connection = new Connection(await getRPCEndpoint());

    // get the recipient's token account
    const associatedTokenTo = await getAssociatedTokenAddress(
        mintToken,
        recipient
    );

    let transaction: TransactionInstruction | null = null;

    // if recipient doesn't have token account
    // create token account for recipient
    if (!(await connection.getAccountInfo(associatedTokenTo))) {
        transaction =
            createAssociatedTokenAccountInstruction(
                payer,
                associatedTokenTo,
                recipient,
                mintToken
            );
    }

    return {
        associatedTokenTo,
        transaction,
    };
}

// non public key account
export const clawbackSOLTo = async(account: string) => {

    let adminAccount = await getAdminAccount();
    if(!adminAccount) throw Error("Keypair not found");

    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    let solBalance = await getAddressSOLBalance(adminAccount.publicKey);

    // leave 0.001 SOL
    let clawbackBalance = solBalance - 0.001;

    if(clawbackBalance <= 0) {
        return "";
    }

    let lamports = Math.round(clawbackBalance * SOL_DECIMALS);

    let transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: adminAccount.publicKey,
            toPubkey: new PublicKey(account),
            lamports,
        })
    );
    // Send and confirm transaction
    // Note: feePayer is by default the first signer, or payer, if the parameter is not set

    let txSignature = await connection.sendTransaction(transaction, [adminAccount]);
    return txSignature;
}
/* 
export const transferCNfts = async(nft_ids: string[], nonPublicKeyAccount: string, to: string) => {
    if(nft_ids.length === 0){
        return true;
    }

    const endpoint = await getRPCEndpoint(); //Replace with your RPC Endpoint
    const connection = new Connection(endpoint);

    let nonPublicKeyAccountKeypair = getUserAccount(nonPublicKeyAccount);

    let tries = 0;
    // 10 tries
    // sometimes it doesn't recognize the nft
    while(tries < 10) {
        try {
            let tx = new Transaction();
        
            for(const nft_id of nft_ids) {
                let ix = await createTransferCompressedNftInstruction(new PublicKey(to), new PublicKey(nft_id));
                tx.add(ix);
            }

            await connection.sendTransaction(tx, [nonPublicKeyAccountKeypair]);
            break;
        }

        catch {
            tries++;
            await sleep(5000);
        }
    }

    if(tries >=  3) {
        throw Error ("Unable to send cNFT");
    }

    return true;
}
 */
export const getTransactions = async(address: string, numTx: number) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    const pubKey = new PublicKey(address);
    let transactionList = await connection.getSignaturesForAddress(pubKey, {limit:numTx});
    return transactionList;
}

export const getTx = async(txHash: string) => {
    const endpoint = await getRPCEndpoint(); //Replace with your RPC Endpoint
    const connection = new Connection(endpoint);

    let tx = await connection.getParsedTransaction(txHash, { maxSupportedTransactionVersion: 0 });
    return tx;
}

export const getTokensTransferredToUser = async(txHash: string, toAddress: string, token: string) => {
    let now = moment().add(-2, 'minute');
    let txDetails = await getTx(txHash);
    if(!txDetails || !txDetails.blockTime || !txDetails.meta) {
        throw new Error("No Tx Details");
    }

    let {
        blockTime,
        meta: {
            preTokenBalances,
            postTokenBalances,
        }
    } = txDetails;

    if(!preTokenBalances || !postTokenBalances) {
        throw new Error("Cant find token balance");
    }

    let txMoment = moment(blockTime * 1000);
    if(txMoment.isBefore(now)) {
        throw Error("Old Tx");
    }

    let preBalanceArray = preTokenBalances.filter(x => x.mint === token && x.owner === toAddress);
    let preBalance = preBalanceArray[0]?.uiTokenAmount.uiAmount ?? 0;

    let postBalanceArray = postTokenBalances.filter(x => x.mint === token && x.owner === toAddress);
    let postBalance = postBalanceArray[0]?.uiTokenAmount.uiAmount ?? 0;

    let valueUsd = postBalance - preBalance;
    return Math.round(valueUsd * 1e6) / 1e6;
}


export const getUserTokens = async(userAccount: PublicKey) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    let mintObject: {[mintAddress: string]: {
        amount: number;
        decimals: number;
        ata: string;
    }} = {};

    let userAccounts = await getTokenAccounts(connection, userAccount.toString());
    for(let account of userAccounts) {
        let anyAccount = account.account as any;
        let mint: string = anyAccount.data["parsed"]["info"]["mint"];
        let decimals: number = anyAccount.data["parsed"]["info"]["tokenAmount"]["decimals"];
        let accountAmount: number = anyAccount.data["parsed"]["info"]["tokenAmount"]["uiAmount"];

        let isFrozen = anyAccount.data["parsed"]["info"]["state"] === "frozen";
        // we dont add frozen states
        if(isFrozen) {
            continue;
        }

        mintObject[mint] = {
            amount: accountAmount,
            decimals,
            ata: account.pubkey.toBase58(),
        };
    }

    return mintObject;
}

export const getUserToken2022s = async(userAccount: PublicKey) => {
    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = await getRPCEndpoint();

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new Connection(CLUSTER_URL, "confirmed");

    let mintObject: {[mintAddress: string]: {
        amount: number;
        decimals: number;
        ata: string;
    }} = {};

    let userAccounts = await getToken2022Accounts(connection, userAccount.toString());
    for(let account of userAccounts) {
        let anyAccount = account.account as any;
        let mint: string = anyAccount.data["parsed"]["info"]["mint"];
        let decimals: number = anyAccount.data["parsed"]["info"]["tokenAmount"]["decimals"];
        let accountAmount: number = anyAccount.data["parsed"]["info"]["tokenAmount"]["uiAmount"];
        let isFrozen = anyAccount.data["parsed"]["info"]["state"] === "frozen";

        // we dont add frozen states
        if(isFrozen) {
            continue;
        }

        mintObject[mint] = {
            amount: accountAmount,
            decimals,
            ata: account.pubkey.toBase58(),
        };
    }

    return mintObject;
}

export const getTokenDetails = async(mintAddress: string) => {
    const connection = new Connection(await getRPCEndpoint());
    const mintPublicKey = new PublicKey(mintAddress);
    try {
        let { decimals, supply } = await getMint(connection, mintPublicKey);
        return {
            decimals, supply
        };
    }

    catch {
        return {
            decimals: -1,
            supply: 0,
        }
    }
}