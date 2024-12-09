import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { BazaarSolana } from "../target/types/bazaar_solana";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { assert } from "chai";
import { confirmTransaction, createFixedMint } from "./helper";

describe("bazaar-solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BazaarSolana as Program<BazaarSolana>;

  // Test data
  let payerTokenAccount: PublicKey;
  let recipient1: Keypair;
  let recipient2: Keypair;
  let recipient3: Keypair;
  let recipient1TokenAccount: PublicKey;
  let recipient2TokenAccount: PublicKey;
  let recipient3TokenAccount: PublicKey;

  before(async () => {
    // Fund provider wallet
    await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );

    // Create test mint
    const { mint, payer } = await createFixedMint(provider);

    // Create token accounts
    payerTokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      provider.wallet.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Setup recipients
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();
    recipient3 = Keypair.generate();

    // Fund recipients for rent
    await confirmTransaction(
      provider,
      await provider.connection.requestAirdrop(recipient1.publicKey, 1000000000)
    );
    await confirmTransaction(
      provider,
      await provider.connection.requestAirdrop(recipient2.publicKey, 1000000000)
    );
    await confirmTransaction(
      provider,
      await provider.connection.requestAirdrop(recipient3.publicKey, 1000000000)
    );

    // Create recipient token accounts
    recipient1TokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      recipient1.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      recipient1TokenAccount,
      payer.publicKey,
      BigInt("1000000000"),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    recipient2TokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      recipient2.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      recipient2TokenAccount,
      payer.publicKey,
      BigInt("1000000000"),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    recipient3TokenAccount = await createAccount(
      provider.connection,
      payer,
      mint,
      recipient3.publicKey,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      payer,
      mint,
      recipient3TokenAccount,
      payer.publicKey,
      BigInt("1000000000"),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Initialize the program
    await program.methods.initialize().rpc();
  });

  it("Processes a payment to multiple recipients", async () => {
    const orderId = new anchor.BN(1);
    const amounts = [new anchor.BN(200000)];
    const recipients = [recipient2.publicKey];

    await program.methods
      .processPayment(orderId, amounts, recipients)
      .accounts({
        payer: recipient1.publicKey,
        payerTokenAccount: recipient1TokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
      ])
      .signers([recipient1])
      .rpc();

    // Check token balances after transfer
    const payerBalance = await getAccount(
      provider.connection,
      recipient1TokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    const recipientBalance = await getAccount(
      provider.connection,
      recipient2TokenAccount,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    assert.equal(payerBalance.amount.toString(), "999800000"); // 1000000 - 200000
    assert.equal(recipientBalance.amount.toString(), "1000200000"); // 1000000 + 200000
  });

  it("Emits correct payment event data", async () => {
    const orderId = new anchor.BN(8);
    const amounts = [new anchor.BN(300000), new anchor.BN(200000)];
    const recipients = [recipient2.publicKey, recipient3.publicKey];
    
    type PaymentEvent = {
      orderId: anchor.BN;
      amounts: anchor.BN[];
      recipients: PublicKey[];
      timestamp: anchor.BN;
    };

    let listener: number;
    const eventPromise = new Promise<PaymentEvent>((resolve) => {
      listener = program.addEventListener("paymentProcessedEvent", (event, slot) => {
        resolve(event as PaymentEvent);
      });
    });

    // Cleanup listener after we're done
    try {
      // Process the payment
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
          { pubkey: recipient3TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();

      // Wait for and get the event
      const paymentEvent = await eventPromise;
      
      // Verify event data
      assert.ok(paymentEvent, "Event should be emitted");
      assert.ok(paymentEvent.orderId.eq(orderId), "Order ID should match");
      assert.deepEqual(
        paymentEvent.amounts.map(a => a.toString()),
        amounts.map(a => a.toString()),
        "Amounts should match"
      );
      assert.deepEqual(
        paymentEvent.recipients.map(r => r.toBase58()),
        recipients.map(r => r.toBase58()),
        "Recipients should match"
      );
      assert.ok(paymentEvent.timestamp.toNumber() > 0, "Timestamp should be positive");
    } finally {
      program.removeEventListener(listener);
    }
  });

  it("Fails when amounts and recipients length mismatch", async () => {
    try {
      await program.methods
        .processPayment(new anchor.BN(2), [new anchor.BN(200000), new anchor.BN(300000)], [recipient2.publicKey])
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "LengthMismatch");
    }

    try {
      await program.methods
        .processPayment(new anchor.BN(2), [new anchor.BN(200000), new anchor.BN(300000)], [recipient2.publicKey, recipient3.publicKey])
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "LengthMismatch");
    }
  });

  it("Fails when too many recipients are provided", async () => {
    const RECIPIENTS_COUNT = 16;
    const orderId = new anchor.BN(3);
    const amounts = Array(RECIPIENTS_COUNT).fill(new anchor.BN(100000));
    const recipients = Array(RECIPIENTS_COUNT).fill(recipient2.publicKey);

    try {
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(
          Array(RECIPIENTS_COUNT).fill({ pubkey: recipient2TokenAccount, isWritable: true, isSigner: false })
        )
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "TooManyRecipients");
    }
  });

  it("Fails when no recipients are provided", async () => {
    const orderId = new anchor.BN(4);
    const amounts: anchor.BN[] = [];
    const recipients: PublicKey[] = [];

    try {
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([])
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "NoRecipients");
    }
  });

  it("Fails when amount is zero", async () => {
    const orderId = new anchor.BN(5);
    const amounts = [new anchor.BN(0)];
    const recipients = [recipient2.publicKey];

    try {
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "ZeroAmount");
    }
  });

  it("Fails with insufficient remaining accounts", async () => {
    const orderId = new anchor.BN(6);
    const amounts = [new anchor.BN(200000), new anchor.BN(300000)];
    const recipients = [recipient1.publicKey, recipient2.publicKey];

    try {
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          // Only providing one account when two are needed
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();
      assert.fail("Expected error was not thrown");
    } catch (error) {
      assert.include(error.message, "LengthMismatch");
    }
  });

  it('Fails with a different token account for address', async () => {
    const orderId = new anchor.BN(7);
    const amounts = [new anchor.BN(200000), new anchor.BN(300000)];
    const recipients = [recipient2.publicKey, recipient3.publicKey];

    try {
      await program.methods
        .processPayment(orderId, amounts, recipients)
        .accounts({
          payer: recipient1.publicKey,
          payerTokenAccount: recipient1TokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: recipient2TokenAccount, isWritable: true, isSigner: false },
          { pubkey: recipient1TokenAccount, isWritable: true, isSigner: false },
        ])
        .signers([recipient1])
        .rpc();
    } catch (error) {
      assert.include(error.message, "InvalidTokenAccount");
    }
  })

  // it("Tests transaction size limits", async () => {
  //   let maxTestedSize = 0;
  //   const results: { size: number; status: string; error?: string }[] = [];
    
  //   // Try increasing numbers of recipients until transaction fails
  //   for (let size = 1; size <= 30; size++) {
  //     const orderId = new anchor.BN(100 + size);
  //     const amounts = Array(size).fill(new anchor.BN(100000));
  //     const recipients = Array(size).fill(recipient2.publicKey);
      
  //     try {
  //       await program.methods
  //         .processPayment(orderId, amounts, recipients)
  //         .accounts({
  //           payer: recipient1.publicKey,
  //           payerTokenAccount: recipient1TokenAccount,
  //           tokenProgram: TOKEN_2022_PROGRAM_ID,
  //         })
  //         .remainingAccounts(
  //           Array(size).fill({
  //             pubkey: recipient2TokenAccount,
  //             isWritable: true,
  //             isSigner: false,
  //           })
  //         )
  //         .signers([recipient1])
  //         .rpc();
          
  //       maxTestedSize = size;
  //       results.push({ size, status: 'success' });
  //       console.log(`✅ Size ${size}: Transaction successful`);
  //     } catch (error) {
  //       results.push({ size, status: 'failed', error: error.message });
  //       console.log(`❌ Size ${size}: Failed with error:`, error.message);
        

  //       if (error.message.includes("TooManyRecipients") || 
  //           error.message.includes("Transaction too large")) {
  //         break;
  //       }
  //       throw error;
  //     }
  //   }

  //   // Print summary
  //   console.log("\n=== Transaction Size Test Summary ===");
  //   console.log(`Maximum successful size: ${maxTestedSize} recipients`);
  //   console.log(`Current network: ${provider.connection.rpcEndpoint}`);
  //   console.log("\nDetailed results:");
  //   results.forEach(r => {
  //     console.log(`Size ${r.size}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  //   });
  // });
});
