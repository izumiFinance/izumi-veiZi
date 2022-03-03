
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

function getBiasAndSlopeStr(amount, lockTime, MAXTIME) {
    const slope = stringDiv(amount, MAXTIME);
    const bias = stringMul(slope, lockTime);
    return {slope, bias};
}

function getBiasAndSlope(amount, lockTime, MAXTIME) {
    return getBiasAndSlopeStr(String(amount), String(lockTime), String(MAXTIME));
}

async function getNftLocked(veiZi, nftId) {
    const nftLocked = await veiZi.nftLocked(nftId);
    return {amount: Number(nftLocked.amount.toString()), end: Number(nftLocked.end.toString())};
}

async function getPoint(veiZi, epoch) {
    const point = await veiZi.pointHistory(epoch);
    return {bias: point.bias.toString(), slope: point.slope.toString(), timestamp: Number(point.timestamp.toString())};
}

async function waitUntilJustBefore(destBlockNumber) {
    let currentBlockNumber = await ethers.provider.getBlockNumber();
    while (currentBlockNumber < destBlockNumber - 1) {
        await ethers.provider.send('evm_mine');
        currentBlockNumber = await ethers.provider.getBlockNumber();
    }
    return currentBlockNumber;
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

const abi = [
    {
        "inputs": [
            {
            "internalType": "uint256",
            "name": "_value",
            "type": "uint256"
            },
            {
            "internalType": "uint256",
            "name": "_unlockTime",
            "type": "uint256"
            }
        ],
        "name": "createLock",
        "outputs": [
            {
            "internalType": "uint256",
            "name": "nftId",
            "type": "uint256"
            }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
        {
            "internalType": "uint256",
            "name": "nftId",
            "type": "uint256"
        },
        {
            "internalType": "uint256",
            "name": "_unlockTime",
            "type": "uint256"
        }
        ],
        "name": "increaseUnlockTime",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
];

function getNewLockCalling(amount, endTime, veiZiAddress) {
    const veiZi = new web3.eth.Contract(abi, veiZiAddress);
    return veiZi.methods.createLock(amount, endTime).encodeABI();
}

function getIncreaseUnlockTimeCalling(nftId, endTime, veiZiAddress) {
    const veiZi = new web3.eth.Contract(abi, veiZiAddress);
    return veiZi.methods.increaseUnlockTime(nftId, endTime).encodeABI();
}

describe("test increase unlock time", function () {

    var signer, tester;
    var iZi;
    var veiZi;

    var locks;

    var timestampStart;

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

        await iZi.connect(tester).approve(veiZi.address, '100000000000000000000');
        await iZi.mint(tester.address, '100000000000000000000');

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());

        locks = [
            getLockData(20, MAXTIME, Math.round(1.1 * WEEK), 20 * WEEK),
            getLockData(6, MAXTIME, Math.round(1.1 * WEEK), 17 * WEEK),
            getLockData(15, MAXTIME, Math.round(1.1 * WEEK), 25 * WEEK),

            getLockData(5, MAXTIME, Math.round(2.3 * WEEK), 20 * WEEK),
            getLockData(21, MAXTIME, Math.round(2.3 * WEEK), 16 * WEEK),

            getLockData(36, MAXTIME, Math.round(5.6 * WEEK), 25 * WEEK),
            getLockData(12, MAXTIME, Math.round(5.6 * WEEK), 16 * WEEK),
            getLockData(16, MAXTIME, Math.round(5.6 * WEEK), 21 * WEEK),
        ]

        const blockNumStart = await ethers.provider.getBlockNumber();
        const blockStart = await ethers.provider.getBlock(blockNumStart);
        timestampStart = blockStart.timestamp;
        if (timestampStart % WEEK !== 0) {
            timestampStart = timestampStart - timestampStart % WEEK + WEEK;
        }

        for (const lock of locks) {
            lock.endTime += timestampStart;
            lock.startTime += timestampStart;
        }
        
        const startTime1 = timestampStart + Math.round(1.1 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime1]); 
        const createLockCallings1 = [
            getNewLockCalling(locks[0].amount, locks[0].endTime),
            getNewLockCalling(locks[1].amount, locks[1].endTime),
            getNewLockCalling(locks[2].amount, locks[2].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings1);

        const startTime2 = timestampStart + Math.round(2.3 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime2]);
        const createLockCallings2 = [
            getNewLockCalling(locks[3].amount, locks[3].endTime),
            getNewLockCalling(locks[4].amount, locks[4].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings2);

        
    });
    
    it("at 20 WEEK, create a new lock, increase and expired lock to 21 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);


        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 21 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 21 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 20 WEEK, create a new lock, increase and expired lock to 23 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 23 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 23 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 20 WEEK, create a new lock, increase an expired lock to 25 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 25 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 25 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });


    it("at 20 WEEK, create a new lock, increase an expired lock to 25 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 25 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 25 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });
    it("at 20 WEEK, create a new lock, increase an expired lock to 26 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 26 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 26 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });
    it("at 20 WEEK, create a new lock, increase an expired lock to 30 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 30 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 30 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });
    it("at 20 WEEK, create a new lock, increase an expired lock to 32 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(2, timestampStart + 32 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[1].endTime = timestampStart + 32 * WEEK;
        locks[1].bias = (locks[1].endTime - locks[1].startTime) * locks[1].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 20 WEEK, create a new lock, increase an just-expired lock(nftId: 1) to 29 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(1, timestampStart + 29 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[0].endTime = timestampStart + 29 * WEEK;
        locks[0].bias = (locks[0].endTime - locks[0].startTime) * locks[0].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 20 WEEK, create a new lock, increase an unexpired lock to 31 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);
        

        locks.push(getLockData(7, MAXTIME, Math.round(20 * WEEK), 30 * WEEK));
        locks[8].startTime += timestampStart;
        locks[8].endTime += timestampStart;

        const startTime = timestampStart + Math.round(20 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const callings = [
            getNewLockCalling(locks[8].amount, locks[8].endTime),
            getIncreaseUnlockTimeCalling(6, timestampStart + 31 * WEEK)
        ];
        await veiZi.connect(tester).multicall(callings);

        locks[5].endTime = timestampStart + 31 * WEEK;
        locks[5].bias = (locks[5].endTime - locks[5].startTime) * locks[5].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 21; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 5.6 WEEK, increase a lock to 20 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
            getIncreaseUnlockTimeCalling(7, timestampStart + 20 * WEEK),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);

        locks[6].endTime = timestampStart + 20 * WEEK;
        locks[6].bias = (locks[6].endTime - locks[6].startTime) * locks[6].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 7; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 8.1 WEEK, increase a lock to 23 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);

        const startTime = timestampStart + Math.round(8.1 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        await veiZi.connect(tester).increaseUnlockTime(7, timestampStart + 23 * WEEK)

        locks[6].endTime = timestampStart + 23 * WEEK;
        locks[6].bias = (locks[6].endTime - locks[6].startTime) * locks[6].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 9; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });


    it("at 16 WEEK, increase a lock(nftId:1) to 30 WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);

        const startTime = timestampStart + Math.round(16 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        await veiZi.connect(tester).increaseUnlockTime(1, timestampStart + 30 * WEEK)

        locks[0].endTime = timestampStart + 30 * WEEK;
        locks[0].bias = (locks[0].endTime - locks[0].startTime) * locks[0].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 17; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });

    it("at 16.5 WEEK, increase a lock(nftId:7) to 26.5(actually 26) WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);

        const startTime = timestampStart + Math.round(16.5 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        // 26.5
        await veiZi.connect(tester).increaseUnlockTime(7, timestampStart + 26 * WEEK + Math.round(WEEK / 2))

        locks[6].endTime = timestampStart + 26 * WEEK;
        locks[6].bias = (locks[6].endTime - locks[6].startTime) * locks[6].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 17; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });


    it("at 19.5 WEEK, increase a lock(nftId:7) to 26.2(actualy 26) WEEK", async function () {

        const MAXTIME = Number((await veiZi.MAXTIME()).toString());
        const WEEK = Number((await veiZi.WEEK()).toString());


        const startTime3 = timestampStart + Math.round(5.6 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime3]);
        const createLockCallings3 = [
            getNewLockCalling(locks[5].amount, locks[5].endTime),
            getNewLockCalling(locks[6].amount, locks[6].endTime),
            getNewLockCalling(locks[7].amount, locks[7].endTime),
        ];
        await veiZi.connect(tester).multicall(createLockCallings3);

        const startTime = timestampStart + Math.round(19.5 * WEEK);
        await ethers.provider.send('evm_setNextBlockTimestamp', [startTime]);
        // 26.2
        await veiZi.connect(tester).increaseUnlockTime(7, timestampStart + 26 * WEEK + Math.round(0.2 * WEEK))

        locks[6].endTime = timestampStart + 26 * WEEK;
        locks[6].bias = (locks[6].endTime - locks[6].startTime) * locks[6].slope;

        const {bias, slope, slopeChanges} = getLastPointAndSlopeChanges(locks, startTime);
        const epoch = await veiZi.epoch();

        const point = await veiZi.pointHistory(epoch);
        expect(point.bias.toString()).to.equal(BigNumber(bias).toFixed(0));
        expect(point.slope.toString()).to.equal(BigNumber(slope).toFixed(0));
        expect(point.timestamp.toString()).to.equal(BigNumber(startTime).toFixed(0));

        for (var week = 20; week <= 35; week ++) {
            const checkTime1 = timestampStart + week * WEEK - Math.round(WEEK / 2);
            const sc1 = (await veiZi.slopeChanges(checkTime1)).toString();
            expect(sc1).to.equal('0');

            const checkTime2 = timestampStart + week * WEEK;
            const sc2 = (await veiZi.slopeChanges(checkTime2)).toString();
            let slopeChangeValue = slopeChanges[checkTime2];
            if (slopeChangeValue == undefined) {
                slopeChangeValue = 0;
            }
            const sc2Expect = String(slopeChangeValue);
            expect(sc2).to.equal(sc2Expect);
        }
    });
});