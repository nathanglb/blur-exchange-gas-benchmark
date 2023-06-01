import { expect } from 'chai';
import { ethers, Wallet, Contract, BigNumber } from 'ethers';

import type { CheckBalances, GenerateOrder } from './exchange';
import { eth, Order } from './exchange';
import { Side, ZERO_ADDRESS } from './exchange/utils';
import { deploy, waitForTx } from '../scripts/web3-utils';

import hre from 'hardhat';
import { MAX_INTEGER } from 'ethereumjs-util';

export function runBenchmarkTests(setupTest: any) {
  return async () => {
    const INVERSE_BASIS_POINT = 10000;
    const price: BigNumber = eth('1');
    const feeRate = 300;

    const MAX_UINT128: BigNumber = BigNumber.from('340282366920938463463374607431768211455');

    let exchange: Contract;
    let executionDelegate: Contract;
    let matchingPolicies: Record<string, Contract>;

    let admin: Wallet;
    let alice: Wallet;
    let bob: Wallet;
    let thirdParty: Wallet;

    let weth: Contract;
    let mockERC721: Contract;
    let mockERC1155: Contract;

    let generateOrder: GenerateOrder;
    let checkBalances: CheckBalances;

    let sell: Order;
    let sellInput: any;
    let buy: Order;
    let buyInput: any;
    let otherOrders: Order[];
    let fee: BigNumber;
    let priceMinusFee: BigNumber;
    let tokenId: number;

    let aliceBalance: BigNumber;
    let aliceBalanceWeth: BigNumber;
    let bobBalance: BigNumber;
    let bobBalanceWeth: BigNumber;
    let feeRecipientBalance: BigNumber;
    let feeRecipientBalanceWeth: BigNumber;

    let paymentAmount: BigNumber;

    const updateBalances = async () => {
      aliceBalance = await alice.getBalance();
      aliceBalanceWeth = await weth.balanceOf(alice.address);
      bobBalance = await bob.getBalance();
      bobBalanceWeth = await weth.balanceOf(bob.address);
      feeRecipientBalance = await admin.provider.getBalance(thirdParty.address);
      feeRecipientBalanceWeth = await weth.balanceOf(thirdParty.address);
    };

    before(async () => {
      ({
        admin,
        alice,
        bob,
        thirdParty,
        weth,
        matchingPolicies,
        mockERC721,
        mockERC1155,
        tokenId,
        exchange,
        executionDelegate,
        generateOrder,
        checkBalances,
      } = await setupTest());
    });

    context("Buy Single Listing", () => {
      let token1: Contract;
      let token2: Contract;
      let token3: Contract;

      let test721_1: Contract;
      let test721_2: Contract;
      let test721_3: Contract;

      let test1155_1: Contract;
      let test1155_2: Contract;
      let test1155_3: Contract;

      let erc20s: Contract[];
      let erc721s: Contract[];
      let erc1155s: Contract[];

      let cal: Wallet;
      let abe: Wallet;

      beforeEach(async () => {
        token1 = await deploy(hre, 'SeaportTestERC20');
        token2 = await deploy(hre, 'SeaportTestERC20');
        token3 = await deploy(hre, 'SeaportTestERC20');

        test721_1 = await deploy(hre, 'SeaportTestERC721');
        test721_2 = await deploy(hre, 'SeaportTestERC721');
        test721_3 = await deploy(hre, 'SeaportTestERC721');

        test1155_1 = await deploy(hre, 'SeaportTestERC1155');
        test1155_2 = await deploy(hre, 'SeaportTestERC1155');
        test1155_3 = await deploy(hre, 'SeaportTestERC1155');

        erc20s = [token1, token2, token3];
        erc721s = [test721_1, test721_2, test721_3];
        erc1155s = [test1155_1, test1155_2, test1155_3];

        cal = admin;
        abe = thirdParty;

        await setApprovals(alice);
        await setApprovals(bob);
        await setApprovals(cal);
        await setApprovals(abe);

        console.log("Alice: ", alice.address);
        console.log("Bob: ", bob.address);
        console.log("Cal: ", cal.address);
        console.log("Abe: ", abe.address);
      });

      async function setApprovals(_owner: any) {
        for (let i = 0; i < erc20s.length; i++) {
          await waitForTx(erc20s[i].connect(_owner).approve(exchange.address, MAX_UINT128));
        }

        for (let i = 0; i < erc721s.length; i++) {
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(exchange.address, true));
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(await exchange.executionDelegate(), true));
        }
      }

      it("Buy Single Listing - No Fees", async () => {
        paymentAmount = ethers.utils.parseEther("10");

        for (let tokenId = 1; tokenId <= 100; tokenId++) {
          await test721_1.mint(alice.address, tokenId);
          
          sell = generateOrder(alice, {
            side: Side.Sell,
            tokenId,
          });

          sell.parameters.paymentToken = ZERO_ADDRESS;
          sell.parameters.collection = test721_1.address;
          sell.parameters.tokenId = tokenId;
          sell.parameters.amount = 1;
          sell.parameters.price = paymentAmount;
          sell.parameters.expirationTime = '340282366920938463463374607431768211455'
          sell.parameters.fees = [];

          buy = generateOrder(bob, { side: Side.Buy, tokenId });
          
          buy.parameters.paymentToken = ZERO_ADDRESS;
          buy.parameters.collection = test721_1.address;
          buy.parameters.tokenId = tokenId;
          buy.parameters.amount = 1;
          buy.parameters.price = paymentAmount;
          buy.parameters.expirationTime = '340282366920938463463374607431768211455'
          buy.parameters.fees = [];

          sellInput = await sell.pack();
          buyInput = await buy.packNoSigs();

          const tx = await waitForTx(
            exchange.connect(bob).execute(sellInput, buyInput, { value: paymentAmount }),
          );
        }
      });

      it("Buy Single Listing - Marketplace Fees", async () => {
        paymentAmount = ethers.utils.parseEther("10");

        for (let tokenId = 1; tokenId <= 100; tokenId++) {
          await test721_1.mint(alice.address, tokenId);
          
          sell = generateOrder(alice, {
            side: Side.Sell,
            tokenId,
          });

          sell.parameters.paymentToken = ZERO_ADDRESS;
          sell.parameters.collection = test721_1.address;
          sell.parameters.tokenId = tokenId;
          sell.parameters.amount = 1;
          sell.parameters.price = paymentAmount;
          sell.parameters.expirationTime = '340282366920938463463374607431768211455'
          sell.parameters.fees = [
            { rate: 500, recipient: cal.address }
          ];

          buy = generateOrder(bob, { side: Side.Buy, tokenId });
          
          buy.parameters.paymentToken = ZERO_ADDRESS;
          buy.parameters.collection = test721_1.address;
          buy.parameters.tokenId = tokenId;
          buy.parameters.amount = 1;
          buy.parameters.price = paymentAmount;
          buy.parameters.expirationTime = '340282366920938463463374607431768211455'
          buy.parameters.fees = [];

          sellInput = await sell.pack();
          buyInput = await buy.packNoSigs();

          const tx = await waitForTx(
            exchange.connect(bob).execute(sellInput, buyInput, { value: paymentAmount }),
          );
        }
      });

      it("Buy Single Listing - Marketplace and Royalty Fees", async () => {
        paymentAmount = ethers.utils.parseEther("10");

        for (let tokenId = 1; tokenId <= 100; tokenId++) {
          await test721_1.mint(alice.address, tokenId);
          
          sell = generateOrder(alice, {
            side: Side.Sell,
            tokenId,
          });

          sell.parameters.paymentToken = ZERO_ADDRESS;
          sell.parameters.collection = test721_1.address;
          sell.parameters.tokenId = tokenId;
          sell.parameters.amount = 1;
          sell.parameters.price = paymentAmount;
          sell.parameters.expirationTime = '340282366920938463463374607431768211455';
          sell.parameters.fees = [
            { rate: 500, recipient: cal.address },
            { rate: 1000, recipient: abe.address }
          ];

          buy = generateOrder(bob, { side: Side.Buy, tokenId });
          
          buy.parameters.paymentToken = ZERO_ADDRESS;
          buy.parameters.collection = test721_1.address;
          buy.parameters.tokenId = tokenId;
          buy.parameters.amount = 1;
          buy.parameters.price = paymentAmount;
          buy.parameters.expirationTime = '340282366920938463463374607431768211455'
          buy.parameters.fees = [];

          sellInput = await sell.pack();
          buyInput = await buy.packNoSigs();

          const tx = await waitForTx(
            exchange.connect(bob).execute(sellInput, buyInput, { value: paymentAmount }),
          );
        }
      });
    });

    context("Buy Bundled Listing", () => {
      let token1: Contract;
      let token2: Contract;
      let token3: Contract;

      let test721_1: Contract;
      let test721_2: Contract;
      let test721_3: Contract;

      let test1155_1: Contract;
      let test1155_2: Contract;
      let test1155_3: Contract;

      let erc20s: Contract[];
      let erc721s: Contract[];
      let erc1155s: Contract[];

      let cal: Wallet;
      let abe: Wallet;

      beforeEach(async () => {
        token1 = await deploy(hre, 'SeaportTestERC20');
        token2 = await deploy(hre, 'SeaportTestERC20');
        token3 = await deploy(hre, 'SeaportTestERC20');

        test721_1 = await deploy(hre, 'SeaportTestERC721');
        test721_2 = await deploy(hre, 'SeaportTestERC721');
        test721_3 = await deploy(hre, 'SeaportTestERC721');

        test1155_1 = await deploy(hre, 'SeaportTestERC1155');
        test1155_2 = await deploy(hre, 'SeaportTestERC1155');
        test1155_3 = await deploy(hre, 'SeaportTestERC1155');

        erc20s = [token1, token2, token3];
        erc721s = [test721_1, test721_2, test721_3];
        erc1155s = [test1155_1, test1155_2, test1155_3];

        cal = admin;
        abe = thirdParty;

        await setApprovals(alice);
        await setApprovals(bob);
        await setApprovals(cal);
        await setApprovals(abe);

        let tx = {
          from: abe.address,
          to: bob.address,
          value: ethers.utils.parseEther("8000"),
          nonce: exchange.provider.getTransactionCount(abe.address, "latest")
        }

        await abe.sendTransaction(tx);

        tx = {
          from: cal.address,
          to: bob.address,
          value: ethers.utils.parseEther("8000"),
          nonce: exchange.provider.getTransactionCount(cal.address, "latest")
        }

        await cal.sendTransaction(tx);

        console.log("Alice: ", alice.address);
        console.log("Bob: ", bob.address);
        console.log("Cal: ", cal.address);
        console.log("Abe: ", abe.address);
      });

      async function setApprovals(_owner: any) {
        for (let i = 0; i < erc20s.length; i++) {
          await waitForTx(erc20s[i].connect(_owner).approve(exchange.address, MAX_UINT128));
        }

        for (let i = 0; i < erc721s.length; i++) {
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(exchange.address, true));
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(await exchange.executionDelegate(), true));
        }
      }

      it("Buy Bundled Listing - No Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(alice.address, tokenId));

            sells.push(generateOrder(alice, {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

      it("Buy Bundled Listing - Marketplace Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(alice.address, tokenId));

            sells.push(generateOrder(alice, {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [
              { rate: 500, recipient: cal.address }
            ];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

      it("Buy Bundled Listing - Marketplace and Royalty Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(alice.address, tokenId));

            sells.push(generateOrder(alice, {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [
              { rate: 500, recipient: cal.address },
              { rate: 1000, recipient: abe.address }
            ];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

    });

    context("Sweep Collection", () => {
      let token1: Contract;
      let token2: Contract;
      let token3: Contract;

      let test721_1: Contract;
      let test721_2: Contract;
      let test721_3: Contract;

      let test1155_1: Contract;
      let test1155_2: Contract;
      let test1155_3: Contract;

      let erc20s: Contract[];
      let erc721s: Contract[];
      let erc1155s: Contract[];

      let cal: Wallet;
      let abe: Wallet;

      beforeEach(async () => {
        token1 = await deploy(hre, 'SeaportTestERC20');
        token2 = await deploy(hre, 'SeaportTestERC20');
        token3 = await deploy(hre, 'SeaportTestERC20');

        test721_1 = await deploy(hre, 'SeaportTestERC721');
        test721_2 = await deploy(hre, 'SeaportTestERC721');
        test721_3 = await deploy(hre, 'SeaportTestERC721');

        test1155_1 = await deploy(hre, 'SeaportTestERC1155');
        test1155_2 = await deploy(hre, 'SeaportTestERC1155');
        test1155_3 = await deploy(hre, 'SeaportTestERC1155');

        erc20s = [token1, token2, token3];
        erc721s = [test721_1, test721_2, test721_3];
        erc1155s = [test1155_1, test1155_2, test1155_3];

        cal = admin;
        abe = thirdParty;

        await setApprovals(alice);
        await setApprovals(bob);
        await setApprovals(cal);
        await setApprovals(abe);

        let tx = {
          from: abe.address,
          to: bob.address,
          value: ethers.utils.parseEther("8000"),
          nonce: exchange.provider.getTransactionCount(abe.address, "latest")
        }

        await abe.sendTransaction(tx);

        tx = {
          from: cal.address,
          to: bob.address,
          value: ethers.utils.parseEther("8000"),
          nonce: exchange.provider.getTransactionCount(cal.address, "latest")
        }

        await cal.sendTransaction(tx);

        console.log("Alice: ", alice.address);
        console.log("Bob: ", bob.address);
        console.log("Cal: ", cal.address);
        console.log("Abe: ", abe.address);
      });

      async function setApprovals(_owner: any) {
        for (let i = 0; i < erc20s.length; i++) {
          await waitForTx(erc20s[i].connect(_owner).approve(exchange.address, MAX_UINT128));
        }

        for (let i = 0; i < erc721s.length; i++) {
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(exchange.address, true));
          await waitForTx(erc721s[i].connect(_owner).setApprovalForAll(await exchange.executionDelegate(), true));
        }
      }

      it("Sweep Collection - No Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        const fakeAddresses: Wallet[] = [];
        for (let i = 0; i < numItemsInBundle; i++) {
          let fakeAddress = Wallet.createRandom({ provider: exchange.provider });
          fakeAddress = fakeAddress.connect(exchange.provider);
          
          await abe.sendTransaction(
            {
              from: abe.address, 
              to: fakeAddress.address, 
              value: ethers.utils.parseUnits('.05', 'ether'),
              nonce: exchange.provider.getTransactionCount(abe.address, "latest")
            });

          await waitForTx(test721_1.connect(fakeAddress).setApprovalForAll(await exchange.executionDelegate(), true));

          fakeAddresses.push(fakeAddress);
        }

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(fakeAddresses[i].address, tokenId));

            sells.push(generateOrder(fakeAddresses[i], {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

      it("Sweep Collection - Marketplace Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        const fakeAddresses: Wallet[] = [];
        for (let i = 0; i < numItemsInBundle; i++) {
          let fakeAddress = Wallet.createRandom({ provider: exchange.provider });
          fakeAddress = fakeAddress.connect(exchange.provider);
          
          await abe.sendTransaction(
            {
              from: abe.address, 
              to: fakeAddress.address, 
              value: ethers.utils.parseUnits('.05', 'ether'),
              nonce: exchange.provider.getTransactionCount(abe.address, "latest")
            });

          await waitForTx(test721_1.connect(fakeAddress).setApprovalForAll(await exchange.executionDelegate(), true));

          fakeAddresses.push(fakeAddress);
        }

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(fakeAddresses[i].address, tokenId));

            sells.push(generateOrder(fakeAddresses[i], {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [
              { rate: 500, recipient: cal.address }
            ];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

      it.only("Sweep Collection - Marketplace and Royalty Fees", async () => {
        const numItemsInBundle: any = 30;
        paymentAmount = ethers.utils.parseEther("10");
        let bundledPaymentAmount: any = paymentAmount.mul(numItemsInBundle);
        let tokenId: any = 0;

        const fakeAddresses: Wallet[] = [];
        for (let i = 0; i < numItemsInBundle; i++) {
          let fakeAddress = Wallet.createRandom({ provider: exchange.provider });
          fakeAddress = fakeAddress.connect(exchange.provider);
          
          await abe.sendTransaction(
            {
              from: abe.address, 
              to: fakeAddress.address, 
              value: ethers.utils.parseUnits('.05', 'ether'),
              nonce: exchange.provider.getTransactionCount(abe.address, "latest")
            });

          await waitForTx(test721_1.connect(fakeAddress).setApprovalForAll(await exchange.executionDelegate(), true));

          fakeAddresses.push(fakeAddress);
        }

        for (let run = 1; run <= 50; run++) {

          let sells: Order[] = [];
          let buys: Order[] = [];
          let executions: any[] = [];
          for (let i = 0; i < numItemsInBundle; i++) {
            tokenId++;
            await waitForTx(test721_1.mint(fakeAddresses[i].address, tokenId));

            sells.push(generateOrder(fakeAddresses[i], {
              side: Side.Sell,
              tokenId,
            }));

            buys.push(generateOrder(bob, { side: Side.Buy, tokenId }));

            sells[i].parameters.paymentToken = ZERO_ADDRESS;
            sells[i].parameters.collection = test721_1.address;
            sells[i].parameters.tokenId = tokenId;
            sells[i].parameters.amount = 1;
            sells[i].parameters.price = paymentAmount;
            sells[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            sells[i].parameters.fees = [
              { rate: 500, recipient: cal.address },
              { rate: 1000, recipient: abe.address }
            ];

            buys[i].parameters.paymentToken = ZERO_ADDRESS;
            buys[i].parameters.collection = test721_1.address;
            buys[i].parameters.tokenId = tokenId;
            buys[i].parameters.amount = 1;
            buys[i].parameters.price = paymentAmount;
            buys[i].parameters.expirationTime = '340282366920938463463374607431768211455'
            buys[i].parameters.fees = [];

            executions.push({
              sell: await sells[i].pack(),
              buy: await buys[i].packNoSigs(),
            });
          }

          const tx = await waitForTx(
            exchange.connect(bob).bulkExecute(executions, { value: bundledPaymentAmount }),
          );
        }
      });

    });
  
  };
}
