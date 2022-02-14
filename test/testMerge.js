
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

        
        const veiZiFactory = await ethers.getContractFactory("VeiZi");
        const secondsPerBlockX64 = BigNumber(14).times(BigNumber(2).pow(64)).toFixed(0);
        veiZi = await veiZiFactory.deploy(iZi.address, secondsPerBlockX64, {
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
        let currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('current block number: ', currentBlockNumber);
        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        currentBlockNumber = await ethers.provider.getBlockNumber();

        const WEEK = Number((await veiZi.WEEK()).toString());
        console.log('max time: ', MAXTIME);
        console.log('week time: ', WEEK);
        
        const unlockTime1 = currentBlockNumber + Math.floor(MAXTIME / 2);
        const iZiAmount1 = decimalToUnDecimalStr(1000);
        await veiZi.connect(tester).createLock(iZiAmount1, unlockTime1);

        const unlockTime2 = currentBlockNumber + MAXTIME;
        const iZiAmount2 = decimalToUnDecimalStr(600);
        await veiZi.connect(tester).createLock(iZiAmount2, unlockTime2)

        const unlockTime3 = currentBlockNumber + Math.floor(MAXTIME / 4);
        const iZiAmount3 = decimalToUnDecimalStr(1500);
        await veiZi.connect(tester).createLock(iZiAmount3, unlockTime3);

        const unlockTime4 = currentBlockNumber + Math.floor(WEEK * 4 * 6);
        const iZiAmount4 = decimalToUnDecimalStr(800);
        await veiZi.connect(tester).createLock(iZiAmount4, unlockTime4);

        const unlockTime5 = currentBlockNumber + Math.floor(WEEK * 4 * 3);
        const iZiAmount5 = decimalToUnDecimalStr(1000);
        await veiZi.connect(tester).createLock(iZiAmount5, unlockTime5);

        currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('current block number: ', currentBlockNumber);
        const totalVeiZi1 = (await veiZi.totalVeiZi(currentBlockNumber)).toString();

        console.log('total veizi: ', totalVeiZi1);


        await veiZi.connect(tester).merge(4, 1);
        currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('current block number: ', currentBlockNumber);
        const totalVeiZi2 = (await veiZi.totalVeiZi(currentBlockNumber)).toString();

        console.log('total veizi: ', totalVeiZi2);



        await veiZi.connect(tester).merge(1, 2);
        currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('current block number: ', currentBlockNumber);
        const totalVeiZi3 = (await veiZi.totalVeiZi(currentBlockNumber)).toString();

        console.log('total veizi: ', totalVeiZi3);

        
    });

});