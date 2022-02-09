
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
            rewardPerBlock: 0,
            lastTouchBlock: 0,
            startBlock: 0,
            endBlock: 0
        });

        iZi.connect(tester).approve(veiZi.address, '1000000000000000000000000000000');
        iZi.mint(tester.address, '1000000000000000000000000000000');
        
    });
    
    it("simply create lock", async function () {
        let currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('current block number: ', currentBlockNumber);
        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        console.log('max time: ', MAXTIME);

        const unlockTime = currentBlockNumber + MAXTIME;
        const iZiAmount = '100000000';

        await veiZi.connect(tester).createLock(iZiAmount, unlockTime);

        currentBlockNumber = await ethers.provider.getBlockNumber();
        const totalVeiZi = Number((await veiZi.totalVeiZi(currentBlockNumber)).toString());

        console.log('total veizi: ', totalVeiZi);
    });

});