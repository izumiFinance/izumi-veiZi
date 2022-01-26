// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "./libraries/multicall.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';

contract VeIZi2 is Ownable, Multicall, ReentrancyGuard, ERC721Enumerable {
    using SafeERC20 for IERC20;
    
    /// @dev Point of segments
    ///  for each segment, y = bias - (t - blk) * slope
    struct Point {
        int256 bias;
        int256 slope;
        // start of segment
        uint256 blk;
    }

    /// @dev locked info of nft
    struct LockedBalance {
        // amount of token locked
        int256 amount;
        // end block
        uint256 end;
    }

    int128 constant DEPOSIT_FOR_TYPE = 0;
    int128 constant CREATE_LOCK_TYPE = 1;
    int128 constant INCREASE_LOCK_AMOUNT = 2;
    int128 constant INCREASE_UNLOCK_TIME = 3;

    /// @notice emit if user successfully deposit (calling increaseAmount, createLock increaseUnlockTime)
    /// @param nftId id of nft, starts from 1
    /// @param value amount of token locked
    /// @param lockBlk end block
    /// @param depositType createLock / increaseAmount / increaseUnlockTime
    /// @param blk start block
    event Deposit(uint256 indexed nftId, uint256 value, uint256 indexed lockBlk, int128 depositType, uint256 blk);

    /// @notice emit if user successfuly withdraw
    /// @param nftId id of nft, starts from 1
    /// @param value amount of token released
    /// @param blk block number when calling withdraw(...)
    event Withdraw(uint256 indexed nftId, uint256 value, uint256 blk);

    /// @notice emit if user successfully stake an nft
    /// @param nftId id of nft, starts from 1
    /// @param owner address of user
    event Stake(uint256 indexed nftId, address indexed owner);

    /// @notice emit if user unstake a staked nft
    /// @param nftId id of nft, starts from 1
    /// @param owner address of user
    event Unstake(uint256 indexed nftId, address indexed owner);

    /// @notice emit if total amount of locked token changes
    /// @param preSupply total amount before change
    /// @param supply total amount after change
    event Supply(uint256 preSupply, uint256 supply);

    /// @notice number of block in a week (estimated)
    uint256 public WEEK;
    /// @notice number of block during 4 years
    uint256 public MAXTIME;

    /// @notice erc-20 token to lock
    address public token;
    /// @notice total amount of locked token
    uint256 public supply;

    /// @notice num of nft generated
    uint256 public nftNum = 0;

    /// @notice locked info of each nft
    mapping(uint256 => LockedBalance) public nftLocked;

    uint256 public epoch;
    /// @notice weight-curve of total-weight of all nft
    mapping(uint256 => Point) public pointHistory;
    mapping(uint256 => int256) public slopeChanges;

    /// @notice weight-curve of each nft
    mapping(uint256 => mapping(uint256 => Point)) public nftPointHistory;
    mapping(uint256 => uint256) public nftPointEpoch;

    /// @notice total num of nft staked
    uint256 public stakeNum = 0; // +1 every calling stake(...)
    /// @notice total amount of staked iZi
    uint256 public stakeiZiAmount = 0;
    
    /// @notice nftId to stakeId
    mapping(uint256 => uint256) public nft2StakeId;
    /// @notice nftid the user staked, 0 for no staked. each user can stake atmost 1 nft
    mapping(address => uint256) public stakedNft;

    modifier checkAuth(uint256 nftId, bool allowStaked) {
        bool auth = _isApprovedOrOwner(msg.sender, nftId);
        if (allowStaked) {
            auth = auth || (stakedNft[msg.sender] == nftId);
        }
        require(auth, "Not Owner or Not exist!");
        _;
    }

    /// @notice constructor
    /// @param tokenAddr address of locked token
    /// @param blockPerSecond block num per second on the chain
    constructor(address tokenAddr, uint24 blockPerSecond) ERC721("VeIZi", "VeIZi") {
        token = tokenAddr;
        pointHistory[0].blk = block.number;

        WEEK = 7 * 24 * 3600 / blockPerSecond;
        MAXTIME = 4 * 365 * 3600 / blockPerSecond;
    }

    /// @notice get slope of last segment of weight-curve of an nft
    /// @param nftId id of nft, starts from 1
    function getLastNftSlope(uint256 nftId) external view returns(int256) {
        uint256 uepoch = nftPointEpoch[nftId];
        return nftPointHistory[nftId][uepoch].slope;
    }

    struct CheckPointState {
        int256 oldDslope;
        int256 newDslope;
        uint256 _epoch;
    }

    function _checkPoint(uint256 nftId, LockedBalance memory oldLocked, LockedBalance memory newLocked) internal {

        Point memory uOld;
        Point memory uNew;
        CheckPointState memory cpState;
        cpState.oldDslope = 0;
        cpState.newDslope = 0;
        cpState._epoch = epoch;

        if (nftId != 0) {
            if (oldLocked.end > block.number && oldLocked.amount > 0) {
                uOld.slope = oldLocked.amount / int256(MAXTIME);
                uOld.bias = uOld.slope * int256(oldLocked.end - block.number);
            }
            if (newLocked.end > block.number && newLocked.amount > 0) {
                uNew.slope = newLocked.amount / int256(MAXTIME);
                uNew.bias = uNew.slope * int256(newLocked.end - block.number);
            }
            cpState.oldDslope = slopeChanges[oldLocked.end];
            if (newLocked.end != 0) {
                if (newLocked.end == oldLocked.end) {
                    cpState.newDslope = cpState.oldDslope;
                } else {
                    cpState.newDslope = slopeChanges[newLocked.end];
                }
            }
        }

        Point memory lastPoint = Point({bias: 0, slope: 0, blk: block.number});
        if (cpState._epoch > 0) {
            lastPoint = pointHistory[cpState._epoch];
        }
        uint256 lastCheckPoint = lastPoint.blk;

        uint256 ti = (lastCheckPoint / WEEK) * WEEK;
        for (uint24 i = 0; i < 255; i ++) {
            ti += WEEK;
            int256 dSlope = 0;
            if (ti > block.number) {
                ti = block.number;
            } else {
                dSlope = slopeChanges[ti];
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
                pointHistory[cpState._epoch] = lastPoint;
            }
        }

        epoch = cpState._epoch;

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

        pointHistory[cpState._epoch] = lastPoint;

        if (nftId != 0) {
            if (oldLocked.end > block.number) {
                cpState.oldDslope += uOld.slope;
                if (newLocked.end == oldLocked.end) {
                    cpState.oldDslope -= uNew.slope;
                }
                slopeChanges[oldLocked.end] = cpState.oldDslope;
            }
            if (newLocked.end > block.number) {
                if (newLocked.end > oldLocked.end) {
                    cpState.newDslope -= uNew.slope;
                    slopeChanges[newLocked.end] = cpState.newDslope;
                }
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
        _checkPoint(nftId, oldLocked, _locked);
        nftLocked[nftId] = _locked;
        if (_value != 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), _value);
        }
        emit Deposit(nftId, _value, _locked.end, depositType, block.number);
        emit Supply(supplyBefore, supplyBefore + _value);
    }

    /// @notice push check point of two global curves to current block
    function checkPoint() external {
        _checkPoint(0, LockedBalance({amount: 0, end: 0}), LockedBalance({amount: 0, end: 0}));
    }

    /// @notice create a new lock and generate a new nft
    /// @param _value amount of token to lock
    /// @param _unlockTime future block number to unlock
    /// @return nftId id of generated nft, starts from 1
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

    /// @notice increase amount of locked token in an nft
    /// @param nftId id of nft, starts from 1
    /// @param _value increase amount
    function increaseAmount(uint256 nftId, uint256 _value) external nonReentrant {
        LockedBalance memory _locked = nftLocked[nftId];
        require(_value > 0, "amount should >0");
        require(_locked.amount > 0, "No existing lock found");
        require(_locked.end > block.number, "Can only lock until time in the future");
        _depositFor(nftId, _value, 0, _locked, INCREASE_LOCK_AMOUNT);
        if (nft2StakeId[nftId] != 0) {
            // this nft is staking
            stakeiZiAmount += _value;
        }
    }

    /// @notice increase unlock time of an nft
    /// @param nftId id of nft
    /// @param _unlockTime future block number to unlock
    function increaseUnlockTime(uint256 nftId, uint256 _unlockTime) checkAuth(nftId, true) external nonReentrant {
        LockedBalance memory _locked = nftLocked[nftId];
        uint256 unlockTime = (_unlockTime / WEEK) * WEEK;

        require(_locked.end > block.number, "Lock expired");
        require(_locked.amount > 0, "Nothing is locked");
        require(unlockTime > _locked.end, "Can only lock until time in the future");
        require(unlockTime <= block.number + MAXTIME, "Voting lock can be 4 years max");

        _depositFor(nftId, 0, unlockTime, _locked, INCREASE_UNLOCK_TIME);
    }

    /// @notice withdraw an unstaked-nft
    /// @param nftId id of nft
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

        _checkPoint(nftId, oldLocked, _locked);
        IERC20(token).safeTransfer(msg.sender, value);
        _burn(nftId);

        emit Withdraw(nftId, value, block.number);
        emit Supply(supplyBefore, supplyBefore - value);
    }

    /// @notice merge nftFrom to nftTo
    /// @param nftFrom nft id of nftFrom
    /// @param nftTo nft id of nftTo
    function merge(uint256 nftFrom, uint256 nftTo) external nonReentrant {
        require(_isApprovedOrOwner(msg.sender, nftFrom), "Not Owner of nftFrom");
        require(_isApprovedOrOwner(msg.sender, nftTo), "Not Owner of nftTo");
        require(nft2StakeId[nftFrom] == 0, "nftFrom is staked");
        require(nft2StakeId[nftTo] == 0, "nftTo is staked");

        LockedBalance memory lockedFrom = nftLocked[nftFrom];
        LockedBalance memory lockedTo = nftLocked[nftTo];
        require(lockedTo.end >= lockedFrom.end, "endblock of nftFrom cannot later than nftTo");

        // cancel lockedFrom in the weight-curve
        _checkPoint(nftFrom, lockedFrom, LockedBalance({amount: 0, end: 0}));
        LockedBalance memory newLockedTo = lockedTo;
        newLockedTo.amount += lockedFrom.amount;

        // add locked iZi of nftFrom to nftTo
        _checkPoint(nftTo, lockedTo, newLockedTo);
        nftLocked[nftFrom].amount = 0;
        _burn(nftFrom);
    }

    function _findBlockEpoch(uint256 _block, uint256 maxEpoch) internal view returns(uint256) {
        uint256 _min = 0;
        uint256 _max = maxEpoch;
        for (uint24 i = 0; i < 128; i ++) {
            if (_min >= _max) {
                break;
            }
            uint256 _mid = (_min + _max + 1) / 2;
            if (pointHistory[_mid].blk <= _block) {
                _min = _mid;
            } else {
                _max = _mid - 1;
            }
        }
        return _min;
    }

    /// @notice weight of nft at certain time after latest update of fhat nft
    /// @param nftId id of nft
    /// @param blockNumber specified blockNumber after latest update of this nft (amount change or end change)
    /// @return weight
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
    

    /// notice weight of nft at certain time before latest update of fhat nft
    /// @param nftId id of nft
    /// @param _block specified blockNumber before latest update of this nft (amount change or end change)
    /// @return weight
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

    function _supplyAt(Point memory point, uint256 blk) internal view returns(uint256) {
        Point memory lastPoint = point;
        uint256 ti = (lastPoint.blk / WEEK) * WEEK;
        for (uint24 i = 0; i < 255; i ++) {
            ti += WEEK;
            int256 dSlope = 0;
            if (ti > blk) {
                ti = blk;
            } else {
                dSlope = slopeChanges[ti];
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

    /// @notice total weight of all nft at a certain time after check-point of all-nft-collection's curve
    /// @param blk specified blockNumber, "certain time" in above line
    /// @return total weight
    function totalSupply(uint256 blk) external view returns(uint256) {
        uint256 _epoch = epoch;
        Point memory lastPoint = pointHistory[_epoch];
        require(blk >= lastPoint.blk, "Too Early");
        return _supplyAt(lastPoint, blk);
    }

    /// @notice total weight of all nft at a certain time before check-point of all-nft-collection's curve
    /// @param blk specified blockNumber, "certain time" in above line
    /// @return total weight
    function totalSupplyAt(uint256 blk) external view returns(uint256) {
        require(blk <= block.number, "Block Too Late");
        uint256 _epoch = epoch;
        uint256 targetEpoch = _findBlockEpoch(blk, _epoch);

        Point memory point = pointHistory[targetEpoch];
        return _supplyAt(point, blk);
    }

    /// @notice stake an nft
    /// @param nftId id of nft
    function stake(uint256 nftId) external {
        require(nftLocked[nftId].end > block.number, "Lock expired");
        // nftId starts from 1, zero or not owner(including staked) cannot be transfered
        safeTransferFrom(msg.sender, address(this), nftId);
        require(stakedNft[msg.sender] == 0, "Has Staked!");
        stakedNft[msg.sender] = nftId;

        stakeNum += 1;
        nft2StakeId[nftId] = stakeNum;
        stakeiZiAmount += uint256(nftLocked[nftId].amount);

        emit Stake(nftId, msg.sender);
    }

    /// @notice unstake an nft
    /// @param nftId id of nft
    function unStake(uint256 nftId) external {
        require(stakedNft[msg.sender] == nftId, "Not Owner or Not staking!");
        nft2StakeId[nftId] = 0;
        stakedNft[msg.sender] = 0;
        // refund nft
        safeTransferFrom(address(this), msg.sender, nftId);

        stakeiZiAmount -= uint256(nftLocked[nftId].amount);
        emit Unstake(nftId, msg.sender);
    }

    /// @notice get user's staking info
    /// @param user address of user
    /// @return nftId id of veizi-nft
    /// @return stakeId id of stake
    /// @return amount amount of locked iZi in nft
    function stakingInfo(address user) external view returns(uint256 nftId, uint256 stakeId, uint256 amount) {
        nftId = stakedNft[user];
        if (nftId != 0) {
            stakeId = nft2StakeId[nftId];
            amount = uint256(nftLocked[nftId].amount);
        } else {
            stakeId = 0;
            amount = 0;
        }
    }

}