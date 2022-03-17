const { getWeb3 } = require('./getWeb3');
const { getContractABI } = require('./getContractJson');

function getVeiZi(address) {
    const path = __dirname + '/../../artifacts/contracts/veiZi.sol/veiZi.json';
    const veiZiABI = getContractABI(path);
    const web3 = getWeb3();

    const veiZi = new web3.eth.Contract(veiZiABI, address);
    return veiZi;
}

/*

        // amount of token locked
        int256 amount;
        // end block
        uint256 end;
*/

async function getNftLocked(web3, veiZi, nftIds) {
    const nftNum = nftIds.length;
    params = [{
        type: 'int256',
        name: 'amount'
    },{
        type: 'uint256',
        name: 'end'
    }];
    const result = [];
    for (let i = 0; i < nftNum; i += 100) {
        const boundary = Math.min(nftNum, i + 100);
        const tokenIdMulticallData = [];
        for (let j = i; j < boundary; j ++) {
            tokenIdMulticallData.push(veiZi.methods.nftLocked(nftIds[j]).encodeABI());
        }
        const response = await veiZi.methods.multicall(tokenIdMulticallData).call();
        for (const nftResponse of response) {
            const res = web3.eth.abi.decodeParameters(params, nftResponse);
            result.push(res);
        }
    }
    return result;
}

async function getStakedNftOwners(web3, veiZi, nftIds) {
    const nftNum = nftIds.length;
    const ownersResponse = [];
    for (let i = 0; i < nftNum; i += 100) {
        const boundary = Math.min(nftNum, i + 100);
        const multicallData = [];
        for (let j = i; j < boundary; j ++) {
            multicallData.push(veiZi.methods.stakedNftOwners(nftIds[j]).encodeABI());
        }
        const res = await veiZi.methods.multicall(multicallData).call();
        ownersResponse.push(...res);
    }
    owners = [];
    for (let i = 0; i < ownersResponse.length; i ++) {
      const res = ownersResponse[i];
      const decode = web3.eth.abi.decodeParameter('address', res);
      owners.push(decode);
    }
    return owners;
}

async function getNftOwners(web3, veiZi, nftIds) {
    const nftNum = nftIds.length;
    const ownersResponse = [];
    for (let i = 0; i < nftNum; i += 100) {
        const boundary = Math.min(nftNum, i + 100);
        const multicallData = [];
        for (let j = i; j < boundary; j ++) {
            multicallData.push(veiZi.methods.ownerOf(nftIds[j]).encodeABI());
        }
        const res = await veiZi.methods.multicall(multicallData).call();
        ownersResponse.push(...res);
    }
    owners = [];
    for (let i = 0; i < ownersResponse.length; i ++) {
      const res = ownersResponse[i];
      const decode = web3.eth.abi.decodeParameter('address', res);
      owners.push(decode);
    }
    return owners;
}

/*

    struct StakingStatus {
        uint256 stakingId;
        uint256 lockAmount;
        uint256 lastVeiZi;
        uint256 lastTouchBlock;
        uint256 lastTouchAccRewardPerShare;
    }
*/
async function getStakingStatus(web3, veiZi, nftIds) {
    const nftNum = nftIds.length;
    params = [{
        type: 'uint256',
        name: 'stakingId'
    },{
        type: 'uint256',
        name: 'lockAmount'
    },{
        type: 'uint256',
        name: 'lastVeiZi'
    },{
        type: 'uint256',
        name: 'lastTouchBlock'
    },{
        type: 'uint256',
        name: 'lastTouchAccRewardPerShare'
    }
    ];
    const result = [];
    for (let i = 0; i < nftNum; i += 100) {
        const boundary = Math.min(nftNum, i + 100);
        const tokenIdMulticallData = [];
        for (let j = i; j < boundary; j ++) {
            tokenIdMulticallData.push(veiZi.methods.stakingStatus(nftIds[j]).encodeABI());
        }
        const response = await veiZi.methods.multicall(tokenIdMulticallData).call();
        for (const nftResponse of response) {
            const res = web3.eth.abi.decodeParameters(params, nftResponse);
            result.push(res);
        }
    }
    return result;
}

module.exports = {getVeiZi, getNftLocked, getStakedNftOwners, getNftOwners, getStakingStatus};
