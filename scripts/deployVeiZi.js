const hardhat = require("hardhat");
const contracts = require("./deployed.js");
const BigNumber = require("bignumber.js");

// example
// HARDHAT_NETWORK='izumiTest' \
//     node deployVeiZi.js 14 0xD4D6F030520649c7375c492D37ceb56571f768D0 0.1 18 14
const v = process.argv
const net = process.env.HARDHAT_NETWORK


var para = {
    secondsPerBlock: v[2],
    secondsPerBlockX64: BigNumber(v[2]).times(BigNumber(2).pow(64)).toFixed(0, 2),
    rewardProvider: v[3],
    rewardPerBlockDecimal: v[4],
    rewardTokenDecimal: v[5],
    startBlock: v[6],
    endBlock: v[7],
}


async function main() {
    
  const [deployer] = await hardhat.ethers.getSigners();

  const VeiZi = await hardhat.ethers.getContractFactory("VeiZi");

  console.log("Paramters: ");
  for ( var i in para) { console.log("    " + i + ": " + para[i]); }

  console.log("Deploying .....");

  var iZi = contracts[net].iZi;

  console.log('iZi: ', iZi);

  const rewardPerBlockNoDecimal = BigNumber(para.rewardPerBlockDecimal).times(10 ** Number(para.rewardTokenDecimal)).toFixed(0);

  const veiZi = await VeiZi.deploy(
      iZi, para.secondsPerBlockX64, 
      {
        provider: para.rewardProvider,
        accRewardPerShare: 0,
        rewardPerBlock: rewardPerBlockNoDecimal,
        lastTouchBlock: 0,
        startBlock: para.startBlock,
        endBlock: para.endBlock,
      }
  );
  await veiZi.deployed();

  console.log("veiZi2 Contract Address: " , veiZi.address);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });