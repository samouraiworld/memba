// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Minimal interfaces for the deployed protocols the fork tests call. Declared here on purpose:
// the tests exercise the bytecode already on Base, never a vendored copy of its source.

enum Operation {
    Call,
    DelegateCall
}

// ── Safe 1.5.0 ────────────────────────────────────────────────────────────
interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
    function nonce() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
    function execTransactionFromModule(address to, uint256 value, bytes memory data, Operation operation)
        external
        returns (bool success);
    function addOwnerWithThreshold(address owner, uint256 _threshold) external;
    function VERSION() external view returns (string memory);
}

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

// CompatibilityFallbackHandler, reached through the Safe's fallback.
interface ISafeMessages {
    function getMessageHashForSafe(address safe, bytes memory message) external view returns (bytes32);
    function isValidSignature(bytes32 _dataHash, bytes calldata _signature) external view returns (bytes4);
}

interface IMultiSend {
    function multiSend(bytes memory transactions) external payable;
}

// ── Safe AllowanceModule v1.0.0 ──────────────────────────────────────────
interface IAllowanceModule {
    function addDelegate(address delegate) external;
    function setAllowance(
        address delegate,
        address token,
        uint96 allowanceAmount,
        uint16 resetTimeMin,
        uint32 resetBaseMin
    ) external;
    function executeAllowanceTransfer(
        address safe,
        address token,
        address payable to,
        uint96 amount,
        address paymentToken,
        uint96 payment,
        address delegate,
        bytes memory signature
    ) external;
    function getTokenAllowance(address safe, address delegate, address token) external view returns (uint256[5] memory);
}

