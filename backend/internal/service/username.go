package service

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/cosmos/cosmos-sdk/types/bech32"
)

// Reads of the gno.land users registry (r/sys/users).
//
// The registry's Render ignores its path argument, so a username can't be read
// by rendering `r/sys/users:<addr>`. The authoritative lookups are the
// ResolveAddress / ResolveName functions, queried through vm/qeval, which print
// a *UserData struct literal. Both already return nil for deleted users.

// usernameRe is the registry's own name rule (r/sys/users store.gno reName).
var usernameRe = regexp.MustCompile(`^[a-z][a-z0-9]*([_-][a-z0-9]+)*$`)

// userDataRe matches the first printed value of ResolveAddress / ResolveName:
//
//	(&(struct{("<addr>" .uverse.address),("<name>" string),(<deleted> bool)} gno.land/r/sys/users.UserData) *gno.land/r/sys/users.UserData)
//
// ResolveName prints a second "(<isCurrent> bool)" line, which is ignored.
var userDataRe = regexp.MustCompile(`^\(&\(struct\{\("(g1[a-z0-9]+)" \.uverse\.address\),\("([^"\\]*)" string\),\((true|false) bool\)\} gno\.land/r/sys/users\.UserData\) \*gno\.land/r/sys/users\.UserData\)$`)

var errUnexpectedUserData = errors.New("unexpected users registry answer")

type registryUser struct {
	addr    string
	name    string
	deleted bool
}

// parseUserData parses the *UserData literal printed by the users registry.
// It returns ok=false for a nil pointer or for any output that is not exactly
// the expected literal.
func parseUserData(out string) (registryUser, bool) {
	first, _, _ := strings.Cut(strings.TrimSpace(out), "\n")
	m := userDataRe.FindStringSubmatch(strings.TrimSpace(first))
	if m == nil {
		return registryUser{}, false
	}
	return registryUser{addr: m[1], name: m[2], deleted: m[3] == "true"}, true
}

// isNilUserData reports whether the registry printed a nil *UserData.
func isNilUserData(out string) bool {
	return strings.HasPrefix(strings.TrimSpace(out), "(nil *gno.land/r/sys/users.UserData)")
}

// isValidGnoAddress reports whether addr is a canonical (lower-case) bech32
// gno.land user address: prefix "g", 20-byte payload, valid checksum.
func isValidGnoAddress(addr string) bool {
	if addr == "" || addr != strings.ToLower(addr) || !strings.HasPrefix(addr, "g1") {
		return false
	}
	hrp, data, err := bech32.DecodeAndConvert(addr)
	return err == nil && hrp == "g" && len(data) == 20
}

// resolveUsername returns the registered username of addr, or "" when the
// address has none (unregistered, deleted, or an answer that isn't a record for
// exactly this address). The address is validated before it is placed in the
// query expression. A transport failure is returned as an error.
func resolveUsername(ctx context.Context, addr string) (string, error) {
	if !isValidGnoAddress(addr) {
		return "", nil
	}
	out, err := questEval(ctx, verifyUserRegistryPath+`.ResolveAddress(address("`+addr+`"))`)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" || isNilUserData(out) {
		return "", nil
	}
	u, ok := parseUserData(out)
	if !ok {
		return "", errUnexpectedUserData
	}
	if u.deleted || u.addr != addr || !usernameRe.MatchString(u.name) {
		return "", nil
	}
	return u.name, nil
}
