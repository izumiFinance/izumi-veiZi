const {ethers} = require("hardhat");
const hre = require("hardhat");
const contracts = require("./deployed.js");

const net = process.env.HARDHAT_NETWORK
const veiZiAddress = contracts[net].veiZi;

const v = process.argv


// Example: HARDHAT_NETWORK='izumiTest' node viewOwner.js 1

const para = {
    nftid: v[2]
}


//mint uniswap v3 nft
async function main() {

  const VeiZiFactory = await ethers.getContractFactory('VeiZi');
  const veiZi = VeiZiFactory.attach(veiZiAddress);
  console.log(await veiZi.ownerOf(para.nftid));
}
main().then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
})
