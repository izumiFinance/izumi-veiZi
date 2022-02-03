const hardhat = require("hardhat");
const contracts = require("./deployed.js");
const BigNumber = require("bignumber.js");

// example
// HARDHAT_NETWORK='izumiTest' \
//     node deployVeiZi2.js 14
const v = process.argv
const net = process.env.HARDHAT_NETWORK


var para = {
    secondsPerBlock: v[2],
    secondsPerBlockX64: BigNumber(v[2]).times(BigNumber(2).pow(64)).toFixed(0, 2),
}


async function main() {
    
  const [deployer] = await hardhat.ethers.getSigners();

  const VeiZi2 = await hardhat.ethers.getContractFactory("VeiZi2");

  console.log("Paramters: ");
  for ( var i in para) { console.log("    " + i + ": " + para[i]); }

  console.log("Deploying .....");

  var iZi = contracts[net].iZi;

  console.log('iZi: ', iZi);

  const veiZi2 = await VeiZi2.deploy(
      iZi, para.secondsPerBlockX64
  );
  await veiZi2.deployed();

  console.log("veiZi2 Contract Address: " , veiZi2.address);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });