import * as anchor from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
} from "@solana/spl-token";

export async function createFixedMint(provider: anchor.AnchorProvider) {
    const FIXED_MINT_SEED = "fixed-mint-seed-for-testing";
    const mintKeypair = Keypair.fromSeed(
      Uint8Array.from(Array(32).fill(0).map((_, i) => 
        FIXED_MINT_SEED.charCodeAt(i % FIXED_MINT_SEED.length)
      ))
    );
  
    const payer = Keypair.generate();
    await confirmTransaction(
      provider,
      await provider.connection.requestAirdrop(payer.publicKey, 2000000000)
    );
  
    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6,
      mintKeypair,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  
    return { mint, payer };
  }
  
  export const confirmTransaction = async (
    provider: anchor.AnchorProvider,
    signature: string
  ) => {
    await provider.connection.confirmTransaction({
      signature,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (
        await provider.connection.getLatestBlockhash()
      ).lastValidBlockHeight,
    });
  };