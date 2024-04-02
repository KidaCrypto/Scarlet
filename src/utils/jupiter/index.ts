import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAdminAccount, getOrCreateAssociatedAccount, getRPCEndpoint, getUserTokens, sleep } from "../common";
import axios from 'axios';
import { SOL_ADDRESS, SOL_DECIMALS } from "../../constants";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";

const PLATFORM_FEE = 20; // 20bps
const JUPITER_FEE = 0.025; // 2.5% to jupiter
const feeCollector = "BwUfN6xYAjAEk1278L6GoQTCSfVAXdiPQMraheqhUC3e";
const jupiterFeeCollector = "462rcS83W27gP4ZkAPja93we1f9FGFcErh9ANqVd6t6e";
const referralProgramPubKey = new PublicKey("REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3");
const referralAccountPubkey = new PublicKey("CAskPdjCzrcDytArkjmXqP4v2aRqYviPpyjnMpj5xiPG");
const referralAccountPubkeyString = "CAskPdjCzrcDytArkjmXqP4v2aRqYviPpyjnMpj5xiPG";

export const addPriorityFeeToTransaction = (tx: Transaction, microLamports: number, limit: number) => {
    // Create the priority fee instructions
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports,
    });

    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: limit,
    });

    tx.instructions.push(computePriceIx);
    tx.instructions.push(computeLimitIx);

    return tx;
}

export const addPriorityFeeToVersionedTransaction = async(connection: Connection, tx: VersionedTransaction, microLamports: number, limit: number, additionalIxs?: TransactionInstruction[]) => {
    // Create the priority fee instructions
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports,
    });

    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: limit,
    });

    const addressLookupTableAccounts = await Promise.all(
        tx.message.addressTableLookups.map(async (lookup) => {
          return new AddressLookupTableAccount({
            key: lookup.accountKey,
            state: AddressLookupTableAccount.deserialize(await connection.getAccountInfo(lookup.accountKey).then((res) => res!.data)),
          })
    }))
    console.log('decompiling message');
    var message = TransactionMessage.decompile(tx.message,{addressLookupTableAccounts: addressLookupTableAccounts});
    console.log('decompiled message');
    message.instructions.push(computeLimitIx);
    message.instructions.push(computePriceIx);
    console.log('instructions pushed');

    if(additionalIxs && additionalIxs.length > 0) {
        additionalIxs.forEach(ix => message.instructions.push(ix));
    }
    
    tx.message = message.compileToV0Message(addressLookupTableAccounts);

    return tx;
}

export const addAdditionalIxsToVersionedTransaction = async(connection: Connection, tx: VersionedTransaction, additionalIxs: TransactionInstruction[]) => {
    const addressLookupTableAccounts = await Promise.all(
        tx.message.addressTableLookups.map(async (lookup) => {
          return new AddressLookupTableAccount({
            key: lookup.accountKey,
            state: AddressLookupTableAccount.deserialize(await connection.getAccountInfo(lookup.accountKey).then((res) => res!.data)),
          })
    }));

    var message = TransactionMessage.decompile(tx.message,{addressLookupTableAccounts: addressLookupTableAccounts});

    if(additionalIxs && additionalIxs.length > 0) {
        additionalIxs.forEach(ix => message.instructions.push(ix));
    }
    
    tx.message = message.compileToV0Message(addressLookupTableAccounts);
    return tx;
}

export const getFeeToken = (mintAddress: string, type: "buy" | "sell") => {
    return type === "buy"? mintAddress : SOL_ADDRESS;
}

export const getQuote = async(mintAddress: string, amount: number, slippageBps: number, type: "buy" | "sell") => {
    try {
        if(amount === 0) {
            return;
        }

        let inToken = type === "buy"? SOL_ADDRESS : mintAddress;
        let outToken = type === "buy"? mintAddress : SOL_ADDRESS;
        // let url = `https://quote-api.jup.ag/v6/quote?inputMint=${inToken}&outputMint=${outToken}&amount=${amount}&swapMode=ExactIn&slippageBps=${slippageBps}&platformFeeBps=${PLATFORM_FEE}`;
        let url = `https://quote-api.jup.ag/v6/quote?inputMint=${inToken}&outputMint=${outToken}&amount=${amount}&swapMode=ExactIn&slippageBps=${slippageBps}`;
        return (await axios.get(url)).data;
    }

    catch {
        return;
    }
}

