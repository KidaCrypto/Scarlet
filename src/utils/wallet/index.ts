import { PublicKey, Transaction } from "@solana/web3.js";
import { getUserToken2022s, getUserTokens } from "../common";
import { TOKEN_2022_PROGRAM_ID, createCloseAccountInstruction } from "@solana/spl-token";

// close account
export const getCloseEmptyAccountTxs = async(fromAccount: string) => {
    const fromAccountPubkey = new PublicKey(fromAccount);
    const token2022Object = await getUserToken2022s(fromAccountPubkey);
    const tokenObject = await getUserTokens(new PublicKey(fromAccount));

    let tx = new Transaction();

    for(const [mintAddress, { amount, ata }] of Object.entries(token2022Object)) {
        if(amount > 0) {
            continue;
        }
        
        tx.add(
            createCloseAccountInstruction(
                new PublicKey(ata), // to be closed token account
                fromAccountPubkey, // rent's destination
                fromAccountPubkey, // token account authority
                [],
                TOKEN_2022_PROGRAM_ID,
            )
        );
    }
    for(const [mintAddress, { amount, ata }] of Object.entries(tokenObject)) {
        if(amount > 0) {
            continue;
        }

        tx.add(
            createCloseAccountInstruction(
                new PublicKey(ata), // to be closed token account
                fromAccountPubkey, // rent's destination
                fromAccountPubkey, // token account authority
            )
        );
    }

    return tx;
}
