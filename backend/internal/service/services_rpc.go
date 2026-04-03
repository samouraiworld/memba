package service

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

var validCategories = map[string]bool{
	"development": true, "design": true, "writing": true,
	"consulting": true, "marketing": true, "other": true,
}

// CreateServiceListing creates a new freelance service listing.
func (s *MultisigService) CreateServiceListing(ctx context.Context, req *connect.Request[membav1.CreateServiceListingRequest]) (*connect.Response[membav1.CreateServiceListingResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(req.Msg.Title)
	if len(title) == 0 || len(title) > 200 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	desc := strings.TrimSpace(req.Msg.Description)
	if len(desc) > 2000 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	category := strings.TrimSpace(req.Msg.Category)
	if !validCategories[category] {
		category = "other"
	}
	if req.Msg.Price == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	deliveryDays := req.Msg.DeliveryDays
	if deliveryDays == 0 {
		deliveryDays = 7
	}
	tags := strings.TrimSpace(req.Msg.Tags)

	id := uuid.New().String()

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO service_listings (id, address, title, description, category, price, delivery_days, tags)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, userAddr, title, desc, category, req.Msg.Price, deliveryDays, tags,
	)
	if err != nil {
		return nil, internalError("CreateServiceListing", err)
	}

	listing := &membav1.ServiceListing{
		Id: id, Address: userAddr, Title: title, Description: desc,
		Category: category, Price: req.Msg.Price, DeliveryDays: deliveryDays,
		Tags: tags, Active: true,
	}
	return connect.NewResponse(&membav1.CreateServiceListingResponse{Listing: listing}), nil
}

// GetServiceListings returns active service listings, optionally filtered by category.
func (s *MultisigService) GetServiceListings(ctx context.Context, req *connect.Request[membav1.GetServiceListingsRequest]) (*connect.Response[membav1.GetServiceListingsResponse], error) {
	limit := req.Msg.Limit
	if limit == 0 || limit > 100 {
		limit = 50
	}

	query := `SELECT id, address, title, description, category, price, delivery_days, tags, active, created_at, updated_at
		FROM service_listings WHERE active = 1`
	args := []interface{}{}

	if cat := strings.TrimSpace(req.Msg.Category); cat != "" && validCategories[cat] {
		query += ` AND category = ?`
		args = append(args, cat)
	}
	if cursor := strings.TrimSpace(req.Msg.StartAfter); cursor != "" {
		query += ` AND id > ?`
		args = append(args, cursor)
	}

	query += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, internalError("GetServiceListings", err)
	}
	defer func() { _ = rows.Close() }()

	var listings []*membav1.ServiceListing
	for rows.Next() {
		var l membav1.ServiceListing
		var active int
		if err := rows.Scan(&l.Id, &l.Address, &l.Title, &l.Description, &l.Category,
			&l.Price, &l.DeliveryDays, &l.Tags, &active, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, internalError("GetServiceListings/scan", err)
		}
		l.Active = active == 1
		listings = append(listings, &l)
	}

	return connect.NewResponse(&membav1.GetServiceListingsResponse{Listings: listings}), nil
}

// UpdateServiceListing updates a listing. Owner only.
func (s *MultisigService) UpdateServiceListing(ctx context.Context, req *connect.Request[membav1.UpdateServiceListingRequest]) (*connect.Response[membav1.UpdateServiceListingResponse], error) {
	userAddr, err := s.authenticate(req.Msg.AuthToken)
	if err != nil {
		return nil, err
	}

	listingID := strings.TrimSpace(req.Msg.ListingId)
	if listingID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	// Verify ownership
	var owner string
	err = s.db.QueryRowContext(ctx, `SELECT address FROM service_listings WHERE id = ?`, listingID).Scan(&owner)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if owner != userAddr {
		return nil, connect.NewError(connect.CodePermissionDenied, nil)
	}

	// Build dynamic UPDATE
	sets := []string{"updated_at = CURRENT_TIMESTAMP"}
	args := []interface{}{}

	if t := strings.TrimSpace(req.Msg.Title); t != "" {
		if len(t) > 200 {
			return nil, connect.NewError(connect.CodeInvalidArgument, nil)
		}
		sets = append(sets, "title = ?")
		args = append(args, t)
	}
	if d := strings.TrimSpace(req.Msg.Description); d != "" {
		if len(d) > 2000 {
			return nil, connect.NewError(connect.CodeInvalidArgument, nil)
		}
		sets = append(sets, "description = ?")
		args = append(args, d)
	}
	if c := strings.TrimSpace(req.Msg.Category); c != "" && validCategories[c] {
		sets = append(sets, "category = ?")
		args = append(args, c)
	}
	if req.Msg.Price > 0 {
		sets = append(sets, "price = ?")
		args = append(args, req.Msg.Price)
	}
	if req.Msg.DeliveryDays > 0 {
		sets = append(sets, "delivery_days = ?")
		args = append(args, req.Msg.DeliveryDays)
	}
	if req.Msg.Tags != "" {
		sets = append(sets, "tags = ?")
		args = append(args, strings.TrimSpace(req.Msg.Tags))
	}

	// Active toggle — use the proto bool directly
	activeVal := 0
	if req.Msg.Active {
		activeVal = 1
	}
	sets = append(sets, "active = ?")
	args = append(args, activeVal)

	args = append(args, listingID)
	_, err = s.db.ExecContext(ctx, //nolint:gosec // G202: sets are hardcoded column names, all values use ? placeholders
		`UPDATE service_listings SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return nil, internalError("UpdateServiceListing", err)
	}

	// Fetch updated listing
	var l membav1.ServiceListing
	var active int
	err = s.db.QueryRowContext(ctx,
		`SELECT id, address, title, description, category, price, delivery_days, tags, active, created_at, updated_at
		 FROM service_listings WHERE id = ?`, listingID,
	).Scan(&l.Id, &l.Address, &l.Title, &l.Description, &l.Category,
		&l.Price, &l.DeliveryDays, &l.Tags, &active, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, internalError("UpdateServiceListing/fetch", err)
	}
	l.Active = active == 1

	return connect.NewResponse(&membav1.UpdateServiceListingResponse{Listing: &l}), nil
}
