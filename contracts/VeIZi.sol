// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "./libraries/multicall.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';

contract VeIZi is Ownable, Multicall, ReentrancyGuard, ERC721Enumerable {
    using SafeERC20 for IERC20;
    
    struct Point {
        int256 bias;
        int256 slope;
        uint256 blk;
    }

    struct LockedBalance {
        int256 amount;
        uint256 end;
    }

    int128 constant DEPOSIT_FOR_TYPE = 0;
    int128 constant CREATE_LOCK_TYPE = 1;
    int128 constant INCREASE_LOCK_AMOUNT = 2;
    int128 constant INCREASE_UNLOCK_TIME = 3;

    event Deposit(uint256 indexed nftId, uint256 value, uint256 indexed lockBlk, int128 depositType, uint256 blk);
    event Withdraw(uint256 indexed nftId, uint256 value, uint256 blk);
    event Stake(uint256 indexed nftId, address indexed owner);
    event Unstake(uint256 indexed nftId, address indexed owner);
    event Supply(uint256 preSupply, uint256 supply);

    uint256 public WEEK;
    uint256 public MAXTIME;
    uint256 constant MULTIPLIER = 10 ** 18;

    address public token;
    uint256 public supply;

    // mapping(address => LockedBalance) public locked;
    uint256 public nftNum = 0;
    mapping(uint256 => LockedBalance) public nftLocked;

    uint256 constant TOTAL_CURVE = 0;
    uint256 constant STAKE_CURVE = 1;

    uint256[2] public epoch;
    mapping(uint256 => Point)[2] public pointHistory;
    mapping(uint256 => mapping(uint256 => Point)) public nftPointHistory;
    mapping(uint256 => uint256) public nftPointEpoch;
    mapping(uint256 => int256)[2] public slopeChanges;

    uint256 stakeNum = 0; // +1 every calling stake(...)

    struct StakeStatus {
        // (stakeId, owner, LockedBalance.end) can prevent double-spending
        uint256 stakeId; // >=1, unique for every staking
        address owner;
    }

    mapping(uint256 => StakeStatus) public stakeStatus;
    mapping(address => uint256) public stakedNft;

    modifier checkAuth(uint256 nftId, bool allowStaked) {
        bool auth = _isApprovedOrOwner(msg.sender, nftId);
        if (allowStaked) {
            StakeStatus memory status = stakeStatus[nftId];
            auth = auth || (status.owner == msg.sender);
        }
        require(auth, "Not Owner or Not exist!");
        _;
    }

    constructor(address token_addr, uint24 blockPerSecond) ERC721("VeIZi", "VeIZi") {
        token = token_addr;
        pointHistory[TOTAL_CURVE][0].blk = block.number;
        pointHistory[STAKE_CURVE][0].blk = block.number;

        WEEK = 7 * 24 * 3600 / blockPerSecond;
        MAXTIME = 4 * 365 * 3600 / blockPerSecond;
    }

    function getLastNftSlope(uint256 nftId) external view returns(int256) {
        uint256 uepoch = nftPointEpoch[nftId];
        return nftPointHistory[nftId][uepoch].slope;
    }

    struct CheckPointState {
        int256 oldDslope;
        int256 newDslope;
        uint256 _epoch;
    }

    function _checkPoint(uint256 curveType, uint256 nftId, LockedBalance memory oldLocked, LockedBalance memory newLocked) internal {

        Point memory uOld;
        Point memory uNew;
        CheckPointState memory cpState;
        cpState.oldDslope = 0;
        cpState.newDslope = 0;
        cpState._epoch = epoch[curveType];

        if (nftId != 0) {
            if (oldLocked.end > block.number && oldLocked.amount > 0) {
                uOld.slope = oldLocked.amount / int256(MAXTIME);
                uOld.bias = uOld.slope * int256(oldLocked.end - block.number);
            }
            if (newLocked.end > block.number && newLocked.amount > 0) {
                uNew.slope = newLocked.amount / int256(MAXTIME);
                uNew.bias = uNew.slope * int256(newLocked.end - block.number);
            }
            cpState.oldDslope = slopeChanges[curveType][oldLocked.end];
            if (newLocked.end != 0) {
                if (newLocked.end == oldLocked.end) {
                    cpState.newDslope = cpState.oldDslope;
                } else {
                    cpState.newDslope = slopeChanges[curveType][newLocked.end];
                }
            }
        }

        Point memory lastPoint = Point({bias: 0, slope: 0, blk: block.number});
        if (cpState._epoch > 0) {
            lastPoint = pointHistory[curveType][cpState._epoch];
        }
        uint256 lastCheckPoint = lastPoint.blk;

        uint256 ti = (lastCheckPoint / WEEK) * WEEK;
        for (uint24 i = 0; i < 255; i ++) {
            ti += WEEK;
            int256 dSlope = 0;
            if (ti > block.number) {
                ti = block.number;
            } else {
                dSlope = slopeChanges[curveType][ti];
            }
            // ti >= lastCheckPoint
            lastPoint.bias -= lastPoint.slope * int256(ti - lastCheckPoint);
            lastPoint.slope += dSlope;
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
            if (lastPoint.slope < 0) {
                lastPoint.slope = 0;
            }
            lastCheckPoint = ti;
            lastPoint.blk = ti;
            cpState._epoch += 1;

            if (ti == block.number) {
                lastPoint.blk = block.number;
                break;
            } else {
                pointHistory[curveType][cpState._epoch] = lastPoint;
            }
        }

        epoch[curveType] = cpState._epoch;

        if (nftId != 0) {
            lastPoint.slope += (uNew.slope - uOld.slope);
            lastPoint.bias += (uNew.bias - uOld.bias);
            if (lastPoint.slope < 0) {
                lastPoint.slope = 0;
            }
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
        }

        pointHistory[curveType][cpState._epoch] = lastPoint;

        if (nftId != 0) {
            if (oldLocked.end > block.number) {
                cpState.oldDslope += uOld.slope;
                if (newLocked.end == oldLocked.end) {
                    cpState.oldDslope -= uNew.slope;
                }
                slopeChanges[curveType][oldLocked.end] = cpState.oldDslope;
            }
            if (newLocked.end > block.number) {
                if (newLocked.end > oldLocked.end) {
                    cpState.newDslope -= uNew.slope;
                    slopeChanges[curveType][newLocked.end] = cpState.newDslope;
                }
            }

            if (curveType == TOTAL_CURVE) {
                uint256 nftEpoch = nftPointEpoch[nftId] + 1;
                uNew.blk = block.number;
                nftPointHistory[nftId][nftEpoch] = uNew;
            }
        }
        
    }

    function _depositFor(uint256 nftId, uint256 _value, uint256 unlockBlock, LockedBalance memory lockedBalance, int128 depositType) internal {
        
        LockedBalance memory _locked = lockedBalance;
        uint256 supplyBefore = supply;

        supply = supplyBefore + _value;

        LockedBalance memory oldLocked = _locked;
        _locked.amount += int256(_value);

        if (unlockBlock != 0) {
            _locked.end = unlockBlock;
        }
        _checkPoint(TOTAL_CURVE, nftId, oldLocked, _locked);
        nftLocked[nftId] = _locked;
        if (_value != 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), _value);
        }
        emit Deposit(nftId, _value, _locked.end, depositType, block.number);
        emit Supply(supplyBefore, supplyBefore + _value);
    }

    function checkPoint() external {
        _checkPoint(TOTAL_CURVE, 0, LockedBalance({amount: 0, end: 0}), LockedBalance({amount: 0, end: 0}));
        _checkPoint(STAKE_CURVE, 0, LockedBalance({amount: 0, end: 0}), LockedBalance({amount: 0, end: 0}));
    }

    function createLock(uint256 _value, uint256 _unlockTime) external nonReentrant returns(uint256 nftId) {
        uint256 unlockTime = (_unlockTime / WEEK) * WEEK;
        nftNum ++;
        nftId = nftNum; // id starts from 1
        _mint(msg.sender, nftId);
        LockedBalance memory _locked = nftLocked[nftId];
        require(_value > 0, "amount should >0");
        require(_locked.amount == 0, "Withdraw old tokens first");
        require(unlockTime > block.number, "Can only lock until time in the future");
        require(unlockTime <= block.number + MAXTIME, "Voting lock can be 4 years max");
        _depositFor(nftId, _value, unlockTime, _locked, CREATE_LOCK_TYPE);
    }

    function increaseAmount(uint256 nftId, uint256 _value) external nonReentrant {
        LockedBalance memory _locked = nftLocked[nftId];
        require(_value > 0, "amount should >0");
        require(_locked.amount > 0, "No existing lock found");
        require(_locked.end > block.number, "Can only lock until time in the future");
        _depositFor(nftId, _value, 0, _locked, INCREASE_LOCK_AMOUNT);
        if (stakeStatus[nftId].owner != address(0)) {
            // this nft is staking
            _checkPoint(STAKE_CURVE, nftId, _locked, LockedBalance({amount: _locked.amount + int256(_value), end: _locked.end}));
        }
    }

    function increaseUnlockTime(uint256 nftId, uint256 _unlockTime) checkAuth(nftId, true) external nonReentrant {
        LockedBalance memory _locked = nftLocked[nftId];
        uint256 unlockTime = (_unlockTime / WEEK) * WEEK;

        require(_locked.end > block.number, "Lock expired");
        require(_locked.amount > 0, "Nothing is locked");
        require(unlockTime > _locked.end, "Can only lock until time in the future");
        require(unlockTime <= block.number + MAXTIME, "Voting lock can be 4 years max");

        _depositFor(nftId, 0, unlockTime, _locked, INCREASE_UNLOCK_TIME);
        if (stakeStatus[nftId].owner != address(0)) {
            // this nft is staking
            _checkPoint(STAKE_CURVE, nftId, _locked, LockedBalance({amount: _locked.amount, end: unlockTime}));
        }
    }

    function withdraw(uint256 nftId) external checkAuth(nftId, false) nonReentrant {
        LockedBalance memory _locked = nftLocked[nftId];
        require(block.number >= _locked.end, "The lock didn't expire");
        uint256 value = uint256(_locked.amount);

        LockedBalance memory oldLocked = _locked;
        _locked.end = 0;
        _locked.amount  = 0;
        nftLocked[nftId] = _locked;
        uint256 supplyBefore = supply;
        supply = supplyBefore - value;

        _checkPoint(TOTAL_CURVE, nftId, oldLocked, _locked);
        IERC20(token).safeTransfer(msg.sender, value);
        _burn(nftId);

        emit Withdraw(nftId, value, block.number);
        emit Supply(supplyBefore, supplyBefore - value);
    }

    function _findBlockEpoch(uint256 curveType, uint256 _block, uint256 maxEpoch) internal view returns(uint256) {
        uint256 _min = 0;
        uint256 _max = maxEpoch;
        for (uint24 i = 0; i < 128; i ++) {
            if (_min >= _max) {
                break;
            }
            uint256 _mid = (_min + _max + 1) / 2;
            if (pointHistory[curveType][_mid].blk <= _block) {
                _min = _mid;
            } else {
                _max = _mid - 1;
            }
        }
        return _min;
    }

    function nftSupply(uint256 nftId, uint256 blockNumber) public view returns(uint256) {
        uint256 _epoch = nftPointEpoch[nftId];
        if (_epoch == 0) {
            return 0;
        } else {
            Point memory lastPoint = nftPointHistory[nftId][_epoch];
            require(blockNumber >= lastPoint.blk, "Too early");
            lastPoint.bias -= lastPoint.slope * int256(blockNumber - lastPoint.blk);
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
            return uint256(lastPoint.bias);
        }
    }
    
    function stakeAddrSupply(address addr, uint256 blockNumber) external view returns(uint256) {
        uint256 nftId = stakedNft[addr];
        if (nftId == 0) {
            return 0;
        }
        return nftSupply(nftId, blockNumber);
    }

    function nftSupplyAt(uint256 nftId, uint256 _block) public view returns(uint256) {
        require(_block <= block.number, "Block Too Late");

        uint256 _min = 0;
        uint256 _max = nftPointEpoch[nftId];

        for (uint24 i = 0; i < 128; i ++) {
            if (_min >= _max) {
                break;
            }
            uint256 _mid = (_min + _max + 1) / 2;
            if (nftPointHistory[nftId][_mid].blk <= _block) {
                _min = _mid;
            } else {
                _max = _mid - 1;
            }
        }
        Point memory uPoint = nftPointHistory[nftId][_min];
        uPoint.bias -= uPoint.slope * (int256(_block) - int256(uPoint.blk));
        if (uPoint.bias < 0) {
            uPoint.bias = 0;
        }
        return uint256(uPoint.bias);
    }

    function stakeAddrSupplyAt(address addr, uint256 blockNumber) external view returns(uint256) {
        uint256 nftId = stakedNft[addr];
        if (nftId == 0) {
            return 0;
        }
        return nftSupplyAt(nftId, blockNumber);
    }

    function _supplyAt(uint256 curveType, Point memory point, uint256 blk) internal view returns(uint256) {
        Point memory lastPoint = point;
        uint256 ti = (lastPoint.blk / WEEK) * WEEK;
        for (uint24 i = 0; i < 255; i ++) {
            ti += WEEK;
            int256 dSlope = 0;
            if (ti > blk) {
                ti = blk;
            } else {
                dSlope = slopeChanges[curveType][ti];
            }
            lastPoint.bias -= lastPoint.slope * int256(ti - lastPoint.blk);
            if (ti == blk) {
                break;
            }
            lastPoint.slope += dSlope;
            lastPoint.blk = ti;
        }
        if (lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }
        return uint256(lastPoint.bias);
    }

    function totalSupply(uint256 blk) external view returns(uint256) {
        uint256 _epoch = epoch[TOTAL_CURVE];
        Point memory lastPoint = pointHistory[TOTAL_CURVE][_epoch];
        require(blk >= lastPoint.blk, "Too Early");
        return _supplyAt(TOTAL_CURVE, lastPoint, blk);
    }

    function stakeSupply(uint256 blk) external view returns(uint256) {
        uint256 _epoch = epoch[STAKE_CURVE];
        Point memory lastPoint = pointHistory[STAKE_CURVE][_epoch];
        require(blk >= lastPoint.blk, "Too Early");
        return _supplyAt(STAKE_CURVE, lastPoint, blk);
    }

    function totalSupplyAt(uint256 blk) external view returns(uint256) {
        require(blk <= block.number, "Block Too Late");
        uint256 _epoch = epoch[TOTAL_CURVE];
        uint256 targetEpoch = _findBlockEpoch(TOTAL_CURVE, blk, _epoch);

        Point memory point = pointHistory[TOTAL_CURVE][targetEpoch];
        return _supplyAt(TOTAL_CURVE, point, blk);
    }

    function stakeSupplyAt(uint256 blk) external view returns(uint256) {
        require(blk <= block.number, "Block Too Late");
        uint256 _epoch = epoch[STAKE_CURVE];
        uint256 targetEpoch = _findBlockEpoch(STAKE_CURVE, blk, _epoch);

        Point memory point = pointHistory[STAKE_CURVE][targetEpoch];
        return _supplyAt(STAKE_CURVE, point, blk);
    }

    function stake(uint256 nftId) external {
        require(nftLocked[nftId].end > block.number, "Lock expired");
        // nftId starts from 1, zero or not owner(including staked) cannot be transfered
        safeTransferFrom(msg.sender, address(this), nftId);
        require(stakedNft[msg.sender] == 0, "Has Staked!");
        stakedNft[msg.sender] = nftId;

        stakeNum += 1;
        StakeStatus storage status = stakeStatus[nftId];
        // prevent double spending
        status.stakeId = stakeNum;
        status.owner = msg.sender;
        LockedBalance memory locked = nftLocked[nftId];
        // update curve of staking
        _checkPoint(STAKE_CURVE, nftId, LockedBalance({amount: 0, end: 0}), locked);

        emit Stake(nftId, msg.sender);
    }

    function unStake(uint256 nftId) external {
        StakeStatus storage status = stakeStatus[nftId];
        require(status.owner == msg.sender, "Not Owner or Not staking!");
        status.owner = address(0);
        status.stakeId = 0; // not necessary
        stakedNft[msg.sender] = 0;
        // refund nft
        safeTransferFrom(address(this), msg.sender, nftId);

        LockedBalance memory locked = nftLocked[nftId];
        // update curve of staking
        _checkPoint(STAKE_CURVE, nftId, locked, LockedBalance({amount: 0, end: 0}));
        emit Unstake(nftId, msg.sender);
    }

}