// quote response = response from jupiter
export const swap = async(keypair: Keypair, mintAddress: string, amount: number, slippageBps: number, type: "buy" | "sell") => {
    const connection = new Connection(await getRPCEndpoint(), "confirmed");

    // const feeToken = getFeeToken(mintAddress, type);

    // // get associated account
    // let feeATA = await getAssociatedTokenAddress(new PublicKey(feeToken), referralAccountPubkey, true);

    // let mintData = await getUserTokens(referralAccountPubkey);
    // if(!mintData[feeToken]) {

    //     let txRes = await axios.post(`http://localhost:8081/api/createJupiterFee`, { mintAddress: feeToken, feePayer: keypair.publicKey.toBase58() });
    //     let createTransaction = txRes.data.tx as string;
    //     let txBuf = Buffer.from(createTransaction, 'base64');
    //     let tx = VersionedTransaction.deserialize(txBuf);
    //     let prioritizedTx = await addPriorityFeeToVersionedTransaction(connection, tx, 700000, 200_000);
    //     const blockHash = await connection.getLatestBlockhash('confirmed');
    //     prioritizedTx.sign([keypair]);
    //     console.log('creating referral token accounts');
    //     const signature = await connection.sendTransaction(tx, { skipPreflight: true });
    //     await connection.confirmTransaction({
    //         blockhash: blockHash.blockhash,
    //         lastValidBlockHeight: blockHash.lastValidBlockHeight,
    //         signature,
    //     });
    //     console.log(`created referral token account: ${signature}`);
    // }

    // // get the feeAccount.
    // const [feeAccount] = PublicKey.findProgramAddressSync(
    //     [
    //         feeATA.toBuffer(),
    //         referralAccountPubkey.toBuffer(), // your referral account public key
    //         new PublicKey(feeToken).toBuffer(), // the token mint, output mint for ExactIn, input mint for ExactOut.
    //     ],
    //     referralProgramPubKey // the Referral Program
    // );

    // console.log({feeATA: feeATA.toBase58()});
    // console.log({feeAccount: feeAccount.toBase58()});
    // console.log({feeToken});

    while(true) {
        try {
            let quoteResponse = await getQuote(mintAddress, amount, slippageBps, type);
            if(!quoteResponse) {
                throw Error("Unable to get quote");
            }
            
            // let priorityFee = Math.ceil(0.003 * SOL_DECIMALS);
            const transactions = await (
                await fetch('https://quote-api.jup.ag/v6/swap', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    // quoteResponse from /quote api
                    quoteResponse,
                    // destinationTokenAccount: associatedTokenTo.toString(),
                    userPublicKey: keypair.publicKey.toString(),
                    // feeAccount,
                    dynamicComputeUnitLimit: true, // allow dynamic compute limit instead of max 1,400,000
                    // custom priority fee
                    // prioritizationFeeLamports: priorityFee
                    prioritizationFeeLamports: 'auto' 
                  })
                })
            ).json();
            
            const { swapTransaction } = transactions;
            let txBuf = Buffer.from(swapTransaction, 'base64');
            let tx = VersionedTransaction.deserialize(txBuf);
            const blockHash = await connection.getLatestBlockhash('confirmed');
            let solFee = Math.ceil((type === "buy"? quoteResponse.inAmount : quoteResponse.outAmount) * PLATFORM_FEE * (1 - JUPITER_FEE)/ 10000); 
            let jupiterFee = Math.ceil((type === "buy"? quoteResponse.inAmount : quoteResponse.outAmount) * PLATFORM_FEE * JUPITER_FEE / 10000); 
        
            // platform fee
            let transferIx = SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(feeCollector),
                lamports: solFee,
            });
        
            // jupiter's share
            let jupiterTransferIx = SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(jupiterFeeCollector),
                lamports: jupiterFee,
            });
        
            let memoIx =  new TransactionInstruction({
                keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
                data: Buffer.from("Scarlet", "utf-8"),
                programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
            });
        
            let prioritizedTx = await addAdditionalIxsToVersionedTransaction(connection, tx, [transferIx, jupiterTransferIx, memoIx]);
            prioritizedTx.sign([keypair]);
        
            // tx.sign([keypair]);
            const signature = await connection.sendTransaction(prioritizedTx);
            let res = await connection.confirmTransaction({
                blockhash: blockHash.blockhash,
                lastValidBlockHeight: blockHash.lastValidBlockHeight,
                signature,
            });
        
            return {signature, hasError: !!res.value.err};
        }

        catch(e: any) {
            if(e.message.includes("Transaction simulation failed")) {
                // delay
                console.log('transaction simulation error');
                await sleep(100);
                continue;
            }

            console.log('not simulation error');
            console.log(e.message);
            return {signature: "", hasError: true};
        }
    }
}