// ── Zodiac ────────────────────────────────────────────────────────────────
interface IModuleProxyFactory {
    function deployModule(address masterCopy, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

enum RolesParameterType {
    None,
    Static,
    Dynamic,
    Tuple,
    Array,
    Calldata,
    AbiEncoded
}

enum RolesExecutionOptions {
    None,
    Send,
    DelegateCall,
    Both
}

struct ConditionFlat {
    uint8 parent;
    RolesParameterType paramType;
    uint8 operator; // Roles v2 Operator enum: 0 Pass, 5 Matches, 28 WithinAllowance
    bytes compValue;
}

interface IRoles {
    function setUp(bytes memory initParams) external;
    function assignRoles(address module, bytes32[] calldata roleKeys, bool[] calldata memberOf) external;
    function scopeTarget(bytes32 roleKey, address targetAddress) external;
    function scopeFunction(
        bytes32 roleKey,
        address targetAddress,
        bytes4 selector,
        ConditionFlat[] memory conditions,
        RolesExecutionOptions options
    ) external;
    function setAllowance(
        bytes32 key,
        uint128 balance,
        uint128 maxRefill,
        uint128 refill,
        uint64 period,
        uint64 timestamp
    ) external;
    function execTransactionWithRole(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        bytes32 roleKey,
        bool shouldRevert
    ) external returns (bool success);
    function allowances(bytes32 key)
        external
        view
        returns (uint128 refill, uint128 maxRefill, uint64 period, uint128 balance, uint64 timestamp);
}

// ── Aragon OSx 1.4.0 ─────────────────────────────────────────────────────
interface IPluginRepo {
    function latestRelease() external view returns (uint8);
    function buildCount(uint8 release) external view returns (uint256);
}

struct AragonVersionTag {
    uint8 release;
    uint16 build;
}

struct AragonPluginSetupRef {
    AragonVersionTag versionTag;
    address pluginSetupRepo;
}

struct AragonDAOSettings {
    address trustedForwarder;
    string daoURI;
    string subdomain;
    bytes metadata;
}

struct AragonPluginSettings {
    AragonPluginSetupRef pluginSetupRef;
    bytes data;
}

struct AragonPermission {
    uint8 operation;
    address where;
    address who;
    address condition;
    bytes32 permissionId;
}

struct AragonPreparedSetupData {
    address[] helpers;
    AragonPermission[] permissions;
}

struct AragonInstalledPlugin {
    address plugin;
    AragonPreparedSetupData preparedSetupData;
}

interface IDAOFactory {
    function createDao(AragonDAOSettings calldata daoSettings, AragonPluginSettings[] calldata pluginSettings)
        external
        returns (address createdDao, AragonInstalledPlugin[] memory installedPlugins);
    function protocolVersion() external view returns (uint8[3] memory);
}

struct AragonAction {
    address to;
    uint256 value;
    bytes data;
}

struct AragonMultisigSettings {
    bool onlyListed;
    uint16 minApprovals;
}

struct AragonTargetConfig {
    address target;
    uint8 operation;
}

interface IAragonMultisig {
    function createProposal(
        bytes calldata metadata,
        AragonAction[] calldata actions,
        uint256 allowFailureMap,
        bool approveProposal,
        bool tryExecution,
        uint64 startDate,
        uint64 endDate
    ) external returns (uint256 proposalId);
    function approve(uint256 proposalId, bool tryExecution) external;
    function execute(uint256 proposalId) external;
    function canExecute(uint256 proposalId) external view returns (bool);
    function isMember(address account) external view returns (bool);
}

struct AragonVotingSettings {
    uint8 votingMode; // 0 Standard, 1 EarlyExecution, 2 VoteReplacement
    uint32 supportThreshold;
    uint32 minParticipation;
    uint64 minDuration;
    uint256 minProposerVotingPower;
}

struct AragonTokenSettings {
    address addr;
    string name;
    string symbol;
}

struct AragonMintSettingsV13 {
    address[] receivers;
    uint256[] amounts;
}

struct AragonMintSettingsV14 {
    address[] receivers;
    uint256[] amounts;
    bool ensureDelegationOnMint;
}

interface IAragonTokenVoting {
    function getVotingToken() external view returns (address);
    function totalVotingPower(uint256 blockNumber) external view returns (uint256);
    function supportThreshold() external view returns (uint32);
}

interface IVotesToken {
    function getVotes(address account) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

// ── Snapshot X ───────────────────────────────────────────────────────────
struct SxStrategy {
    address addr;
    bytes params;
}

struct SxIndexedStrategy {
    uint8 index;
    bytes params;
}

struct SxInitializeCalldata {
    address owner;
    uint32 votingDelay;
    uint32 minVotingDuration;
    uint32 maxVotingDuration;
    SxStrategy proposalValidationStrategy;
    string proposalValidationStrategyMetadataURI;
    string daoURI;
    string metadataURI;
    SxStrategy[] votingStrategies;
    string[] votingStrategyMetadataURIs;
    address[] authenticators;
}

struct SxUpdateSettingsCalldata {
    uint32 minVotingDuration;
    uint32 maxVotingDuration;
    uint32 votingDelay;
    string metadataURI;
    string daoURI;
    SxStrategy proposalValidationStrategy;
    string proposalValidationStrategyMetadataURI;
    address[] authenticatorsToAdd;
    address[] authenticatorsToRemove;
    SxStrategy[] votingStrategiesToAdd;
    string[] votingStrategyMetadataURIsToAdd;
    uint8[] votingStrategiesToRemove;
}

struct SxMetaTransaction {
    address to;
    uint256 value;
    bytes data;
    Operation operation;
    uint256 salt;
}

struct SxWhitelistMember {
    address addr;
    uint96 vp;
}

interface ISxProxyFactory {
    function deployProxy(address implementation, bytes memory initializer, uint256 saltNonce) external;
    function predictProxyAddress(address implementation, bytes32 salt) external view returns (address);
}

interface ISxSpace {
    function initialize(SxInitializeCalldata calldata input) external;
    function updateSettings(SxUpdateSettingsCalldata calldata input) external;
    function execute(uint256 proposalId, bytes calldata executionPayload) external;
    function getProposalStatus(uint256 proposalId) external view returns (uint8);
    function nextProposalId() external view returns (uint256);
    function nextVotingStrategyIndex() external view returns (uint8);
    function owner() external view returns (address);
}

interface ISxAuthenticator {
    function authenticate(address target, bytes4 functionSelector, bytes memory data) external;
}

interface ISxAvatarExecutionStrategy {
    function setUp(bytes memory initParams) external;
    function setQuorum(uint256 quorum) external;
    function quorum() external view returns (uint256);
    function owner() external view returns (address);
}

// ── Uniswap CCA v2.1.0 ───────────────────────────────────────────────────
struct CcaAuctionParameters {
    address currency;
    address tokensRecipient;
    address fundsRecipient;
    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock;
    uint256 tickSpacing;
    address validationHook;
    uint256 floorPrice;
    uint128 requiredCurrencyRaised;
    bytes auctionStepsData;
}

interface ICcaFactory {
    function create(address token, uint256 amount, bytes calldata configData, bytes32 salt)
        external
        returns (address distributor);
    function getAddress(address token, uint256 amount, bytes calldata configData, bytes32 salt, address sender)
        external
        view
        returns (address);
    function protocolFeeController() external view returns (address);
}

interface ICcaAuction {
    function onTokensReceived() external;
    function submitBid(uint256 maxPriceQ96, uint128 amount, address owner, uint256 prevTickPriceQ96, bytes calldata)
        external
        payable
        returns (uint256 bidId);
    function checkpoint() external;
    function clearingPrice() external view returns (uint256);
    function isGraduated() external view returns (bool);
    function exitBid(uint256 bidId) external;
    function claimTokens(uint256 bidId) external;
    function sweepCurrency() external;
    function sweepUnsoldTokens() external;
    function currencyRaised() external view returns (uint256);
    function totalCleared() external view returns (uint256);
    function MAX_BID_PRICE() external view returns (uint256);
}

// ── EAS ──────────────────────────────────────────────────────────────────
struct EasAttestationRequestData {
    address recipient;
    uint64 expirationTime;
    bool revocable;
    bytes32 refUID;
    bytes data;
    uint256 value;
}

struct EasAttestationRequest {
    bytes32 schema;
    EasAttestationRequestData data;
}

struct EasAttestation {
    bytes32 uid;
    bytes32 schema;
    uint64 time;
    uint64 expirationTime;
    uint64 revocationTime;
    bytes32 refUID;
    address recipient;
    address attester;
    bool revocable;
    bytes data;
}

interface ISchemaRegistry {
    function register(string calldata schema, address resolver, bool revocable) external returns (bytes32);
}

interface IEAS {
    function attest(EasAttestationRequest calldata request) external payable returns (bytes32);
    function getAttestation(bytes32 uid) external view returns (EasAttestation memory);
    function version() external view returns (string memory);
}

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function totalSupply() external view returns (uint256);
}
