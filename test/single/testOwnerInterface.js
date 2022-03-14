
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

function stringDiv(a, b) {
    let an = new BigNumber(a);
    an = an.minus(an.mod(b));
    return an.div(b).toFixed(0, 3);
}

function stringMul(a, b) {
    let an = new BigNumber(a);
    an = an.times(b);
    return an.toFixed(0, 3);
}

function stringMinus(a, b) {
    let an = new BigNumber(a);
    an = an.minus(b);
    return an.toFixed(0, 3);
}

function stringAdd(a, b) {
    let an = new BigNumber(a);
    an = an.plus(b);
    return an.toFixed(0, 3);
}


function getLockData(slope, MAXTIME, startTime, endTime) {
    const amount = slope * MAXTIME;
    const bias = slope * (endTime - startTime);
    return {
        slope,
        amount,
        bias,
        startTime,
        endTime,
    };
}

function getLastPointAndSlopeChanges(locks, timestamp) {
    let bias = 0;
    let slope = 0;
    const slopeChanges = {};
    for (const lock of locks) {
        // it is assumed that lock.startTime <= timestamp
        if (lock.endTime > timestamp) {
            bias = bias + lock.bias - (timestamp - lock.startTime) * lock.slope
            slope = slope + lock.slope;
            if (slopeChanges[lock.endTime] == undefined) {
                slopeChanges[lock.endTime] = -lock.slope;
            } else {
                slopeChanges[lock.endTime] -= lock.slope;
            }
        }
    }
    return {bias, slope, slopeChanges};
}

async function waitUntilJustBefore(destBlockNumber) {
    let currentBlockNumber = await ethers.provider.getBlockNumber();
    while (currentBlockNumber < destBlockNumber - 1) {
        await ethers.provider.send('evm_mine');
        currentBlockNumber = await ethers.provider.getBlockNumber();
    }
    return currentBlockNumber;
}

async function getStakingStatus(veiZi, nftId) {
    const stakingStatus = await veiZi.stakingStatus(nftId);
    return {
        stakingId: stakingStatus.stakingId.toString(),
        lockAmount: stakingStatus.lockAmount.toString(),
        lastVeiZi: stakingStatus.lastVeiZi.toString(),
        lastTouchAccRewardPerShare: stakingStatus.lastTouchAccRewardPerShare.toString(),
    };
}

async function getStakingInfo(veiZi, tester) {
    const stakingInfo = await veiZi.stakingInfo(tester.address);
    return {
        stakingId: stakingInfo.stakingId.toString(),
        nftId: stakingInfo.nftId.toString(),
        amount: stakingInfo.amount.toString()
    }
}

async function getRewardInfo(veiZi) {
    const rewardInfo = await veiZi.rewardInfo();
    return {
        provider: rewardInfo.provider,
        accRewardPerShare: rewardInfo.accRewardPerShare.toString(),
        rewardPerBlock: rewardInfo.rewardPerBlock.toString(),
        lastTouchBlock: rewardInfo.lastTouchBlock.toString(),
        startBlock: rewardInfo.startBlock.toString(),
        endBlock: rewardInfo.endBlock.toString()
    }
}

async function tryCollect(veiZi, iZi, tester) {
    const iZiBalanceBefore = (await iZi.balanceOf(tester.address)).toString();
    let ok = true;
    try {
        await veiZi.connect(tester).collect();
    } catch (err) {
        // console.log(err);
        ok = false;
    }
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return {reward: stringMinus(iZiBalanceAfter, iZiBalanceBefore), ok};
}

async function tryUnStake(veiZi, iZi, tester) {
    const iZiBalanceBefore = (await iZi.balanceOf(tester.address)).toString();
    let ok = true;
    try {
    await veiZi.connect(tester).unStake();
    } catch (err) {
        ok = false;
    }
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return {reward: stringMinus(iZiBalanceAfter, iZiBalanceBefore), ok};
}

async function tryModifyEndBlock(veiZi, owner, endBlock) {
    let ok = true;
    try {
        await veiZi.connect(owner).modifyEndBlock(endBlock);
    } catch (err) {
        ok = false;
    }
    return ok;
}

async function tryModifyRewardPerBlock(veiZi, owner, rewardPerBlock) {

    let ok = true;
    try {
        await veiZi.connect(owner).modifyRewardPerBlock(rewardPerBlock);
    } catch (err) {
        ok = false;
    }
    return ok;
}

async function tryModifyStartBlock(veiZi, owner, startBlock) {

    let ok = true;
    try {
        await veiZi.connect(owner).modifyStartBlock(startBlock);
    } catch (err) {
        ok = false;
    }
    return ok;
}

async function tryModifyProvider(veiZi, owner, providerAddress) {

    let ok = true;
    try {
        await veiZi.connect(owner).modifyProvider(providerAddress);
    } catch (err) {
        ok = false;
    }
    return ok;
}

async function waitUntilJustBefore(destBlockNumber) {
    let currentBlockNumber = await ethers.provider.getBlockNumber();
    while (currentBlockNumber < destBlockNumber - 1) {
        await ethers.provider.send('evm_mine');
        currentBlockNumber = await ethers.provider.getBlockNumber();
    }
    return currentBlockNumber;
}

