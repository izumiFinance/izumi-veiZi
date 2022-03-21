var Web3 = require('web3');
const secret = require('../../.secret.js')
const BigNumber = require('bignumber.js')
var pk = secret.pk;

const hardhat = require("hardhat");

const deployed = require("../deployed.js");
const config = require('../../hardhat.config.js');
const veiZiLib = require("../libraries/veiZi.js");
const path = require('path');
const { string } = require('hardhat/internal/core/params/argumentTypes');

const v = process.argv
const net = process.env.HARDHAT_NETWORK

const rpc = config.networks[net].url

var web3 = new Web3(new Web3.providers.HttpProvider(rpc));

const gasPrice = 16000000000;

// Example: HARDHAT_NETWORK='izumiTest' node mint.js ${PATH_TO_INPUT_LIST} ${PATH_TO_OUTPUTR_LIST} 18
console.log(v);
console.log(v[4]);
const para = {
    inputPath: v[2],
    outputPath: v[3],
    decimal: Number(v[4]),
}
console.log(para);

function getMintList(path, decimal) {
    const fs = require('fs');
    let rawdata = fs.readFileSync(path);
    let data = rawdata.toString().split('\n');
    data = data.map(
        (r)=> {
            l = r.split(' ');
            return {
                address: l[0],
                amountDecimal: l[1],
                amount: BigNumber(l[1]).times(10 ** decimal).toFixed(0, 3),
                endTime: l[2],
            }
        }
    );
    // console.log(data);
    return data;
}

function isInt(d) {
    if (d.length === 0) {
        return false;
    }
    for (let i = 0; i < d.length; i ++) {
        if (d[i] < '0' || d[i] > '9') {
            return false;
        }
    }
    return true;
}

function getNftList(path) {
    const fs = require('fs');
    let rawdata = fs.readFileSync(path);
    const rawDataString = rawdata.toString();
    let data = rawDataString.split('\n');
    const idList = [];
    for (let i = 0; i < data.length; i ++) {
        if (isInt(data[i])) {
            idList.push(Number(data[i]))
        }
    }
    return idList;
}

function getMintCalling(veiZi, amount, endTime) {
    return veiZi.methods.createLock(amount, endTime).encodeABI();
}

function getTransferCalling(veiZi, nftId, fromAddress, toAddress) {
    return veiZi.methods.safeTransferFrom(fromAddress, toAddress)
}
//mint uniswap v3 nft
async function main() {

    const [deployer] = await hardhat.ethers.getSigners();
    console.log('inputPath: ', para.inputPath);
    console.log('outputPath: ', para.outputPath);
    console.log('decimal: ', para.decimal);

    const mintList = getMintList(para.inputPath, para.decimal);
    const nftList = getNftList(para.outputPath);

    var originSendAddrNum = 0;

    const veiZiAddress = deployed[net].veiZi;
    const veiZi = veiZiLib.getVeiZi(veiZiAddress)

    console.log('veiZi addr: ', veiZiAddress);

    const mintListLen = mintList.length;
    const mintDelta = 30;
    let sendNumThisTime = 0;
    // var nonce = 42;
    for (let mintListStart = originSendAddrNum; mintListStart < mintListLen; mintListStart += mintDelta) {

        const t1 = new Date().getTime();
        const mintListEnd = Math.min(mintListStart + mintDelta, mintListLen);

        // first, mint
        const mintCallings = [];
        const mintSubList = mintList.slice(mintListStart, mintListEnd);
        console.log('mint sub list:' , mintSubList);
        for (let idx = 0; idx < mintSubList.length; idx ++) {
            const amount = mintSubList[idx].amount;
            const endTime = mintSubList[idx].endTime;
            const mintCalling = getMintCalling(veiZi, amount, endTime);
            mintCallings.push(mintCalling);
        }
        console.log('mintCallings: ', mintCallings);

        const txData = veiZi.methods.multicall(mintCallings).encodeABI()
        const gas = await veiZi.methods.multicall(mintCallings).estimateGas({from: deployer.address});
        // console.log('tx data: ', txData);
        console.log('gas: ', gas);
        const gasLimit = BigNumber(gas * 1.1).toFixed(0, 2);
        console.log('gasLimit: ', gasLimit);
        const signedTx = await web3.eth.accounts.signTransaction(
            {
                // nonce: nonce,
                to: veiZiAddress,
                data:txData,
                gas: gasLimit,
                gasPrice: gasPrice,
            }, 
            pk
        );
        // nonce += 1;

        const txSent = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        console.log('txSent: ', txSent);

        const tx = await web3.eth.getTransaction(txSent.transactionHash);
        console.log('tx: ', tx);
        const ret = await web3.eth.call(tx, tx.blockNumber-1);
        console.log('ret: ', ret);

        sendNumThisTime += mintSubList.length;
        console.log('send num: ', originSendAddrNum + sendNumThisTime);

        const decodeArray = web3.eth.abi.decodeParameter('bytes[]', ret);
        
        for (let idx = 0; idx < decodeArray.length; idx ++){
            const item = decodeArray[idx];
            const nftId = web3.eth.abi.decodeParameter('uint256', item);
            nftList.push(nftId);
        }
        const t2 = new Date().getTime();
        const interval = t2 - t1;
        console.log('interval: ', interval);
    }
    let outputData = '';
    for (let idx = 0; idx < nftList.length; idx ++) {
        outputData = outputData + String(nftList[idx]) + "\n";
    }
    const fs = require('fs');
    await fs.writeFileSync(para.outputPath, outputData);

}
main().then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
})
