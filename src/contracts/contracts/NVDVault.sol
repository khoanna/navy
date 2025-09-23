// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "./NVDToken.sol";

contract NVDVault is Ownable, ReentrancyGuard {
    IERC20 public wbtc;
    IERC20 public weth;
    NVDToken public nvd;

    AggregatorV3Interface internal btcPriceFeed;
    AggregatorV3Interface internal ethPriceFeed;

    uint256 public usdToVnd;

    uint256 public constant MIN_CR = 130;
    uint256 public constant LIQ_THRESHOLD = 110;
    uint256 public constant LIQ_BONUS = 5;

    struct Position {
        uint256 collateralETH;
        uint256 collateralBTC;
        uint256 debtNVD;
    }

    struct LiquidatablePosition {
        address user;
        uint256 collateralETH;
        uint256 collateralETHValueVND;
        uint256 collateralBTC;
        uint256 collateralBTCValueVND;
        uint256 debtNVD;
        uint256 currentCR;
    }

    mapping(address => Position) public positions;

    constructor(
        address _nvdToken,
        address _ethPriceFeed,
        address _btcPriceFeed,
        address _wbtc,
        address _weth,
        uint256 _usdToVnd
    ) Ownable(msg.sender) {
        nvd = NVDToken(_nvdToken);
        ethPriceFeed = AggregatorV3Interface(_ethPriceFeed);
        btcPriceFeed = AggregatorV3Interface(_btcPriceFeed);
        weth = IERC20(_weth);
        wbtc = IERC20(_wbtc);
        usdToVnd = _usdToVnd;
    }

    // ===== USER TRACKING =====
    address[] public users;
    mapping(address => bool) private exists;

    function _addUser(address user) internal {
        if (!exists[user]) {
            users.push(user);
            exists[user] = true;
        }
    }

    // ===== PRICE HELPERS =====
    function getLatestBtcPriceInVND() public view returns (uint256) {
        (, int256 price, , , ) = btcPriceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        uint8 decimals = btcPriceFeed.decimals();
        return (uint256(price) * usdToVnd) / (10 ** decimals);
    }

    function getLatestEthPriceInVND() public view returns (uint256) {
        (, int256 price, , , ) = ethPriceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        uint8 decimals = ethPriceFeed.decimals();
        return (uint256(price) * usdToVnd) / (10 ** decimals);
    }

    function setUsdToVnd(uint256 _usdToVnd) public onlyOwner {
        usdToVnd = _usdToVnd;
    }

    // ===== COLLATERAL DEPOSIT =====
    function depositWETH(uint256 amount) external {
        require(amount > 0, "Invalid amount");
        require(
            weth.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        positions[msg.sender].collateralETH += amount;
        _addUser(msg.sender);
    }

    function depositWBTC(uint256 amount) external {
        require(amount > 0, "Invalid amount");
        require(
            wbtc.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        positions[msg.sender].collateralBTC += amount;
        _addUser(msg.sender);
    }

    // ===== MINT & REPAY =====
    function mintNVD(uint256 mintAmount) external {
        require(mintAmount > 0, "Invalid mint amount");

        Position storage pos = positions[msg.sender];
        uint256 newDebt = pos.debtNVD + mintAmount;

        require(
            _checkCR(pos.collateralETH, pos.collateralBTC, newDebt) >= MIN_CR,
            "CR too low"
        );

        pos.debtNVD = newDebt;
        nvd.mint(msg.sender, mintAmount);
    }

    function repay(uint256 nvdAmount) external {
        require(nvdAmount > 0, "Invalid repay");
        Position storage pos = positions[msg.sender];
        require(pos.debtNVD >= nvdAmount, "Repay exceeds debt");

        require(
            nvd.transferFrom(msg.sender, address(this), nvdAmount),
            "Transfer failed"
        );
        nvd.burn(address(this), nvdAmount);

        pos.debtNVD -= nvdAmount;
    }

    // ===== WITHDRAW =====
    function withdrawWETH(uint256 ethAmount) external nonReentrant {
        Position storage pos = positions[msg.sender];
        require(ethAmount > 0, "Invalid amount");
        require(pos.collateralETH >= ethAmount, "Not enough ETH collateral");

        uint256 newEth = pos.collateralETH - ethAmount;
        if (pos.debtNVD > 0) {
            require(
                _checkCR(newEth, pos.collateralBTC, pos.debtNVD) >= MIN_CR,
                "CR too low after withdraw"
            );
        }

        pos.collateralETH = newEth;
        weth.transfer(msg.sender, ethAmount);
        if (
            positions[msg.sender].collateralETH == 0 &&
            positions[msg.sender].collateralBTC == 0 &&
            positions[msg.sender].debtNVD == 0
        ) {
            _removeUser(msg.sender);
        }
    }

    function withdrawWBTC(uint256 btcAmount) external nonReentrant {
        Position storage pos = positions[msg.sender];
        require(btcAmount > 0, "Invalid amount");
        require(pos.collateralBTC >= btcAmount, "Not enough BTC collateral");

        uint256 newBtc = pos.collateralBTC - btcAmount;
        if (pos.debtNVD > 0) {
            require(
                _checkCR(pos.collateralETH, newBtc, pos.debtNVD) >= MIN_CR,
                "CR too low after withdraw"
            );
        }

        pos.collateralBTC = newBtc;
        wbtc.transfer(msg.sender, btcAmount);
        if (
            positions[msg.sender].collateralETH == 0 &&
            positions[msg.sender].collateralBTC == 0 &&
            positions[msg.sender].debtNVD == 0
        ) {
            _removeUser(msg.sender);
        }
    }

    // ===== LIQUIDATION =====
    function liquidate(address user) external nonReentrant {
        Position storage pos = positions[user];
        require(pos.debtNVD > 0, "No debt");

        uint256 cr = _checkCR(
            pos.collateralETH,
            pos.collateralBTC,
            pos.debtNVD
        );
        require(cr < LIQ_THRESHOLD, "Position healthy");

        require(
            nvd.transferFrom(msg.sender, address(this), pos.debtNVD),
            "Transfer failed"
        );
        nvd.burn(address(this), pos.debtNVD);

        uint256 rewardETH = (pos.collateralETH * LIQ_BONUS) / 100;
        uint256 rewardBTC = (pos.collateralBTC * LIQ_BONUS) / 100;

        if (pos.collateralETH > 0)
            weth.transfer(msg.sender, pos.collateralETH + rewardETH);
        if (pos.collateralBTC > 0)
            wbtc.transfer(msg.sender, pos.collateralBTC + rewardBTC);

        pos.collateralETH = 0;
        pos.collateralBTC = 0;
        pos.debtNVD = 0;

        _removeUser(user);
    }

    // ===== HELPERS =====
    function getCR(address user) external view returns (uint256) {
        Position memory pos = positions[user];
        return _checkCR(pos.collateralETH, pos.collateralBTC, pos.debtNVD);
    }

    function _checkCR(
        uint256 ethAmount,
        uint256 btcAmount,
        uint256 debt
    ) internal view returns (uint256) {
        if (debt == 0) return type(uint256).max;
        uint256 ethValue = (ethAmount * getLatestEthPriceInVND()) / 1e18;
        uint256 btcValue = (btcAmount * getLatestBtcPriceInVND()) / 1e18;
        uint256 totalValue = ethValue + btcValue;
        return (totalValue) * 1e18 / debt;
    }

    function getCollateralValueNVD(
        address user
    ) external view returns (uint256) {
        uint256 ethValue = (positions[user].collateralETH *
            getLatestEthPriceInVND()) / 1e18;
        uint256 btcValue = (positions[user].collateralBTC *
            getLatestBtcPriceInVND()) / 1e18;
        uint256 totalValue = ethValue + btcValue;
        return totalValue;
    }

    function getLiquidatablePositions()
        external
        view
        returns (LiquidatablePosition[] memory)
    {
        uint256 count = 0;

        for (uint256 i = 0; i < users.length; i++) {
            Position memory pos = positions[users[i]];
            if (
                pos.debtNVD > 0 &&
                _checkCR(pos.collateralETH, pos.collateralBTC, pos.debtNVD) <
                LIQ_THRESHOLD
            ) {
                count++;
            }
        }

        LiquidatablePosition[] memory liqPositions = new LiquidatablePosition[](
            count
        );
        uint256 index = 0;

        for (uint256 i = 0; i < users.length; i++) {
            Position memory pos = positions[users[i]];
            uint256 cr = _checkCR(
                pos.collateralETH,
                pos.collateralBTC,
                pos.debtNVD
            );
            if (pos.debtNVD > 0 && cr < LIQ_THRESHOLD) {
                liqPositions[index] = LiquidatablePosition({
                    user: users[i],
                    collateralETH: pos.collateralETH,
                    collateralETHValueVND: (pos.collateralETH *
                        getLatestEthPriceInVND()) / 1e18,
                    collateralBTC: pos.collateralBTC,
                    collateralBTCValueVND: (pos.collateralBTC *
                        getLatestBtcPriceInVND()) / 1e18,
                    debtNVD: pos.debtNVD,
                    currentCR: cr
                });
                index++;
            }
        }

        return liqPositions;
    }

    function _removeUser(address user) internal {
        if (!exists[user]) return;

        uint256 len = users.length;
        for (uint256 i = 0; i < len; i++) {
            if (users[i] == user) {
                users[i] = users[len - 1];
                users.pop();
                exists[user] = false;
                break;
            }
        }
    }
}
