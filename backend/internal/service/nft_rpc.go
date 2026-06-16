package service

import (
	"context"
	"database/sql"
	"strings"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// u64 converts a non-negative on-chain amount (ugnot price/volume, supply, count)
// to uint64 for the proto. These are non-negative by construction on-chain, so the
// conversion cannot overflow; the guard makes that explicit for static analysis.
func u64(v int64) uint64 {
	if v < 0 {
		return 0
	}
	return uint64(v) // #nosec G115 -- guarded non-negative; on-chain amounts are >= 0
}

// GetNFTCollection returns cached collection stats for a collection.
// Public read — no auth. Values come from the NFT indexer cache; floor/listings
// may be 0 when the marketplace home route is unreachable (known test13 quirk).
func (s *MultisigService) GetNFTCollection(ctx context.Context, req *connect.Request[membav1.GetNFTCollectionRequest]) (*connect.Response[membav1.GetNFTCollectionResponse], error) {
	colID := strings.TrimSpace(req.Msg.CollectionId)
	if colID == "" || len(colID) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	var (
		name, symbol                              sql.NullString
		supply, royalty, floor, vol, sales, lists sql.NullInt64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT name, symbol, supply, royalty_bps, floor_price_ugnot,
		       total_volume_ugnot, total_sales, active_listings
		FROM nft_collections WHERE collection_id = ?`, colID,
	).Scan(&name, &symbol, &supply, &royalty, &floor, &vol, &sales, &lists)
	if err == sql.ErrNoRows {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err != nil {
		return nil, internalError("GetNFTCollection", err)
	}

	return connect.NewResponse(&membav1.GetNFTCollectionResponse{
		Name:             name.String,
		Symbol:           symbol.String,
		Supply:           u64(supply.Int64),
		FloorPriceUgnot:  u64(floor.Int64),
		TotalVolumeUgnot: u64(vol.Int64),
		TotalSales:       u64(sales.Int64),
		ActiveListings:   u64(lists.Int64),
		RoyaltyBps:       u64(royalty.Int64),
	}), nil
}

// GetNFTActivity returns recent cached marketplace activity (sales) for a
// collection, newest first. Public read — no auth.
func (s *MultisigService) GetNFTActivity(ctx context.Context, req *connect.Request[membav1.GetNFTActivityRequest]) (*connect.Response[membav1.GetNFTActivityResponse], error) {
	colID := strings.TrimSpace(req.Msg.CollectionId)
	if colID == "" || len(colID) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	limit := req.Msg.Limit
	if limit == 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT sale_no, token_id, kind, price_ugnot, seller, buyer, created_at
		FROM nft_activity WHERE collection_id = ?
		ORDER BY sale_no DESC LIMIT ?`, colID, limit,
	)
	if err != nil {
		return nil, internalError("GetNFTActivity", err)
	}
	defer func() { _ = rows.Close() }()

	var items []*membav1.NFTActivity
	for rows.Next() {
		var (
			saleNo, price                           sql.NullInt64
			tokenID, kind, seller, buyer, createdAt sql.NullString
		)
		if err := rows.Scan(&saleNo, &tokenID, &kind, &price, &seller, &buyer, &createdAt); err != nil {
			return nil, internalError("GetNFTActivity/scan", err)
		}
		items = append(items, &membav1.NFTActivity{
			SaleNo:     u64(saleNo.Int64),
			TokenId:    tokenID.String,
			Kind:       kind.String,
			PriceUgnot: u64(price.Int64),
			Seller:     seller.String,
			Buyer:      buyer.String,
			CreatedAt:  createdAt.String,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, internalError("GetNFTActivity/rows", err)
	}

	return connect.NewResponse(&membav1.GetNFTActivityResponse{Items: items}), nil
}

// GetNFTPortfolio returns all cached tokens owned by an address (across
// collections). Public read — no auth.
func (s *MultisigService) GetNFTPortfolio(ctx context.Context, req *connect.Request[membav1.GetNFTPortfolioRequest]) (*connect.Response[membav1.GetNFTPortfolioResponse], error) {
	owner := strings.TrimSpace(req.Msg.Owner)
	if owner == "" || len(owner) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT collection_id, token_id, owner, uri, listed, price_ugnot
		FROM nft_tokens WHERE owner = ?
		ORDER BY collection_id, token_id`, owner,
	)
	if err != nil {
		return nil, internalError("GetNFTPortfolio", err)
	}
	defer func() { _ = rows.Close() }()

	tokens, err := scanTokens(rows)
	if err != nil {
		return nil, internalError("GetNFTPortfolio/scan", err)
	}

	return connect.NewResponse(&membav1.GetNFTPortfolioResponse{Tokens: tokens}), nil
}

// ListNFTTokens returns cached tokens for a collection, optionally only listed
// ones. Public read — no auth.
func (s *MultisigService) ListNFTTokens(ctx context.Context, req *connect.Request[membav1.ListNFTTokensRequest]) (*connect.Response[membav1.ListNFTTokensResponse], error) {
	colID := strings.TrimSpace(req.Msg.CollectionId)
	if colID == "" || len(colID) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	query := `
		SELECT collection_id, token_id, owner, uri, listed, price_ugnot
		FROM nft_tokens WHERE collection_id = ?`
	if req.Msg.ListedOnly {
		query += ` AND listed = 1`
	}
	query += ` ORDER BY token_id`

	rows, err := s.db.QueryContext(ctx, query, colID)
	if err != nil {
		return nil, internalError("ListNFTTokens", err)
	}
	defer func() { _ = rows.Close() }()

	tokens, err := scanTokens(rows)
	if err != nil {
		return nil, internalError("ListNFTTokens/scan", err)
	}

	return connect.NewResponse(&membav1.ListNFTTokensResponse{Tokens: tokens}), nil
}

// scanTokens maps token rows (collection_id, token_id, owner, uri, listed,
// price_ugnot) into proto NFTToken values.
func scanTokens(rows *sql.Rows) ([]*membav1.NFTToken, error) {
	var tokens []*membav1.NFTToken
	for rows.Next() {
		var (
			colID, tokenID, owner, uri sql.NullString
			listed                     int64
			price                      sql.NullInt64
		)
		if err := rows.Scan(&colID, &tokenID, &owner, &uri, &listed, &price); err != nil {
			return nil, err
		}
		tokens = append(tokens, &membav1.NFTToken{
			CollectionId: colID.String,
			TokenId:      tokenID.String,
			Owner:        owner.String,
			Uri:          uri.String,
			Listed:       listed != 0,
			PriceUgnot:   u64(price.Int64),
		})
	}
	return tokens, rows.Err()
}
