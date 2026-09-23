// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IBiosphereRegistry {
    function isLive() external view returns (bool);
    function realRevenueRatioBps() external view returns (uint256);
    function latest() external view returns (uint40 ts, uint32 generation, uint32 aliveCount, bytes32 populationRoot, uint64 realRevenueMicro, uint64 subsidyMicro);
}

/// @title SubsidyPool
/// @notice 代币税 → 生态补贴的资金池。核心是**内置退坡**：
///         真实 x402 收入占比越高，每天能领的补贴越少，占比 100% 时自动归零。
///         这样「用交易税养模拟」不会变成永久的庞氏回路，而且规则写死在合约里、对外可信。
/// @dev 领取时必须附带 Registry 里最新的 populationRoot —— 钱和「可验证的种群状态」绑定，
///      无法在没有提交状态承诺的情况下把钱抽走。
contract SubsidyPool {
    IERC20Minimal public immutable usdc;      // Arc 主网 USDC, 6 位精度
    address public admin;                      // 建议 = 2/3 Safe 多签
    address public operator;                   // 生命模拟服务器的钱包
    IBiosphereRegistry public registry;

    uint256 public baseCapPerDay;   // 退坡前的每日补贴上限（USDC 6 位）
    uint256 public sweepCapPerDay;  // admin 每日最多回收多少（防一次性抽干）
    bool public requireLive = true; // 必须 isLive() 才能领补贴

    uint256 private _dayStamp;
    uint256 public drawnToday;
    uint256 public sweptToday;

    uint256 public totalDonated;
    uint256 public totalDrawn;
    uint256 public totalSwept;

    event Donated(address indexed from, uint256 amount);
    event Drawn(address indexed to, uint256 amount, bytes32 populationRoot, uint256 ratioBps, uint256 capPerDay);
    event Swept(address indexed to, uint256 amount);
    event ConfigSet(uint256 baseCapPerDay, uint256 sweepCapPerDay, bool requireLive);
    event OperatorSet(address indexed operator);
    event RegistrySet(address indexed registry);
    event AdminSet(address indexed admin);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    constructor(address _usdc, address _operator, address _registry, uint256 _baseCapPerDay, uint256 _sweepCapPerDay) {
        usdc = IERC20Minimal(_usdc);
        admin = msg.sender;
        operator = _operator;
        registry = IBiosphereRegistry(_registry);
        baseCapPerDay = _baseCapPerDay;
        sweepCapPerDay = _sweepCapPerDay;
    }

    // ── 资金入口 ─────────────────────────────────────────────
    /// @notice 由 Safe 把 Argus 的 creator share 转进来（先 approve）
    function donate(uint256 amount) external {
        require(amount > 0, "zero");
        require(usdc.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        totalDonated += amount;   // CEI：外部调用之后再改状态
        emit Donated(msg.sender, amount);
    }

    // ── 退坡公式（这就是「诚实」的部分）────────────────────────
    /// @notice 乘数 = (1 - realRevenueRatio)^2，整数运算，返回 bps（10000 = 1.0）
    function taperMultiplierBps() public view returns (uint256) {
        uint256 r = registry.realRevenueRatioBps();
        if (r >= 10_000) return 0;
        uint256 inv = 10_000 - r;
        return (inv * inv) / 10_000;   // 0..10000
    }

    /// @notice 今天最多能领多少补贴（随真实收入占比自动收缩）
    function maxDrawPerDay() public view returns (uint256) {
        return (baseCapPerDay * taperMultiplierBps()) / 10_000;
    }

    function remainingToday() public view returns (uint256) {
        uint256 cap = maxDrawPerDay();
        if (_dayStamp != block.timestamp / 1 days) return cap;
        return drawnToday >= cap ? 0 : cap - drawnToday;
    }

    function _rollDay() private {
        uint256 today = block.timestamp / 1 days;
        if (_dayStamp != today) { _dayStamp = today; drawnToday = 0; sweptToday = 0; }
    }

    // ── 资金出口：补贴 ───────────────────────────────────────
    /// @notice 模拟服务器领取补贴，用于注入基线需求。必须绑定最新的种群状态根。
    /// @param populationRoot 必须等于 Registry 中最新一次提交的根，否则拒绝
    function draw(address to, uint256 amount, bytes32 populationRoot) external onlyOperator {
        require(to != address(0), "zero to");
        require(amount > 0, "zero amount");
        _rollDay();
        if (requireLive) require(registry.isLive(), "biosphere not live");
        (, , , bytes32 latestRoot, , ) = registry.latest();
        require(populationRoot == latestRoot, "stale root");
        uint256 cap = maxDrawPerDay();
        require(drawnToday + amount <= cap, "over daily cap");
        drawnToday += amount;
        totalDrawn += amount;
        emit Drawn(to, amount, populationRoot, registry.realRevenueRatioBps(), cap);
        require(usdc.transfer(to, amount), "transfer failed");
    }

    // ── 资金出口：回收（限速）────────────────────────────────
    /// @notice admin 回收闲置资金到 treasury，每日限速，防止一次性抽干
    function sweepToTreasury(address to, uint256 amount) external onlyAdmin {
        require(to != address(0), "zero to");
        require(amount > 0, "zero");
        _rollDay();
        require(sweptToday + amount <= sweepCapPerDay, "over sweep cap");
        sweptToday += amount;
        totalSwept += amount;
        emit Swept(to, amount);
        require(usdc.transfer(to, amount), "transfer failed");
    }

    // ── 配置（全部有事件，链上可审计）─────────────────────────
    function setConfig(uint256 _baseCapPerDay, uint256 _sweepCapPerDay, bool _requireLive) external onlyAdmin {
        baseCapPerDay = _baseCapPerDay;
        sweepCapPerDay = _sweepCapPerDay;
        requireLive = _requireLive;
        emit ConfigSet(_baseCapPerDay, _sweepCapPerDay, _requireLive);
    }
    function setOperator(address _operator) external onlyAdmin { operator = _operator; emit OperatorSet(_operator); }
    function setRegistry(address _registry) external onlyAdmin { registry = IBiosphereRegistry(_registry); emit RegistrySet(_registry); }
    function setAdmin(address _admin) external onlyAdmin { require(_admin != address(0), "zero"); admin = _admin; emit AdminSet(_admin); }

    /// @notice 一页看完全池状态（前端 /verify 直接读这个）
    function stats() external view returns (uint256 balance, uint256 donated, uint256 drawn, uint256 swept, uint256 ratioBps, uint256 taperBps, uint256 capToday, uint256 leftToday, bool live) {
        return (
            usdc.balanceOf(address(this)),
            totalDonated, totalDrawn, totalSwept,
            registry.realRevenueRatioBps(),
            taperMultiplierBps(),
            maxDrawPerDay(),
            remainingToday(),
            registry.isLive()
        );
    }
}
