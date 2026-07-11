package indexer

import (
	"context"
	"database/sql"
	"log/slog"
	"strconv"

	"github.com/samouraiworld/memba/backend/internal/metrics"
)

// atoiSafe parses a base-10 integer attribute, returning 0 on any error. Event
// amounts (price/fee/royalty) are non-negative decimal strings emitted via
// strconv.Itoa on-chain, so failure means a missing/garbage attr → treat as 0.
// NOTE: for the canonical Sale money-path, use atoiStrict instead — a silent 0
// there corrupts volume/floor/points and is indistinguishable from a real zero.
func atoiSafe(s string) int64 {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// atoiStrict parses a REQUIRED base-10 integer attribute. ok=false when the attr
// is missing or not a valid integer, so the caller can reject a malformed event
// rather than silently substituting 0 (audit F2). A present "0" parses fine.
func atoiStrict(s string) (v int64, ok bool) {
	v, err := strconv.ParseInt(s, 10, 64)
	return v, err == nil
}

// validVia reports whether a Sale event's "via" is one of the canonical kinds
// the engines emit. The indexer keys analytics on `kind`, so an unknown/empty
// via would silently skew queries that filter on it.
func validVia(via string) bool {
	switch via {
	case "buy", "offer", "auction", "sweep":
		return true
	default:
		return false
	}
}

// firstAttr returns the first non-empty attribute among keys. The v2 realms and
// the v3 registry (memba_collections) use DIFFERENT attribute names for the same
// concept — e.g. v2 emits "collection"/"to" while v3 emits "collectionID"/"minter".
// Reading tolerantly keeps one handler correct for both engines and resilient to
// future drift (audit F12).
func firstAttr(ev GnoEvent, keys ...string) string {
	for _, k := range keys {
		if v := ev.Attr(k); v != "" {
			return v
		}
	}
	return ""
}

// dispatchEvent applies a single normalized GnoEvent to the database. It
// delegates to dispatchEventScoped with an empty saleVolumeRealms set, which
// preserves the legacy behavior (OfferAccepted and PurchaseConfirmed both write
// volume rows). All existing callers and tests use this signature unchanged.
//
// blockHash is the block-level hash threaded from the tailer; pass "" when
// unavailable (e.g. legacy callers — Task 6 wires the real per-height value).
func dispatchEvent(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string) error {
	return dispatchEventScoped(ctx, db, ev, blockHash, nil)
}

// dispatchEventScoped applies a single normalized GnoEvent to the database,
// with engine-scoped volume-counting. Writes are idempotent: event-keyed tables
// use INSERT OR IGNORE on (event_block, event_tx_index, event_index), so
// re-processing a block is a no-op. Unknown event types are ignored. Returns an
// error only on a real DB failure (the caller logs and continues).
//
// saleVolumeRealms is the set of pkg_paths whose volume must come from Sale
// events only (v3+ engines). For events whose PkgPath is in this set:
//   - OfferAccepted: resolves the offer (metadata) but does NOT write a sale row
//     or bump collection aggregates — Sale already wrote the volume row.
//   - PurchaseConfirmed: no-op (Sale already wrote the volume row).
//
// When saleVolumeRealms is nil or empty (legacy callers / v2 engines not in the
// set), OfferAccepted and PurchaseConfirmed behave as before and write volume.
func dispatchEventScoped(ctx context.Context, db *sql.DB, ev GnoEvent, blockHash string, saleVolumeRealms map[string]struct{}) error {
	// Raw ledger first — the immutable source of truth. Idempotent; a later
	// projection failure is recoverable by rebuild-from-raw.
	if err := recordRawEvent(ctx, db, ev, blockHash); err != nil {
		return err
	}

	_, inSaleSet := saleVolumeRealms[ev.PkgPath]

	switch ev.Type {
	case "NFTListed":
		return applyNFTListed(ctx, db, ev)
	case "NFTDelisted", "AdminDelisted":
		return applyNFTDelisted(ctx, db, ev)
	case "PurchaseConfirmed":
		if inSaleSet {
			// Sale already wrote the volume row for this engine — skip.
			return nil
		}
		return applyPurchaseConfirmed(ctx, db, ev)
	case "OfferMade":
		return applyOfferMade(ctx, db, ev)
	case "OfferCancelled":
		return applyOfferResolved(ctx, db, ev, "cancelled")
	case "OfferExpiredClaimed":
		return applyOfferResolved(ctx, db, ev, "expired")
	case "OfferAccepted":
		if inSaleSet {
			// Metadata-only: resolve the offer without writing a sale row or
			// bumping aggregates (Sale already recorded volume for this engine).
			return applyOfferResolved(ctx, db, ev, "accepted")
		}
		return applyOfferAccepted(ctx, db, ev)
	case "Sale":
		return applySale(ctx, db, ev)
	case "MarketTransfer":
		return applyMarketTransfer(ctx, db, ev)
	case "Mint":
		return applyMint(ctx, db, ev)
	case "MintPublic", "MintAllowlist":
		// Launchpad paid mints (memba_collections): same projection as the
		// admin Mint. These events carry no "to" attr — the minter receives —
		// which applyMint already covers via its firstAttr("to", "minter").
		return applyMint(ctx, db, ev)
	case "CollectionCreated":
		return applyCollectionCreated(ctx, db, ev)
	case "RoyaltyChanged", "RoyaltySet":
		return applyRoyaltyChanged(ctx, db, ev)
	case "TokenSold":
		// Covered by PurchaseConfirmed / OfferAccepted — intentionally skipped.
		return nil
	default:
		// Unwatched event type (pauses, market registration, fee changes, …).
		return nil
	}
}

// recomputeFloor sets nft_collections.floor_price_ugnot to the min price among
// currently-listed tokens (NULL when none). Runs inside the caller's tx.
func recomputeFloor(ctx context.Context, tx *sql.Tx, colID string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE nft_collections
		SET floor_price_ugnot = (
			SELECT MIN(price_ugnot) FROM nft_tokens
			WHERE collection_id = ? AND listed = 1 AND price_ugnot IS NOT NULL
		),
		updated_at = CURRENT_TIMESTAMP
		WHERE collection_id = ?`, colID, colID)
	return err
}

// ensureCollection inserts a stub nft_collections row if absent so floor/last
// sale updates have a target (events can precede metadata polling).
func ensureCollection(ctx context.Context, tx *sql.Tx, colID string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_collections (collection_id, updated_at)
		VALUES (?, CURRENT_TIMESTAMP)`, colID)
	return err
}