describe("test increase unlock time", function () {

    var signer, tester;
    var iZi;
    var veiZi;

    var timestampStart;
    var rewardPerBlock;

    var q128;

    beforeEach(async function() {
      
        [signer, provider, provider2, provider3, tester, other, other2] = await ethers.getSigners();

        // a fake weth
        const tokenFactory = await ethers.getContractFactory("TestToken");
        iZi = await tokenFactory.deploy('iZi', 'iZi', 18);

        
        const veiZiFactory = await ethers.getContractFactory("veiZi");
        rewardPerBlock = '1200000000000000';
        veiZi = await veiZiFactory.deploy(iZi.address, {
            provider: provider.address,
            accRewardPerShare: 0,
            rewardPerBlock: rewardPerBlock,
            lastTouchBlock: 0,
            startBlock: 200,
            endBlock: 10000
        });

        await iZi.connect(tester).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(tester.address, '100000000000000000000');
        await iZi.connect(other).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(other.address, '100000000000000000000');
        await iZi.connect(other2).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(other2.address, '100000000000000000000');
        await iZi.connect(signer).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(signer.address, '100000000000000000000');

        const WEEK = Number((await veiZi.WEEK()).toString());

    
        const blockNumStart = await ethers.provider.getBlockNumber();
        const blockStart = await ethers.provider.getBlock(blockNumStart);
        timestampStart = blockStart.timestamp;
        if (timestampStart % WEEK !== 0) {
            timestampStart = timestampStart - timestampStart % WEEK + WEEK;
        }

        await veiZi.connect(tester).createLock('220000000000000000', timestampStart + WEEK * 35);
        await veiZi.connect(other).createLock('190000000000000000', timestampStart + WEEK * 35);
        await veiZi.connect(tester).createLock('280000000000000000', timestampStart + WEEK * 30);
        await veiZi.connect(other).createLock('310000000000000000', timestampStart + WEEK * 30);
        await veiZi.connect(other2).createLock('350000000000000000', timestampStart + WEEK * 40);
        await veiZi.connect(other2).createLock('360000000000000000', timestampStart + WEEK * 41);
        await veiZi.connect(other2).createLock('370000000000000000', timestampStart + WEEK * 42);

        q128 = BigNumber(2).pow(128).toFixed(0);
    });


    it("modify endblock", async function () {
        const okSigner = await tryModifyEndBlock(veiZi, signer, '15000');
        const okTester = await tryModifyEndBlock(veiZi, tester, '16000');

        expect(okSigner).to.equal(true);
        expect(okTester).to.equal(false);
        const rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.endBlock).to.equal('15000');
    });

    it("modify rewardPerBlock", async function () {
        const okSigner = await tryModifyRewardPerBlock(veiZi, signer, '2100000000');
        const okTester = await tryModifyRewardPerBlock(veiZi, tester, '3100000000');

        expect(okSigner).to.equal(true);
        expect(okTester).to.equal(false);
        const rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.rewardPerBlock).to.equal('2100000000');
    });
    it("modify startBlock", async function () {
        let rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('200');

        let currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('currentBlockNumber: ', currentBlockNumber);
        const okSigner = await tryModifyStartBlock(veiZi, signer, '199');
        const okTester = await tryModifyStartBlock(veiZi, tester, '198');

        expect(okSigner).to.equal(true);
        expect(okTester).to.equal(false);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('199');
        expect(rewardInfo.lastTouchBlock).to.equal('199');


        const okSigner2 = await tryModifyStartBlock(veiZi, signer, '201');
        expect(okSigner2).to.equal(true);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('201');
        expect(rewardInfo.lastTouchBlock).to.equal('201');


        const okSigner3 = await tryModifyStartBlock(veiZi, signer, '50');
        expect(okSigner3).to.equal(false);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('201');
        expect(rewardInfo.lastTouchBlock).to.equal('201');

        const okSigner4 = await tryModifyStartBlock(veiZi, signer, '20000');
        expect(okSigner4).to.equal(false);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('201');
        expect(rewardInfo.lastTouchBlock).to.equal('201');
    });

    it("modify startBlock after start", async function () {
        let rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('200');

        let currentBlockNumber = await ethers.provider.getBlockNumber();
        console.log('currentBlockNumber: ', currentBlockNumber);

        await waitUntilJustBefore(200)
        const okSigner = await tryModifyStartBlock(veiZi, signer, '300');

        expect(okSigner).to.equal(false);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.startBlock).to.equal('200');
    });


    it("modify provider", async function () {
        let rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.provider.toLowerCase()).to.equal(provider.address.toLowerCase());

        const okSigner = await tryModifyProvider(veiZi, signer, provider2.address);
        const okTester = await tryModifyProvider(veiZi, tester, provider3.address);

        expect(okSigner).to.equal(true);
        expect(okTester).to.equal(false);
        rewardInfo = await getRewardInfo(veiZi);
        expect(rewardInfo.provider.toLowerCase()).to.equal(provider2.address.toLowerCase());
    });

});