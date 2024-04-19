// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IChaserRegistry} from "./interfaces/IChaserRegistry.sol";

contract PoolCalculations {
    mapping(bytes32 => address) public depositIdToDepositor;
    mapping(bytes32 => uint256) public depositIdToDepositAmount;
    mapping(bytes32 => bool) public depositIdToTokensMinted;

    mapping(bytes32 => address) public withdrawIdToDepositor;
    mapping(bytes32 => uint256) public withdrawIdToAmount;

    event DepositRecorded(bytes32, uint256);
    event WithdrawRecorded(bytes32, uint256);

    IChaserRegistry public registry;

    constructor(address _registryAddress) {
        registry = IChaserRegistry(_registryAddress);
    }
    //IMPORTANT - NEED FUNCTION FOR RESETTING STATE WHEN DEPOSIT FAILS ON DESTINATION NETWORK

    modifier onlyValidPool() {
        require(
            registry.poolEnabled(msg.sender),
            "Only valid pools may use this calculations contract"
        );
        _;
    }

    function createWithdrawOrder(
        uint256 _amount,
        uint256 _poolNonce,
        address _poolToken,
        address _sender
    ) external onlyValidPool returns (bytes memory) {
        // IMPORTANT - CHECK REGISTRY THAT msg.sender IS A VALID POOL
        // require(msg.sender )

        bytes32 withdrawId = keccak256(
            abi.encode(msg.sender, _sender, _amount, block.timestamp)
        );

        withdrawIdToDepositor[withdrawId] = _sender;
        withdrawIdToAmount[withdrawId] = _amount;

        emit WithdrawRecorded(withdrawId, _amount);

        uint256 scaledRatio = getScaledRatio(_poolToken, _sender);

        bytes memory data = abi.encode(
            withdrawId,
            _amount,
            _poolNonce,
            scaledRatio
        );
        return data;
    }

    function getScaledRatio(
        address _poolToken,
        address _sender
    ) public view returns (uint256) {
        IERC20 poolToken = IERC20(_poolToken);

        uint256 userPoolTokenBalance = poolToken.balanceOf(_sender);
        if (userPoolTokenBalance == 0) {
            return 0;
        }
        uint256 poolTokenSupply = poolToken.totalSupply();
        require(poolTokenSupply > 0, "Pool Token has no supply");

        uint256 scaledRatio = (10 ** 18);
        if (userPoolTokenBalance != poolTokenSupply) {
            scaledRatio =
                (userPoolTokenBalance * (10 ** 18)) /
                (poolTokenSupply);
        }
        return scaledRatio;
    }

    function getWithdrawOrderFulfillment(
        bytes32 _withdrawId,
        uint256 _totalAvailableForUser,
        uint256 _amount,
        address _poolToken
    ) external onlyValidPool returns (address, uint256) {
        //amount gets passed from the BridgeLogic as the input amount, before bridging/protocol fees deduct from the received amount. This amount reflects the total amount of asset removed from the position
        address depositor = withdrawIdToDepositor[_withdrawId];

        IERC20 poolToken = IERC20(_poolToken);

        uint256 userPoolTokenBalance = poolToken.balanceOf(depositor);

        if (_totalAvailableForUser < _amount) {
            _amount = _totalAvailableForUser;
        }

        uint256 poolTokensToBurn = userPoolTokenBalance;
        if (_totalAvailableForUser > 0) {
            uint256 ratio = (_amount * (10 ** 18)) / (_totalAvailableForUser);
            poolTokensToBurn = (ratio * userPoolTokenBalance) / (10 ** 18);
        }

        return (depositor, poolTokensToBurn);
    }

    function createDepositOrder(
        address _sender,
        uint256 _amount
    ) external onlyValidPool returns (bytes32) {
        // Generate a deposit ID
        bytes32 depositId = bytes32(
            keccak256(abi.encode(msg.sender, _sender, _amount, block.timestamp))
        );

        // Map deposit ID to depositor and deposit amount
        depositIdToDepositor[depositId] = _sender;
        depositIdToDepositAmount[depositId] = _amount;
        depositIdToTokensMinted[depositId] = false;

        emit DepositRecorded(depositId, _amount);
        return depositId;
    }

    function updateDepositReceived(
        bytes32 _depositId,
        uint256 _depositAmountReceived
    ) external onlyValidPool returns (address) {
        depositIdToDepositAmount[_depositId] = _depositAmountReceived;
        return depositIdToDepositor[_depositId];
    }

    function depositIdMinted(bytes32 _depositId) external {
        depositIdToTokensMinted[_depositId] = true;
    }

    function createPivotExitMessage(
        bytes32 _protocolHash,
        string memory _requestMarketId,
        uint256 _destinationChainId,
        address _destinationBridgeReceiver
    ) external view returns (bytes memory) {
        bytes memory data = abi.encode(
            _protocolHash,
            address(0), // IMPORTANT - REPLACE WITH MARKET ADDRESS VALIDATED IN ARBITRATION
            _requestMarketId,
            _destinationChainId,
            _destinationBridgeReceiver
        );

        return data;
    }

    function calculatePoolTokensToMint(
        bytes32 _depositId,
        uint256 _totalPoolPositionAmount,
        uint256 _poolTokenSupply
    ) external view returns (uint256, address) {
        uint256 assetAmount = depositIdToDepositAmount[_depositId];
        address depositor = depositIdToDepositor[_depositId];
        uint256 poolTokensToMint;
        if (_totalPoolPositionAmount == assetAmount) {
            // Take the rounded down base 10 log of total supplied tokens by user
            // Make the initial supply 10 ^ (18 + base10 log)
            uint256 supplyFactor = (Math.log10(assetAmount));
            poolTokensToMint = 10 ** supplyFactor;
        } else {
            uint256 ratio = (assetAmount * (10 ** 18)) /
                (_totalPoolPositionAmount - assetAmount);
            poolTokensToMint = (ratio * _poolTokenSupply) / (10 ** 18);
        }

        return (poolTokensToMint, depositor);
    }
}
