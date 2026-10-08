// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {SafeCast} from "v4-core/src/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

import {StampRouter} from "./StampRouter.sol";
import {StampEthRouter} from "./StampEthRouter.sol";
import {SafeTransfer} from "./lib/SafeTransfer.sol";

interface IStampSupply {
    function MAX_SUPPLY() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// @title StampHook
/// @notice Pool owner and Uniswap v4 hook for $STAMP. It opens one $STAMP/IMD pool, once. `launchSupply` $STAMP is
///         added as single-sided liquidity owned by this contract, which has no way to remove it (locked forever).
///         Every swap in the pool pays 4% of its IMD side, all of it to the protocol (`feeRecipient`). The rest of
///         $STAMP's 21M supply is earned in the game.
/// @dev Must be deployed at an address whose low 14 bits equal `HOOK_FLAGS` (mine a CREATE2 salt).
contract StampHook is IHooks, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;
    using SafeTransfer for address;
    using SafeCast for uint256;

    error NotPoolManager();
    error NotOwner();
    error UnknownToken();
    error AlreadyLaunched();
    error BadToken();
    error BadTick();
    error ZeroAddress();
    error HookNotAllowed();
    error PartialFill();

    event PoolOpened(address indexed token, PoolId poolId, int24 startTick);
    /// @param quoteAmount IMD paid by the buyer / received by the seller, fee included
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint160 sqrtPriceX96
    );
    event ProtocolFeesCollected(address indexed quote, address indexed to, uint256 amount);
    event FeeRecipientUpdated(address feeRecipient);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 400; // 4%, all to the protocol
    int24 public constant TICK_SPACING = 200;
    uint24 public constant LP_FEE = 0; // all fees are taken by the hook
    uint160 public constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @dev Kept out of the liquidity calculation so rounding can never ask for more than the allocation; burned.
    uint256 internal constant LIQUIDITY_BUFFER = 1e9;
    uint256 internal constant Q96 = 2 ** 96;
    /// @dev keccak256("Stamp.beforeSwapFee") - transient slot passing the fee from beforeSwap to afterSwap.
    bytes32 internal constant FEE_SLOT = 0x0e7a214e2bfdcb5a3f6eeb3feb3428d747006b85ea848e6432dc8645d4c1524d;

    uint8 internal constant ACTION_ADD_LIQUIDITY = 0;
    uint8 internal constant ACTION_COLLECT = 1;

    IPoolManager public immutable poolManager;
    address public immutable IMD;
    address public immutable router;
    address public immutable ethRouter;
    /// @notice Launch tick, expressed as the tick of ($STAMP per IMD). Sets the starting price.
    int24 public immutable startTick;
    /// @notice $STAMP locked in the pool at launch (single-sided, above the starting price).
    uint256 public immutable launchSupply;

    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    /// @notice The $STAMP token, once launched.
    address public token;

    struct ImdEthPool {
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Launch {
        address quote;
        address creator;
        uint64 createdAt;
        uint64 createdBlock;
        bool quoteIsCurrency0;
    }

    mapping(address token => Launch) public launches;
    mapping(PoolId => address) public tokenOfPool;
    mapping(address quote => uint256) public pendingProtocolFees;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        address imd,
        address owner_,
        address feeRecipient_,
        int24 startTick_,
        uint256 launchSupply_,
        ImdEthPool memory imdEthPool
    ) {
        if (imd == address(0) || owner_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        int24 limit = TickMath.maxUsableTick(TICK_SPACING) - TICK_SPACING;
        if (startTick_ % TICK_SPACING != 0 || startTick_ > limit || startTick_ < -limit) revert BadTick();
        if (launchSupply_ <= LIQUIDITY_BUFFER) revert BadToken();
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        poolManager = poolManager_;
        IMD = imd;
        owner = owner_;
        feeRecipient = feeRecipient_;
        startTick = startTick_;
        launchSupply = launchSupply_;
        router = address(new StampRouter(poolManager_, address(this)));
        ethRouter = address(
            new StampEthRouter(poolManager_, address(this), imd, imdEthPool.fee, imdEthPool.tickSpacing, imdEthPool.hooks)
        );
        emit OwnershipTransferred(address(0), owner_);
        emit FeeRecipientUpdated(feeRecipient_);
    }

    // --------------------------------------------------------------- Launch

    /// @notice One-time: locks the launch allocation of `token_` ($STAMP, minted to this contract) in its pool.
    function openPool(address token_) external onlyOwner {
        if (token != address(0)) revert AlreadyLaunched();
        if (IStampSupply(token_).balanceOf(address(this)) != launchSupply) revert BadToken();

        token = token_;
        bool quoteIs0 = uint160(IMD) < uint160(token_);
        launches[token_] = Launch({
            quote: IMD,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            createdBlock: _l2BlockNumber(),
            quoteIsCurrency0: quoteIs0
        });

        PoolKey memory key = poolKey(token_);
        PoolId id = key.toId();
        tokenOfPool[id] = token_;

        // Price is currency1 per currency0: with $STAMP as currency1 that is tokens-per-IMD (= startTick).
        int24 tick = quoteIs0 ? startTick : -startTick;
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        poolManager.unlock(abi.encode(ACTION_ADD_LIQUIDITY, abi.encode(key, token_, tick, quoteIs0)));

        emit PoolOpened(token_, id, tick);
    }

    function _addLaunchLiquidity(PoolKey memory key, address token_, int24 tick, bool tokenIs1) internal {
        (int24 lower, int24 upper) =
            tokenIs1 ? (TickMath.minUsableTick(TICK_SPACING), tick) : (tick, TickMath.maxUsableTick(TICK_SPACING));
        uint256 sqrtL = TickMath.getSqrtPriceAtTick(lower);
        uint256 sqrtU = TickMath.getSqrtPriceAtTick(upper);
        uint256 amount = launchSupply - LIQUIDITY_BUFFER;
        uint256 liquidity = tokenIs1
            ? FullMath.mulDiv(amount, Q96, sqrtU - sqrtL)
            : FullMath.mulDiv(amount, FullMath.mulDiv(sqrtL, sqrtU, Q96), sqrtU - sqrtL);

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(liquidity), salt: 0}),
            ""
        );
        uint256 owed = uint256(-int256(tokenIs1 ? delta.amount1() : delta.amount0()));
        poolManager.sync(Currency.wrap(token_));
        token_.transferOut(address(poolManager), owed);
        poolManager.settle();
        token_.transferOut(DEAD, IStampSupply(token_).balanceOf(address(this)));
    }

    // ------------------------------------------------------------ Hook

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address t = tokenOfPool[key.toId()];
        bool exactIn = params.amountSpecified < 0;
        // Fee is taken here only when IMD is the swap's specified currency.
        if ((exactIn == params.zeroForOne) != launches[t].quoteIsCurrency0) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 amount = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
        // exact-in buy: 4% of what the buyer pays. exact-out sell: 4% of the gross the pool pays out.
        uint256 fee = exactIn ? (amount * FEE_BPS) / BPS : (amount * FEE_BPS) / (BPS - FEE_BPS);
        _chargeFee(fee);
        assembly ("memory-safe") {
            tstore(FEE_SLOT, fee)
        }
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(fee.toInt128(), 0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128 hookDelta) {
        address t = tokenOfPool[key.toId()];
        bool quoteIs0 = launches[t].quoteIsCurrency0;
        bool exactIn = params.amountSpecified < 0;
        int128 q = quoteIs0 ? delta.amount0() : delta.amount1();
        int128 tk = quoteIs0 ? delta.amount1() : delta.amount0();
        uint256 poolQuote = uint256(int256(q < 0 ? -q : q));
        uint256 tokenAmount = uint256(int256(tk < 0 ? -tk : tk));

        uint256 fee;
        if ((exactIn == params.zeroForOne) == quoteIs0) {
            assembly ("memory-safe") {
                fee := tload(FEE_SLOT)
                tstore(FEE_SLOT, 0)
            }
            // beforeSwap charged the fee on the requested IMD amount. A swap that stops early (at a price limit or
            // the end of liquidity) would overpay it, so only full fills are accepted.
            // Exact-in: the pool takes the request minus the fee. Exact-out: the pool pays the request plus the fee.
            uint256 requested = exactIn ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);
            if (exactIn ? poolQuote + fee != requested : poolQuote != requested + fee) revert PartialFill();
        } else {
            // IMD is the unspecified side. exact-in sell: 4% of the pool's output.
            // exact-out buy: 4% of what the buyer pays in total.
            fee = exactIn ? (poolQuote * FEE_BPS) / BPS : (poolQuote * FEE_BPS) / (BPS - FEE_BPS);
            _chargeFee(fee);
            hookDelta = fee.toInt128();
        }

        bool isBuy = params.zeroForOne == quoteIs0;
        // Both routers pass the real user in hookData; others are logged as tx.origin.
        address trader = (sender == router || sender == ethRouter) && hookData.length == 32
            ? abi.decode(hookData, (address))
            : tx.origin;
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(key.toId());
        uint256 quoteAmount = isBuy ? poolQuote + fee : (poolQuote > fee ? poolQuote - fee : 0);
        emit Trade(t, trader, isBuy, quoteAmount, tokenAmount, fee, sqrtPriceX96);
        return (IHooks.afterSwap.selector, hookDelta);
    }

    /// @dev The hook is credited `fee` by the swap; minting claims of the same size settles that credit.
    function _chargeFee(uint256 fee) internal {
        if (fee == 0) return;
        pendingProtocolFees[IMD] += fee;
        poolManager.mint(address(this), Currency.wrap(IMD).toId(), fee);
    }

    // ------------------------------------------------------------ Fee flows

    /// @notice Sends pending protocol fees to `feeRecipient`. Callable by anyone.
    function collectProtocolFees(address quote) external {
        if (pendingProtocolFees[quote] == 0) return;
        if (poolManager.isUnlocked()) _collect(quote);
        else poolManager.unlock(abi.encode(ACTION_COLLECT, abi.encode(quote)));
    }

    function _collect(address quote) internal {
        uint256 amount = pendingProtocolFees[quote];
        if (amount == 0) return;
        pendingProtocolFees[quote] = 0;
        poolManager.burn(address(this), Currency.wrap(quote).toId(), amount);
        poolManager.take(Currency.wrap(quote), feeRecipient, amount);
        emit ProtocolFeesCollected(quote, feeRecipient, amount);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == ACTION_ADD_LIQUIDITY) {
            (PoolKey memory key, address t, int24 tick, bool tokenIs1) =
                abi.decode(payload, (PoolKey, address, int24, bool));
            _addLaunchLiquidity(key, t, tick, tokenIs1);
        } else {
            _collect(abi.decode(payload, (address)));
        }
        return "";
    }

    /// @dev On Arbitrum chains (Robinhood Chain) `block.number` is the L1 block; ArbSys gives the L2 block.
    function _l2BlockNumber() internal view returns (uint64) {
        (bool ok, bytes memory data) = address(100).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        return ok && data.length == 32 ? uint64(abi.decode(data, (uint256))) : uint64(block.number);
    }

    // ---------------------------------------------------------------- Admin

    function setFeeRecipient(address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        emit FeeRecipientUpdated(feeRecipient_);
    }

    /// @notice Two-step transfer: `newOwner` must call `acceptOwnership`, so a typo can't lose the admin role.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------- Views

    function poolKey(address t) public view returns (PoolKey memory key) {
        Launch storage l = launches[t];
        if (l.createdAt == 0) revert UnknownToken();
        (address c0, address c1) = l.quoteIsCurrency0 ? (l.quote, t) : (t, l.quote);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    /// @notice $STAMP's price in IMD wei per whole $STAMP, at the current pool price.
    function price(address t) public view returns (uint256) {
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey(t).toId());
        return launches[t].quoteIsCurrency0
            ? FullMath.mulDiv(FullMath.mulDiv(1e18, Q96, sqrtP), Q96, sqrtP)
            : FullMath.mulDiv(FullMath.mulDiv(1e18, sqrtP, Q96), sqrtP, Q96);
    }

    /// @notice Fully diluted market cap (21M $STAMP) in IMD wei at the current pool price.
    function marketCap(address t) external view returns (uint256) {
        return FullMath.mulDiv(price(t), IStampSupply(t).MAX_SUPPLY(), 1e18);
    }

    // ------------------------------------------------- Disabled hook paths

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotAllowed();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotAllowed();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotAllowed();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotAllowed();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotAllowed();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotAllowed();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotAllowed();
    }
}
