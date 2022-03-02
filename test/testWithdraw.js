
const { BigNumber } = require("bignumber.js");
const { expect } = require("chai");
const hardhat = require('hardhat');
const { ethers } = require("hardhat");;

async function getToken() {

  // deploy token
  const tokenFactory = await ethers.getContractFactory("TestToken")
  token = await tokenFactory.deploy('a', 'a', 18);
  await token.deployed();
  return token;
}

function decimalToUnDecimalStr(num) {
    return new BigNumber(num).times(10 ** 18).toFixed(0);
}

describe("test uniswap price oracle", function () {

    var signer, tester;
    var iZi;
    var veiZi;

    beforeEach(async function() {
      
        [signer, tester] = await ethers.getSigners();

        // a fake weth
        const tokenFactory = await ethers.getContractFactory("TestToken");
        iZi = await tokenFactory.deploy('iZi', 'iZi', 18);

        
        const veiZiFactory = await ethers.getContractFactory("veiZi");
        veiZi = await veiZiFactory.deploy(iZi.address, {
            provider: signer.address,
            accRewardPerShare: 0,
            rewardPerBlock: '100000000000000000',
            lastTouchBlock: 0,
            startBlock: 0,
            endBlock: 1000
        });

        await iZi.connect(tester).approve(veiZi.address, decimalToUnDecimalStr(100000000));
        await iZi.mint(tester.address, decimalToUnDecimalStr(100000000));
        
    });
    
    it("merge", async function () {
        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());
        console.log('max time: ', MAXTIME);
        console.log('week time: ', WEEK);
        const blockNumStart = await ethers.provider.getBlockNumber();
        const blockStart = await ethers.provider.getBlock(blockNumStart);
        let timestampStart = blockStart.timestamp;
        if (timestampStart % WEEK !== 0) {
            timestampStart = timestampStart - timestampStart % WEEK + WEEK;
        }
        
        const unlockTime1 = timestampStart + Math.floor(WEEK * 15);
        const iZiAmount1 = decimalToUnDecimalStr(1000);
        await veiZi.connect(tester).createLock(iZiAmount1, unlockTime1);

        const unlockTime2 = timestampStart + Math.floor(WEEK * 30);
        const iZiAmount2 = decimalToUnDecimalStr(600);
        await veiZi.connect(tester).createLock(iZiAmount2, unlockTime2)

        const unlockTime3 = timestampStart + Math.floor(WEEK * 20);
        const iZiAmount3 = decimalToUnDecimalStr(1500);
        await veiZi.connect(tester).createLock(iZiAmount3, unlockTime3);

        const unlockTime4 = timestampStart + Math.floor(WEEK * 3);
        const iZiAmount4 = decimalToUnDecimalStr(800);
        await veiZi.connect(tester).createLock(iZiAmount4, unlockTime4);

        const unlockTime5 = timestampStart + Math.floor(WEEK * 2);
        const iZiAmount5 = decimalToUnDecimalStr(1000);
        await veiZi.connect(tester).createLock(iZiAmount5, unlockTime5);

        const totalVeiZi1 = (await veiZi.totalVeiZi(timestampStart + Math.floor(WEEK * 1.9))).toString();

        console.log('total veizi: ', totalVeiZi1);

        const nft5 = await veiZi.nftLocked('5');
        const nft4 = await veiZi.nftLocked('4');
        console.log('nft5: ', nft5);
        console.log('nft4: ', nft4);

        await ethers.provider.send('evm_setNextBlockTimestamp', [unlockTime4]); 
        
        const balanceBeforeWithdraw5 = await iZi.balanceOf(tester.address);
        console.log('beforeWithdraw5: ', balanceBeforeWithdraw5.toString());
        await veiZi.connect(tester).withdraw(5);
        const balanceAfterWithdraw5 = await iZi.balanceOf(tester.address);
        console.log('beforeWithdraw4: ', balanceAfterWithdraw5.toString());

        await veiZi.connect(tester).withdraw(4);
        const balanceAfterWithdraw4 = await iZi.balanceOf(tester.address);

        console.log('afterWithdraw4: ', balanceAfterWithdraw4.toString());

        
    });

});