// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MultiSigWallet
/// @notice 极简 N-of-M 多签，用作 Argus 的 Creator funds wallet。
///         Safe{Wallet} 若尚未支持 Arc，用这个替代：只有它能决定
///         「多少 creator share 进团队钱包 / 多少 donate() 进 SubsidyPool」。
/// @dev 无升级、无 delegatecall、无自毁。交易按 nonce 顺序执行。
contract MultiSigWallet {
    uint256 public required;
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public txCount;
    uint256 public constant MAX_OWNERS = 10;

    struct Tx {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }
    mapping(uint256 => Tx) public txs;
    mapping(uint256 => mapping(address => bool)) public approved;
    mapping(uint256 => uint256) public approvals;

    event Submitted(uint256 indexed txId, address indexed submitter, address to, uint256 value, bytes data);
    event Approved(uint256 indexed txId, address indexed owner);
    event Revoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Received(address indexed from, uint256 amount);

    modifier onlyOwner() { require(isOwner[msg.sender], "not owner"); _; }
    modifier txExists(uint256 id) { require(id < txCount, "no such tx"); _; }
    modifier notExecuted(uint256 id) { require(!txs[id].executed, "already executed"); _; }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0 && _owners.length <= MAX_OWNERS, "bad owner count");
        require(_required > 0 && _required <= _owners.length, "bad threshold");
        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            require(o != address(0) && !isOwner[o], "bad owner");
            isOwner[o] = true;
            owners.push(o);
        }
        required = _required;
    }

    receive() external payable { emit Received(msg.sender, msg.value); }

    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = txCount++;
        txs[id] = Tx({ to: to, value: value, data: data, executed: false });
        emit Submitted(id, msg.sender, to, value, data);
    }

    function approve(uint256 id) external onlyOwner txExists(id) notExecuted(id) {
        require(!approved[id][msg.sender], "already approved");
        approved[id][msg.sender] = true;
        approvals[id] += 1;
        emit Approved(id, msg.sender);
    }

    function revoke(uint256 id) external onlyOwner txExists(id) notExecuted(id) {
        require(approved[id][msg.sender], "not approved");
        approved[id][msg.sender] = false;
        approvals[id] -= 1;
        emit Revoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner txExists(id) notExecuted(id) {
        require(approvals[id] >= required, "not enough approvals");
        Tx storage t = txs[id];
        t.executed = true;
        (bool ok, bytes memory ret) = t.to.call{ value: t.value }(t.data);
        require(ok, "call failed");
        if (ret.length > 0) assembly { revert(add(ret, 32), mload(ret)) }
        emit Executed(id);
    }

    function ownersList() external view returns (address[] memory) { return owners; }

    /// @notice 便捷：构造 ERC20 approve 的 calldata（给 SubsidyPool 授权 USDC）
    function erc20ApproveCalldata(address /* token */, address spender, uint256 amount) external pure returns (bytes memory) {
        return abi.encodeWithSelector(0x095ea7b3, spender, amount);
    }
}
