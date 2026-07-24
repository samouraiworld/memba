// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import { MembaUpgradeAuthority } from "../lib/MembaUpgradeAuthority.sol";

/**
 * @title MembaReviews
 * @author Samouraï Coop
 * @notice Subject-agnostic reputation/rating engine. Users post reviews (1-5 stars),
 *         react (like/dislike), comment, and flag for moderation.
 *         Port of the Gno `memba_reviews_v1` realm.
 */
contract MembaReviews is UUPSUpgradeable, PausableUpgradeable, MembaUpgradeAuthority {
    // ── Structs
    // ───────────────────────────────────────────────────
    struct Review {
        uint256 id;
        string subject;
        address author;
        uint8 rating;
        string body;
        uint256 createdAt;
        uint256 editedAt;
        bool deleted;
        uint256 likes;
        uint256 dislikes;
        uint256 flags;
    }

    struct Comment {
        uint256 id;
        uint256 reviewId;
        address author;
        string body;
        uint256 createdAt;
        bool deleted;
    }

    struct SubjectSummary {
        uint256 count;
        uint256 sum;
    }

    // ── Storage (ERC-7201)
    // ────────────────────────────────────────
    /// @custom:storage-location erc7201:memba.storage.MembaReviews
    struct ReviewsStorage {
        address admin;
        uint256 nextReviewId;
        uint256 nextCommentId;
        mapping(uint256 => Review) reviews;
        mapping(uint256 => Comment) comments;
        mapping(bytes32 => uint256[]) subjectReviews;
        mapping(bytes32 => SubjectSummary) summaries;
        mapping(uint256 => mapping(address => bool)) hasReacted;
        mapping(address => uint256) authorReviewCount;
        mapping(address => uint256) lastReviewTime;
        mapping(bytes32 => mapping(address => bool)) hasReviewedSubject;
        uint256 reviewCooldownSec;
    }

    /// @dev keccak256(abi.encode(uint256(keccak256("memba.storage.MembaReviews")) - 1)) & ~bytes32(uint256(0xff))
    /// @dev Asserted against its derivation in test/StorageSlots.t.sol — never edit by hand.
    bytes32 private constant STORAGE_LOCATION = 0x30cddc07d289e84f800efe9a64f93094295b102ef93e43cfea29890d61703f00;

    function _getStorage() private pure returns (ReviewsStorage storage $) {
        bytes32 loc = STORAGE_LOCATION;
        assembly { $.slot := loc }
    }

    // ── Errors
    // ────────────────────────────────────────────────────
    error NotAdmin();
    error NotAuthor();
    error InvalidRating();
    error EmptyBody();
    error AlreadyDeleted();
    error CannotReactOnOwn();
    error AlreadyReacted();
    error ReviewNotFound();
    error InvalidParams();
    error CooldownNotElapsed();
    error AlreadyReviewedSubject();

    // ── Events
    // ────────────────────────────────────────────────────
    event ReviewPosted(uint256 indexed id, string subject, address indexed author, uint8 rating);
    event ReviewEdited(uint256 indexed id, uint8 newRating);
    event ReviewDeleted(uint256 indexed id);
    event Reacted(uint256 indexed reviewId, address indexed reactor, bool isLike);
    event CommentAdded(uint256 indexed commentId, uint256 indexed reviewId, address indexed author);
    event ReviewFlagged(uint256 indexed reviewId, address indexed flagger, string reason);

    modifier onlyAdmin() {
        if (msg.sender != _getStorage().admin) revert NotAdmin();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin) external initializer {
        if (_admin == address(0)) revert InvalidParams();
        __UUPSUpgradeable_init();
        __Pausable_init();
        _getStorage().admin = _admin;
        __MembaUpgradeAuthority_init(_admin);
    }

    // ── Reviews
    // ───────────────────────────────────────────────────

    function postReview(string calldata subject, uint8 rating, string calldata body)
        external
        whenNotPaused
        returns (uint256 id)
    {
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (bytes(body).length == 0) revert EmptyBody();

        ReviewsStorage storage $ = _getStorage();
        bytes32 subjHash_ = keccak256(bytes(subject));

        // Rate limit: one review per subject per author
        if ($.hasReviewedSubject[subjHash_][msg.sender]) revert AlreadyReviewedSubject();

        // Rate limit: global cooldown per author (default 60s, skip first-ever review)
        uint256 lastTime = $.lastReviewTime[msg.sender];
        if (lastTime > 0) {
            uint256 cooldown = $.reviewCooldownSec > 0 ? $.reviewCooldownSec : 60;
            if (block.timestamp - lastTime < cooldown) revert CooldownNotElapsed();
        }

        id = $.nextReviewId++;
        bytes32 subjHash = subjHash_;

        $.reviews[id] = Review({
            id: id,
            subject: subject,
            author: msg.sender,
            rating: rating,
            body: body,
            createdAt: block.timestamp,
            editedAt: 0,
            deleted: false,
            likes: 0,
            dislikes: 0,
            flags: 0
        });

        $.subjectReviews[subjHash].push(id);
        $.summaries[subjHash].count++;
        $.summaries[subjHash].sum += rating;
        $.authorReviewCount[msg.sender]++;
        $.lastReviewTime[msg.sender] = block.timestamp;
        $.hasReviewedSubject[subjHash][msg.sender] = true;

        emit ReviewPosted(id, subject, msg.sender, rating);
    }

    function editReview(uint256 id, uint8 rating, string calldata body) external {
        if (rating < 1 || rating > 5) revert InvalidRating();
        if (bytes(body).length == 0) revert EmptyBody();

        ReviewsStorage storage $ = _getStorage();
        Review storage r = $.reviews[id];
        if (r.author != msg.sender) revert NotAuthor();
        if (r.deleted) revert AlreadyDeleted();

        bytes32 subjHash = keccak256(bytes(r.subject));
        $.summaries[subjHash].sum = $.summaries[subjHash].sum - r.rating + rating;

        r.rating = rating;
        r.body = body;
        r.editedAt = block.timestamp;

        emit ReviewEdited(id, rating);
    }

    function deleteReview(uint256 id) external {
        ReviewsStorage storage $ = _getStorage();
        Review storage r = $.reviews[id];
        if (r.author != msg.sender) revert NotAuthor();
        if (r.deleted) revert AlreadyDeleted();

        r.deleted = true;

        bytes32 subjHash = keccak256(bytes(r.subject));
        $.summaries[subjHash].count--;
        $.summaries[subjHash].sum -= r.rating;

        emit ReviewDeleted(id);
    }

    // ── Reactions
    // ─────────────────────────────────────────────────

    function react(uint256 id, bool isLike) external {
        ReviewsStorage storage $ = _getStorage();
        Review storage r = $.reviews[id];
        if (r.author == address(0)) revert ReviewNotFound();
        if (r.author == msg.sender) revert CannotReactOnOwn();
        if ($.hasReacted[id][msg.sender]) revert AlreadyReacted();

        $.hasReacted[id][msg.sender] = true;
        if (isLike) r.likes++;
        else r.dislikes++;

        emit Reacted(id, msg.sender, isLike);
    }

    // ── Comments
    // ──────────────────────────────────────────────────

    function addComment(uint256 reviewId, string calldata body) external whenNotPaused returns (uint256 commentId) {
        if (bytes(body).length == 0) revert EmptyBody();

        ReviewsStorage storage $ = _getStorage();
        commentId = $.nextCommentId++;

        $.comments[commentId] = Comment({
            id: commentId,
            reviewId: reviewId,
            author: msg.sender,
            body: body,
            createdAt: block.timestamp,
            deleted: false
        });

        emit CommentAdded(commentId, reviewId, msg.sender);
    }

    // ── Flagging
    // ──────────────────────────────────────────────────

    function flag(uint256 id, string calldata reason) external {
        ReviewsStorage storage $ = _getStorage();
        Review storage r = $.reviews[id];
        if (r.author == address(0)) revert ReviewNotFound();
        r.flags++;
        emit ReviewFlagged(id, msg.sender, reason);
    }

    // ── View
    // ──────────────────────────────────────────────────────

    function getReview(uint256 id) external view returns (Review memory) {
        return _getStorage().reviews[id];
    }

    function getSummary(string calldata subject) external view returns (SubjectSummary memory) {
        return _getStorage().summaries[keccak256(bytes(subject))];
    }

    function admin() external view returns (address) {
        return _getStorage().admin;
    }

    function reviewCount() external view returns (uint256) {
        return _getStorage().nextReviewId;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
    function _authorizeUpgrade(address) internal override onlyUpgrader { }
}
