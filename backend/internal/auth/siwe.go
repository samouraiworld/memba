package auth

import (
	"crypto/ed25519"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"

	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// siweChallengeContext prefixes the bytes the server signs for a SIWE
// challenge. The Gno login challenge is signed over its bare protobuf bytes, so
// with this prefix neither kind of challenge can ever be presented as the other,
// whatever their encodings happen to share.
const siweChallengeContext = "memba/siwe-challenge/v1\x00"

func siweChallengeSignBytes(ch *membav1.SiweChallenge) ([]byte, error) {
	clean := proto.Clone(ch).(*membav1.SiweChallenge)
	clean.ServerSignature = nil
	b, err := proto.MarshalOptions{Deterministic: true}.Marshal(clean)
	if err != nil {
		return nil, errors.Wrap(err, "marshal siwe challenge")
	}
	return append([]byte(siweChallengeContext), b...), nil
}

// SignSiweChallenge sets ch.ServerSignature: ed25519 over the SIWE context
// prefix and the challenge's deterministic protobuf encoding without it.
func SignSiweChallenge(privateKey ed25519.PrivateKey, ch *membav1.SiweChallenge) error {
	b, err := siweChallengeSignBytes(ch)
	if err != nil {
		return err
	}
	ch.ServerSignature = ed25519.Sign(privateKey, b)
	return nil
}

// VerifySiweChallengeSignature checks that ch was issued by this server and not
// altered. Any field added, removed or changed by the client (unknown fields
// included) breaks it. Expiry and binding are the caller's.
func VerifySiweChallengeSignature(publicKey ed25519.PublicKey, ch *membav1.SiweChallenge) error {
	if ch == nil || len(ch.ServerSignature) != ed25519.SignatureSize {
		return errors.New("missing siwe challenge signature")
	}
	b, err := siweChallengeSignBytes(ch)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, b, ch.ServerSignature) {
		return errors.New("invalid server signature on siwe challenge")
	}
	return nil
}

// MintToken issues a server-signed session Token for an identity the caller has
// already proven. It is the same token MakeToken issues (same fields, same
// signature scheme), so every token consumer handles it unchanged; only the
// proof differs.
func MintToken(privateKey ed25519.PrivateKey, userAddress, chainID string, ttl time.Duration) (*membav1.Token, error) {
	if userAddress == "" || chainID == "" || ttl <= 0 {
		return nil, errors.New("mint token: missing identity, chain or lifetime")
	}
	nonce, err := makeNonce()
	if err != nil {
		return nil, errors.Wrap(err, "failed to make nonce")
	}
	token := &membav1.Token{
		Nonce:       encodeBytes(nonce),
		UserAddress: userAddress,
		Expiration:  encodeTime(time.Now().Add(ttl)),
		ChainId:     chainID,
	}
	b, err := proto.Marshal(token)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal token")
	}
	token.ServerSignature = encodeBytes(ed25519.Sign(privateKey, b))
	return token, nil
}