func applyNFTListed(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	seller := ev.Attr("seller")
	price := atoiSafe(ev.Attr("price"))

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_listings
			(collection_id, token_id, seller, price_ugnot, listed_at_block,
			 event_block, event_tx_index, event_index)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		col, tok, seller, price, ev.Block, ev.Block, ev.TxIndex, ev.EventIdx,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_tokens (collection_id, token_id, listed, price_ugnot, listing_seller, updated_at)
		VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id, token_id) DO UPDATE SET
			listed = 1, price_ugnot = excluded.price_ugnot,
			listing_seller = excluded.listing_seller, updated_at = CURRENT_TIMESTAMP`,
		col, tok, price, seller,
	); err != nil {
		return err
	}

	if err := ensureCollection(ctx, tx, col); err != nil {
		return err
	}
	if err := recomputeFloor(ctx, tx, col); err != nil {
		return err
	}
	return tx.Commit()
}

func applyNFTDelisted(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	reason := "delisted"
	if ev.Type == "AdminDelisted" {
		reason = "admin"
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Close the open listing for this token (idempotent: only updates open ones).
	if _, err := tx.ExecContext(ctx, `
		UPDATE nft_listings SET delisted_at_block = ?, delisted_reason = ?
		WHERE collection_id = ? AND token_id = ? AND delisted_at_block IS NULL`,
		ev.Block, reason, col, tok,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE nft_tokens SET listed = 0, price_ugnot = NULL, listing_seller = NULL,
			updated_at = CURRENT_TIMESTAMP
		WHERE collection_id = ? AND token_id = ?`, col, tok,
	); err != nil {
		return err
	}

	if err := ensureCollection(ctx, tx, col); err != nil {
		return err
	}
	if err := recomputeFloor(ctx, tx, col); err != nil {
		return err
	}
	return tx.Commit()
}

func applyPurchaseConfirmed(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	seller := ev.Attr("seller")
	buyer := ev.Attr("buyer")
	price := atoiSafe(ev.Attr("price"))
	fee := atoiSafe(ev.Attr("fee"))
	royalty := atoiSafe(ev.Attr("royalty"))

	return settleSale(ctx, db, ev, col, tok, seller, buyer, price, fee, royalty, "sale")
}

func applyOfferMade(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	buyer := ev.Attr("buyer")
	amount := atoiSafe(ev.Attr("amount"))

	_, err := db.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_offers
			(collection_id, token_id, buyer, amount_ugnot, created_block, status,
			 pkg_path, schema_version, event_block, event_tx_index, event_index)
		VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
		col, tok, buyer, amount, ev.Block, ev.PkgPath, ev.Attr("schemaVersion"),
		ev.Block, ev.TxIndex, ev.EventIdx,
	)
	return err
}

