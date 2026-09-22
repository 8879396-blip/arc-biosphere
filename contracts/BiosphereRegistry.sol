// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BiosphereRegistry
/// @notice 生命经济体的「还在跑，而且能证明」原语。
///         运营者（生命模拟服务器）周期性提交种群状态根与真实收入，
///         任何人可调用 isLive() / realRevenueRatioBps() 独立核查，无需信任我们。
/// @dev 无代币依赖、无 owner 特权读取、无升级逻辑。admin 仅能改 operator / maxGap。
contract BiosphereRegistry {
    struct Commit {
        uint40 ts;            // 提交时间
        uint32 generation;    // 世代
        uint32 aliveCount;    // 存活个体数
        bytes32 populationRoot; // keccak256 规范化种群快照（确定性重放的锚）
        uint64 realRevenueMicro;  // 累计真实 x402 收入（USDC 6 位）
        uint64 subsidyMicro;      // 累计补贴支出（USDC 6 位）
    }

    address public admin;
    address public operator;
    uint256 public maxGap = 2 hours;   // 超过这个间隔没提交 = 判定「没在跑」
    uint256 public commitCount;
    bytes32 public head;               // 哈希链头，防篡改历史

    Commit[] private _commits;
    mapping(bytes32 => bool) public seen;

    event Committed(uint256 indexed index, uint32 generation, uint32 aliveCount, bytes32 populationRoot, uint64 realRevenueMicro, uint64 subsidyMicro, bytes32 head);
    event OperatorSet(address indexed operator);
    event MaxGapSet(uint256 maxGap);
    event AdminSet(address indexed admin);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    constructor(address _operator) {
        admin = msg.sender;
        operator = _operator;
        emit OperatorSet(_operator);
    }

    /// @notice 运营者提交一次状态承诺
    function commit(
        uint32 generation,
        uint32 aliveCount,
        bytes32 populationRoot,
        uint64 realRevenueMicro,
        uint64 subsidyMicro
    ) external onlyOperator {
        require(populationRoot != bytes32(0), "empty root");
        require(realRevenueMicro <= type(uint64).max / 2, "rev overflow");
        Commit memory c = Commit({
            ts: uint40(block.timestamp),
            generation: generation,
            aliveCount: aliveCount,
            populationRoot: populationRoot,
            realRevenueMicro: realRevenueMicro,
            subsidyMicro: subsidyMicro
        });
        bytes32 h = keccak256(abi.encode(head, c));
        head = h;
        seen[h] = true;
        _commits.push(c);
        uint256 idx = commitCount++;
        emit Committed(idx, generation, aliveCount, populationRoot, realRevenueMicro, subsidyMicro, h);
    }

    /// @notice 最新一次提交
    function latest() external view returns (Commit memory) {
        require(commitCount > 0, "no commits");
        return _commits[commitCount - 1];
    }

    function commitAt(uint256 i) external view returns (Commit memory) { return _commits[i]; }

    /// @notice 距上次提交的秒数
    function secondsSinceLastCommit() public view returns (uint256) {
        if (commitCount == 0) return type(uint256).max;
        return block.timestamp - uint256(_commits[commitCount - 1].ts);
    }

    /// @notice 核心核查入口：这个经济体现在还在自主运行吗？
    function isLive() external view returns (bool) { return secondsSinceLastCommit() <= maxGap; }

    /// @notice 真实收入占总供给的比例（bps）。越高 = 越少依赖补贴。
    function realRevenueRatioBps() public view returns (uint256) {
        if (commitCount == 0) return 0;
        Commit memory c = _commits[commitCount - 1];
        uint256 total = uint256(c.realRevenueMicro) + uint256(c.subsidyMicro);
        if (total == 0) return 0;
        return (uint256(c.realRevenueMicro) * 10_000) / total;
    }

    function setOperator(address _operator) external onlyAdmin { operator = _operator; emit OperatorSet(_operator); }
    function setMaxGap(uint256 _maxGap) external onlyAdmin { require(_maxGap >= 5 minutes, "too short"); maxGap = _maxGap; emit MaxGapSet(_maxGap); }
    function setAdmin(address _admin) external onlyAdmin { require(_admin != address(0), "zero"); admin = _admin; emit AdminSet(_admin); }
}
