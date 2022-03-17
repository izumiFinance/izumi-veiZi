const { ethers } = require("hardhat");
const deployed = require('./deployed.js');
const veiZiLib = require("./libraries/veiZi.js");
const stringOpt = require('./libraries/stringOperations.js');
const {getWeb3} = require('./libraries/getWeb3');
const {getToken} = require('./libraries/getToken');
const BigNumber = require("bignumber.js");

/*

example: 

HARDHAT_NETWORK='ethereum' node scripts/nftStatistics.js output/data.txt

*/

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const para = {
  veiZiAddress : deployed[net]['veiZi'],
  iZiAddress: deployed[net]['iZi'],
  path: v[2]
}

async function main() {
    const currentDate = new Date();
    const currentTimestamp = currentDate.getTime() / 1000;
    const MAX_TIME = String((4 * 365 + 1) * 24 * 3600);
    const iZi = getToken(para.iZiAddress);
    const decimals = Number(await iZi.methods.decimals().call());
    console.log('iZi decimals: ', decimals);
    console.log('veiZi address: ', para.veiZiAddress);
    const veiZiContract = veiZiLib.getVeiZi(para.veiZiAddress);
    const nftNum = Number((await veiZiContract.methods.nftNum().call()).toString());
    console.log('nftNum: ', nftNum);
    const nftIds = Array(nftNum).fill().map((_,i)=>i+1);
    console.log('nftids: ', nftIds);
    const web3 = getWeb3();
    const nftLocked = await veiZiLib.getNftLocked(web3, veiZiContract, nftIds);
    const stakedNftOwners = await veiZiLib.getStakedNftOwners(web3, veiZiContract, nftIds);
    const nftOwners = await veiZiLib.getNftOwners(web3, veiZiContract, nftIds);
    const stakingStatus = await veiZiLib.getStakingStatus(web3, veiZiContract, nftIds);
    const nftList = [];
    for (let i = 0; i < nftIds.length; i ++) {
       console.log('i: ', i, ' ', nftOwners[i]);
        if (BigNumber(nftOwners[i]).toFixed(0) === '0') {
            // owner address is 0x0
            continue;
        }
        const nftId = nftIds[i];
        const endTime = nftLocked[i].end.toString();
        const remainTime = String(Math.max(Number(endTime) - currentTimestamp, 0));

        const slope = stringOpt.stringDiv(nftLocked[i].amount.toString(), MAX_TIME);
        const veiZiNoDecimal = stringOpt.stringMul(slope, remainTime);
        const veiZi = BigNumber(veiZiNoDecimal).div(10 ** decimals).toFixed(15);
        const amount = BigNumber(nftLocked[i].amount.toString()).div(10 ** decimals).toFixed(15);

        const staking = stakingStatus[i].stakingId.toString() === '0';

        const owner = staking ? nftOwners[i] : stakedNftOwners[i];

        const nft = {
            nftId, endTime, remainTime, veiZi, amount, owner, staking: staking? 'staking': 'unStaking'
        }
        console.log('nft: ', nft);

        nftList.push(nft);

    }


    let data = '';
    for (const nft of nftList) {
      data = data + String(nft.nftId) + ' ' + String(nft.veiZi) + ' ' + String(nft.amount) + ' ' + String(nft.endTime) + ' ' + String(nft.owner) + ' ' + String(nft.staking) + '\n';
    }
    
    const fs = require('fs');
    await fs.writeFileSync(para.path, data);
}

main().then(() => process.exit(0))
.catch((error) => {
  console.error(error);
  process.exit(1);
})