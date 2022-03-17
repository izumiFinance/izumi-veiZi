const hardhat = require("hardhat");
const contracts = require("./deployed.js");
const BigNumber = require('bignumber.js');

const {getWeb3} = require('./libraries/getWeb3');
const {getContractABI} = require('./libraries/getContractJson');

const secret = require('../.secret.js');
const pk = secret.pk;

const v = process.argv
const net = process.env.HARDHAT_NETWORK


const para = {
    miningPoolAddr: contracts[net]['veiZi'],
    rewardPerBlockDecimal: v[2],
    rewardTokenDecimal: v[3],
    rewardPerBlockNoDecimal: 0
}

const web3 = getWeb3();
const miningABI = getContractABI(__dirname + '/../artifacts/contracts/veiZi.sol/veiZi.json');

async function main() {

  para.rewardPerBlockNoDecimal = BigNumber(Number(para.rewardPerBlockDecimal) * (10 ** para.rewardTokenDecimal)).toFixed(0);

  console.log("Paramters: ");
  for ( var i in para) { console.log("    " + i + ": " + para[i]); }
    
  const mining = new web3.eth.Contract(miningABI, para.miningPoolAddr);

  console.log('addr: ', para.miningPoolAddr);

  const owner = await mining.methods.owner().call();
  console.log('owner: ', owner);
  
  const txData = await mining.methods.modifyRewardPerBlock(para.rewardPerBlockNoDecimal).encodeABI()
  const gasLimit = await mining.methods.modifyRewardPerBlock(para.rewardPerBlockNoDecimal).estimateGas({from: owner});
  console.log('gas limit: ', gasLimit);
  const signedTx = await web3.eth.accounts.signTransaction(
      {
          // nonce: 0,
          to: para.miningPoolAddr,
          data:txData,
          gas: BigNumber(gasLimit * 1.1).toFixed(0, 2),
      }, 
      pk
  );
  // nonce += 1;
  const tx = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
  console.log('tx: ', tx);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
