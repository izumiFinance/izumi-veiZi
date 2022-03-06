
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
    await veiZi.connect(tester).collect();
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return stringMinus(iZiBalanceAfter, iZiBalanceBefore);
}

async function tryIncreaseUnlockTime(veiZi, iZi, nftId, tester, endTime) {
    const iZiBalanceBefore = (await iZi.balanceOf(tester.address)).toString();
    await veiZi.connect(tester).increaseUnlockTime(nftId, endTime);
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return stringMinus(iZiBalanceAfter, iZiBalanceBefore);
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

async function tryModifyEndBlock(veiZi, owner, endBlock) {

    let ok = true;
    try {
        await veiZi.connect(owner).modifyEndBlock(endBlock);
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
            startBlock: 70,
            endBlock: 10000
        });

        await iZi.connect(tester).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(tester.address, '100000000000000000000');
        await iZi.connect(other).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(other.address, '100000000000000000000');
        await iZi.connect(other2).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(other2.address, '100000000000000000000');
        await iZi.connect(provider).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(provider.address, '100000000000000000000');

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

    it("increase amount", async function () {
        const WEEK = Number((await veiZi.WEEK()).toString());
        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        
        // phase1
        await waitUntilJustBefore(80);
        const startTime1 = timestampStart + Math.round(WEEK * 5.2);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime1]);

        await veiZi.connect(tester).stake('1');
        const remainTime1 = String(timestampStart + WEEK * 35 - startTime1);
        let slope = stringDiv('220000000000000000', MAXTIME);
        const stakingStatus1 = await getStakingStatus(veiZi, '1');
        const stakeiZiAmount = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount).to.equal('220000000000000000');
        const lastVeiZi1 = stringMul(slope, remainTime1);
        expect(lastVeiZi1).to.equal(stakingStatus1.lastVeiZi);
        const globalAcc1 = '0';
        const rewardInfo1 = await getRewardInfo(veiZi);
        expect(rewardInfo1.accRewardPerShare).to.equal(globalAcc1);
        
        // phase2
        await waitUntilJustBefore(90);
        const startTime2 = timestampStart + Math.round(WEEK * 6.1);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime2]);

        const reward2 = await tryCollect(veiZi, iZi, tester);
        const remainTime2 = String(timestampStart + WEEK * 35 - startTime2);
        const stakingStatus2 = await getStakingStatus(veiZi, '1');
        const lastVeiZi2 = stringMul(slope, remainTime2);
        expect(lastVeiZi2).to.equal(stakingStatus2.lastVeiZi);
        const deltaGlobalAcc2 = stringDiv(stringMul(stringMul(rewardPerBlock, '10'), q128), stakeiZiAmount);
        const rewardInfo2 = await getRewardInfo(veiZi);
        console.log('delta globalacc2: ', deltaGlobalAcc2);
        console.log(rewardInfo2.accRewardPerShare);
        expect(reward2).to.equal(stringDiv(stringMul(lastVeiZi1, deltaGlobalAcc2), q128));


        // phase3
        await waitUntilJustBefore(100);
        const startTime3 = timestampStart + Math.round(WEEK * 7.9);
        const newEndTime = timestampStart + Math.round(WEEK * 50);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const reward3 = await tryIncreaseUnlockTime(veiZi, iZi, '1', tester, newEndTime);

        const remainTime3 = String(newEndTime - startTime3);

        const deltaGlobalAcc3 = stringDiv(stringMul(stringMul(rewardPerBlock, '10'), q128), stakeiZiAmount);
        const expectReward3 = stringDiv(stringMul(deltaGlobalAcc3, lastVeiZi2), q128);
        expect(reward3).to.equal(expectReward3);

        const stakingStatus3 = await getStakingStatus(veiZi, '1');
        const lastVeiZi3 = stringMul(slope, remainTime3);
        expect(lastVeiZi3).to.equal(stakingStatus3.lastVeiZi);

        // phase4
        await waitUntilJustBefore(120);
        const startTime4 = timestampStart + Math.round(WEEK * 8);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime4]);
        const reward4 = await tryCollect(veiZi, iZi, tester);

        const remainTime4 = String(newEndTime - startTime4);
        const stakingStatus4 = await getStakingStatus(veiZi, '1');

        const lastVeiZi4 = stringMul(slope, remainTime4);
        expect(lastVeiZi4).to.equal(stakingStatus4.lastVeiZi);
        const deltaGlobalAcc4 = stringDiv(stringMul(stringMul(rewardPerBlock, '20'), q128), stakeiZiAmount);

        const expectReward4 = stringDiv(stringMul(deltaGlobalAcc4, lastVeiZi3), q128);
        expect(reward4).to.equal(expectReward4);


    });

});