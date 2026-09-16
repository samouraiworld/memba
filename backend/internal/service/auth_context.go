package service

import "context"

type authAddressKey struct{}

// WithAuthAddress returns a copy of ctx carrying the wallet address recovered
// from a validated REST auth token. Only authentication middleware should call
// it; handlers read the value back with AuthAddressFrom.
func WithAuthAddress(ctx context.Context, addr string) context.Context {
	return context.WithValue(ctx, authAddressKey{}, addr)
}

// AuthAddressFrom returns the authenticated wallet address stored by
// WithAuthAddress. ok is false when the request was not authenticated with an
// address, or the address is empty.
func AuthAddressFrom(ctx context.Context) (addr string, ok bool) {
	addr, _ = ctx.Value(authAddressKey{}).(string)
	return addr, addr != ""
}
