
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

async function collect(veiZi, iZi, tester) {
    const iZiBalanceBefore = (await iZi.balanceOf(tester.address)).toString();
    await veiZi.connect(tester).collect();
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return stringMinus(iZiBalanceAfter, iZiBalanceBefore);
}

async function unStake(veiZi, iZi, tester) {
    const iZiBalanceBefore = (await iZi.balanceOf(tester.address)).toString();
    await veiZi.connect(tester).unStake();
    const iZiBalanceAfter = (await iZi.balanceOf(tester.address)).toString();
    return stringMinus(iZiBalanceAfter, iZiBalanceBefore);
}

describe("test increase unlock time", function () {

    var signer, tester;
    var iZi;
    var veiZi;

    var timestampStart;
    var rewardPerBlock;

    var q128;

    beforeEach(async function() {
      
        [signer, tester, other, other2] = await ethers.getSigners();

        // a fake weth
        const tokenFactory = await ethers.getContractFactory("TestToken");
        iZi = await tokenFactory.deploy('iZi', 'iZi', 18);

        
        const veiZiFactory = await ethers.getContractFactory("veiZi");
        rewardPerBlock = '1200000000000000';
        veiZi = await veiZiFactory.deploy(iZi.address, {
            provider: signer.address,
            accRewardPerShare: 0,
            rewardPerBlock: rewardPerBlock,
            lastTouchBlock: 0,
            startBlock: 0,
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


    it("stake and collect", async function () {

        const WEEK = Number((await veiZi.WEEK()).toString());
        const MAXTIME = (await veiZi.MAXTIME()).toString();
        let currentBlockNumber = await ethers.provider.getBlockNumber();

        // phase1
        await waitUntilJustBefore(currentBlockNumber + 5);
        const startTime1 = timestampStart + Math.round(WEEK * 5.2);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime1]);

        await veiZi.connect(tester).stake('1');
        const remainTime1_1 = String(timestampStart + WEEK * 35 - startTime1);
        const slope1 = stringDiv('220000000000000000', MAXTIME);
        const stakingStatus1_1 = await getStakingStatus(veiZi, '1');
        const stakeiZiAmount_1 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_1).to.equal('220000000000000000');
        const lastVeiZi1_1 = stringMul(slope1, remainTime1_1);
        expect(lastVeiZi1_1).to.equal(stakingStatus1_1.lastVeiZi);
        const globalAcc1 = '0';
        const reward1_1 ='0';
        const rewardInfo1 = await getRewardInfo(veiZi);
        expect(rewardInfo1.accRewardPerShare).to.equal(globalAcc1);
        expect(stakingStatus1_1.lastTouchAccRewardPerShare).to.equal(globalAcc1);
        expect(stakingStatus1_1.stakingId).to.equal('1');
        expect((await veiZi.stakedNft(tester.address)).toString()).to.equal('1');
        expect((await veiZi.stakedNftOwners('1')).toLowerCase()).to.equal(tester.address.toLowerCase());
        

        // phase2
        await waitUntilJustBefore(currentBlockNumber + 20);
        const startTime2 = timestampStart + Math.round(WEEK * 12.7);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime2]);

        await veiZi.connect(other).stake('2');
        const remainTime2_2 = String(timestampStart + WEEK * 35 - startTime2);
        const slope2 = stringDiv('190000000000000000', MAXTIME);
        const stakingStatus2_2 = await getStakingStatus(veiZi, '2');
        const stakeiZiAmount_2 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_2).to.equal('410000000000000000');
        const lastVeiZi2_2 = stringMul(slope2, remainTime2_2);
        expect(lastVeiZi2_2).to.equal(stakingStatus2_2.lastVeiZi);

        const deltaGlobalAcc2 = stringDiv(stringMul(stringMul(rewardPerBlock, '15'), q128), stakeiZiAmount_1);
        const globalAcc2 = stringAdd(globalAcc1, deltaGlobalAcc2);
        const rewardInfo2 = await getRewardInfo(veiZi);
        expect(rewardInfo2.accRewardPerShare).to.equal(globalAcc2);
        expect(stakingStatus2_2.lastTouchAccRewardPerShare).to.equal(globalAcc2);
        expect(stakingStatus2_2.stakingId).to.equal('2');
        expect((await veiZi.stakedNft(other.address)).toString()).to.equal('2');
        expect((await veiZi.stakedNftOwners('2')).toLowerCase()).to.equal(other.address.toLowerCase());

        // phase3
        await waitUntilJustBefore(currentBlockNumber + 30);
        const startTime3 = timestampStart + Math.round(WEEK * 13.5);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);

        const iZiReward3 = await collect(veiZi, iZi, tester);

        const remainTime1_3 = String(timestampStart + WEEK * 35 - startTime3);
        const stakingStatus1_3 = await getStakingStatus(veiZi, '1');
        const stakeiZiAmount_3 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_3).to.equal('410000000000000000');
        const lastVeiZi1_3 = stringMul(slope1, remainTime1_3);
        expect(lastVeiZi1_3).to.equal(stakingStatus1_3.lastVeiZi);

        const deltaGlobalAcc3 = stringDiv(stringMul(stringMul(rewardPerBlock, '10'), q128), stakeiZiAmount_2);
        const globalAcc3 = stringAdd(globalAcc2, deltaGlobalAcc3);
        expect(iZiReward3).to.equal(stringDiv(stringMul(lastVeiZi1_1, globalAcc3), q128));

        const rewardInfo3 = await getRewardInfo(veiZi);
        expect(rewardInfo3.accRewardPerShare).to.equal(globalAcc3);
        expect(stakingStatus1_3.lastTouchAccRewardPerShare).to.equal(globalAcc3);
        expect(stakingStatus1_3.stakingId).to.equal('1');
        expect((await veiZi.stakedNft(tester.address)).toString()).to.equal('1');
        expect((await veiZi.stakedNftOwners('1')).toLowerCase()).to.equal(tester.address.toLowerCase());


        // phase4
        await waitUntilJustBefore(currentBlockNumber + 32);
        const startTime4 = timestampStart + Math.round(WEEK * 15);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime4]);

        await veiZi.connect(other2).stake('7');
        const remainTime7_4 = String(timestampStart + WEEK * 42 - startTime4);
        const slope7 = stringDiv('370000000000000000', MAXTIME);
        const stakingStatus7_4 = await getStakingStatus(veiZi, '7');
        const stakeiZiAmount_4 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_4).to.equal('780000000000000000');
        const lastVeiZi7_4 = stringMul(slope7, remainTime7_4);
        expect(lastVeiZi7_4).to.equal(stakingStatus7_4.lastVeiZi);

        const deltaGlobalAcc4 = stringDiv(stringMul(stringMul(rewardPerBlock, '2'), q128), stakeiZiAmount_3);
        const globalAcc4 = stringAdd(globalAcc3, deltaGlobalAcc4);
        const rewardInfo4 = await getRewardInfo(veiZi);
        expect(rewardInfo4.accRewardPerShare).to.equal(globalAcc4);
        expect(stakingStatus7_4.lastTouchAccRewardPerShare).to.equal(globalAcc4);
        expect(stakingStatus7_4.stakingId).to.equal('3');
        expect((await veiZi.stakedNft(other2.address)).toString()).to.equal('7');
        expect((await veiZi.stakedNftOwners('7')).toLowerCase()).to.equal(other2.address.toLowerCase());

        // phase5
        await waitUntilJustBefore(currentBlockNumber + 35);
        const startTime5 = timestampStart + Math.round(WEEK * 15.1);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime5]);

        const actualReward2_5 = await unStake(veiZi, iZi, other);
        const stakeiZiAmount_5 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_5).to.equal('590000000000000000');
        const deltaGlobalAcc5 = stringDiv(stringMul(stringMul(rewardPerBlock, '3'), q128), stakeiZiAmount_4);
        const globalAcc5 = stringAdd(globalAcc4, deltaGlobalAcc5);
        const expectReward2_5 = stringDiv(stringMul(stringMinus(globalAcc5, globalAcc2), lastVeiZi2_2), q128);
        expect(actualReward2_5).to.equal(expectReward2_5);
        const rewardInfo5 = await getRewardInfo(veiZi);
        expect(rewardInfo5.accRewardPerShare).to.equal(globalAcc5);
        const stakingStatus2_5 = await getStakingStatus(veiZi, '2');
        // after unStake
        expect(stakingStatus2_5.stakingId).to.equal('0'); 
        expect((await veiZi.stakedNft(other.address)).toString()).to.equal('0');
        expect(BigNumber((await veiZi.stakedNftOwners('2')).toLowerCase()).toFixed(0)).to.equal('0');

        // phase6
        await waitUntilJustBefore(currentBlockNumber + 41);
        const startTime6 = timestampStart + Math.round(WEEK * 16.6);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime6]);

        const iZiReward6 = await collect(veiZi, iZi, tester);

        const remainTime1_6 = String(timestampStart + WEEK * 35 - startTime6);
        const stakingStatus1_6 = await getStakingStatus(veiZi, '1');
        const stakeiZiAmount_6 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_6).to.equal('590000000000000000');
        const lastVeiZi1_6 = stringMul(slope1, remainTime1_6);
        expect(lastVeiZi1_6).to.equal(stakingStatus1_6.lastVeiZi);

        const deltaGlobalAcc6 = stringDiv(stringMul(stringMul(rewardPerBlock, '6'), q128), stakeiZiAmount_5);
        const globalAcc6 = stringAdd(globalAcc5, deltaGlobalAcc6);
        expect(iZiReward6).to.equal(stringDiv(stringMul(lastVeiZi1_3, stringMinus(globalAcc6, globalAcc3)), q128));

        const rewardInfo6 = await getRewardInfo(veiZi);
        expect(rewardInfo6.accRewardPerShare).to.equal(globalAcc6);
        expect(stakingStatus1_6.lastTouchAccRewardPerShare).to.equal(globalAcc6);
        expect(stakingStatus1_6.stakingId).to.equal('1');
        expect((await veiZi.stakedNft(tester.address)).toString()).to.equal('1');
        expect((await veiZi.stakedNftOwners('1')).toLowerCase()).to.equal(tester.address.toLowerCase());

        // phase7
        await waitUntilJustBefore(currentBlockNumber + 42);
        const startTime7 = timestampStart + Math.round(WEEK * 16.7);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime7]);

        const actualReward1_7 = await unStake(veiZi, iZi, tester);
        const stakeiZiAmount_7 = (await veiZi.stakeiZiAmount()).toString();
        expect(stakeiZiAmount_7).to.equal('370000000000000000');
        const deltaGlobalAcc7 = stringDiv(stringMul(stringMul(rewardPerBlock, '1'), q128), stakeiZiAmount_6);
        const globalAcc7 = stringAdd(globalAcc6, deltaGlobalAcc7);
        const expectReward1_7 = stringDiv(stringMul(stringMinus(globalAcc7, globalAcc6), lastVeiZi1_6), q128);
        expect(actualReward1_7).to.equal(expectReward1_7);
        const rewardInfo7 = await getRewardInfo(veiZi);
        expect(rewardInfo7.accRewardPerShare).to.equal(globalAcc7);
        const stakingStatus1_7 = await getStakingStatus(veiZi, '1');
        // after unStake
        expect(stakingStatus1_7.stakingId).to.equal('0'); 
        expect((await veiZi.stakedNft(tester.address)).toString()).to.equal('0');
        expect(BigNumber((await veiZi.stakedNftOwners('1')).toLowerCase()).toFixed(0)).to.equal('0');

    });


});