func applyOfferResolved(ctx context.Context, db *sql.DB, ev GnoEvent, status string) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	buyer := ev.Attr("buyer")

	// Resolve the most recent active offer from this buyer for this token.
	_, err := db.ExecContext(ctx, `
		UPDATE nft_offers SET status = ?, resolved_block = ?
		WHERE id = (
			SELECT id FROM nft_offers
			WHERE collection_id = ? AND token_id = ? AND buyer = ? AND status = 'active'
			ORDER BY created_block DESC LIMIT 1
		)`,
		status, ev.Block, col, tok, buyer,
	)
	return err
}

func applyOfferAccepted(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	seller := ev.Attr("seller")
	buyer := ev.Attr("buyer")
	amount := atoiSafe(ev.Attr("amount"))
	fee := atoiSafe(ev.Attr("fee"))
	royalty := atoiSafe(ev.Attr("royalty"))

	if err := settleSale(ctx, db, ev, col, tok, seller, buyer, amount, fee, royalty, "offer"); err != nil {
		return err
	}
	// Mark the accepted offer resolved (best-effort; separate tx is fine — it's
	// idempotent and the sale row is the source of truth for activity).
	_, err := db.ExecContext(ctx, `
		UPDATE nft_offers SET status = 'accepted', resolved_block = ?
		WHERE id = (
			SELECT id FROM nft_offers
			WHERE collection_id = ? AND token_id = ? AND buyer = ? AND status = 'active'
			ORDER BY created_block DESC LIMIT 1
		)`,
		ev.Block, col, tok, buyer,
	)
	return err
}

// applySale ingests the canonical v3+ settlement event (one Sale per sale, keyed
// by `via`). Volume is counted HERE for Sale-volume engines (see
// dispatchEventScoped): their companion OfferAccepted/PurchaseConfirmed events
// are metadata-only and do not write a second sale row. Legacy v2 engines (not
// in saleVolumeRealms) still source volume from OfferAccepted/PurchaseConfirmed.
func applySale(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	seller := ev.Attr("seller")
	buyer := ev.Attr("buyer")
	via := ev.Attr("via") // "buy" | "offer" | "auction" | "sweep"
	price, priceOK := atoiStrict(ev.Attr("price"))
	fee, feeOK := atoiStrict(ev.Attr("fee"))
	royalty, royaltyOK := atoiStrict(ev.Attr("royalty"))

	// Reject a malformed Sale rather than silently writing a bad `kind` or zeroed
	// amounts (audit F2). The raw event is already persisted by recordRawEvent, so
	// it's recoverable; the warning is the operator signal that schema drift hit.
	if !validVia(via) || col == "" || tok == "" || seller == "" || buyer == "" || !priceOK || !feeOK || !royaltyOK {
		metrics.NFTEventDropped.WithLabelValues("Sale").Inc()
		slog.Warn("indexer: skipping malformed Sale event",
			"pkg", ev.PkgPath, "block", ev.Block, "tx", ev.TxIndex, "idx", ev.EventIdx,
			"via", via, "collection", col, "tokenId", tok,
			"hasSeller", seller != "", "hasBuyer", buyer != "",
			"priceOK", priceOK, "feeOK", feeOK, "royaltyOK", royaltyOK)
		return nil
	}
	if err := settleSale(ctx, db, ev, col, tok, seller, buyer, price, fee, royalty, via); err != nil {
		return err
	}
	// v3 AcceptOffer emits only Sale(via="offer") — no separate OfferAccepted —
	// so resolve the buyer's active offer here, else it lingers as a phantom
	// 'active' offer on an already-sold token (audit F13).
	if via == "offer" {
		return applyOfferResolved(ctx, db, ev, "accepted")
	}
	return nil
}

// settleSale records a sale (purchase or accepted offer): inserts nft_sales,
// closes any open listing, updates token ownership + collection volume/last
// sale, writes ownership history, and recomputes the floor — all in one tx.
func settleSale(ctx context.Context, db *sql.DB, ev GnoEvent, col, tok, seller, buyer string, price, fee, royalty int64, kind string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO nft_sales
			(collection_id, token_id, seller, buyer, price_ugnot, fee_ugnot, royalty_ugnot,
			 sale_block, kind, pkg_path, schema_version, event_block, event_tx_index, event_index)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		col, tok, seller, buyer, price, fee, royalty, ev.Block, kind,
		ev.PkgPath, ev.Attr("schemaVersion"),
		ev.Block, ev.TxIndex, ev.EventIdx,
	)
	if err != nil {
		return err
	}
	inserted, err := res.RowsAffected()
	if err != nil {
		return err
	}
	// Already processed (idempotent replay) — stop before mutating aggregates.
	if inserted == 0 {
		return tx.Commit()
	}

	// Close the open listing for this token.
	if _, err := tx.ExecContext(ctx, `
		UPDATE nft_listings SET delisted_at_block = ?, delisted_reason = 'sold'
		WHERE collection_id = ? AND token_id = ? AND delisted_at_block IS NULL`,
		ev.Block, col, tok,
	); err != nil {
		return err
	}

	// Update token: new owner, clear listing state.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_tokens (collection_id, token_id, owner, listed, price_ugnot, listing_seller, updated_at)
		VALUES (?, ?, ?, 0, NULL, NULL, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id, token_id) DO UPDATE SET
			owner = excluded.owner, listed = 0, price_ugnot = NULL,
			listing_seller = NULL, updated_at = CURRENT_TIMESTAMP`,
		col, tok, buyer,
	); err != nil {
		return err
	}

	// Ownership history.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_ownership_history (collection_id, token_id, from_addr, to_addr, block, kind)
		VALUES (?, ?, ?, ?, ?, ?)`,
		col, tok, seller, buyer, ev.Block, kind,
	); err != nil {
		return err
	}

	// Collection aggregates: bump volume + sales, set last sale price.
	if err := ensureCollection(ctx, tx, col); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE nft_collections SET
			total_volume_ugnot = COALESCE(total_volume_ugnot, 0) + ?,
			total_sales = COALESCE(total_sales, 0) + 1,
			last_sale_price_ugnot = ?,
			updated_at = CURRENT_TIMESTAMP
		WHERE collection_id = ?`,
		price, price, col,
	); err != nil {
		return err
	}

	if err := recomputeFloor(ctx, tx, col); err != nil {
		return err
	}
	return tx.Commit()
}

func applyMarketTransfer(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	from := ev.Attr("from")
	to := ev.Attr("to")

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_ownership_history (collection_id, token_id, from_addr, to_addr, block, kind)
		VALUES (?, ?, ?, ?, ?, 'transfer')`,
		col, tok, from, to, ev.Block,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_tokens (collection_id, token_id, owner, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id, token_id) DO UPDATE SET
			owner = excluded.owner, updated_at = CURRENT_TIMESTAMP`,
		col, tok, to,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func applyMint(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	tok := ev.Attr("tokenId")
	to := firstAttr(ev, "to", "minter")

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_tokens (collection_id, token_id, owner, minted_block, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id, token_id) DO UPDATE SET
			owner = excluded.owner,
			minted_block = COALESCE(nft_tokens.minted_block, excluded.minted_block),
			updated_at = CURRENT_TIMESTAMP`,
		col, tok, to, ev.Block,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO nft_ownership_history (collection_id, token_id, from_addr, to_addr, block, kind)
		VALUES (?, ?, '', ?, ?, 'mint')`,
		col, tok, to, ev.Block,
	); err != nil {
		return err
	}

	if err := ensureCollection(ctx, tx, col); err != nil {
		return err
	}
	return tx.Commit()
}

func applyCollectionCreated(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	name := ev.Attr("name")
	symbol := ev.Attr("symbol")
	royalty := atoiSafe(firstAttr(ev, "royaltyBPS", "bps"))

	_, err := db.ExecContext(ctx, `
		INSERT INTO nft_collections (collection_id, name, symbol, royalty_bps, updated_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id) DO UPDATE SET
			name = excluded.name, symbol = excluded.symbol,
			royalty_bps = excluded.royalty_bps, updated_at = CURRENT_TIMESTAMP`,
		col, name, symbol, royalty,
	)
	return err
}

func applyRoyaltyChanged(ctx context.Context, db *sql.DB, ev GnoEvent) error {
	col := firstAttr(ev, "collection", "collectionID")
	royalty := atoiSafe(firstAttr(ev, "royaltyBPS", "bps"))

	_, err := db.ExecContext(ctx, `
		INSERT INTO nft_collections (collection_id, royalty_bps, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(collection_id) DO UPDATE SET
			royalty_bps = excluded.royalty_bps, updated_at = CURRENT_TIMESTAMP`,
		col, royalty,
	)
	return err
}
