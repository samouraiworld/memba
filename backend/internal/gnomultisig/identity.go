// Package gnomultisig is the native-Gno codec boundary. It never translates a
// stored Cosmos identity into a native identity and never sorts imported keys.
package gnomultisig

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/multisig"
	gnosecp "github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

const Type = "/tm.PubKeyMultisig"

var ErrInvalid = errors.New("invalid native Gno multisig")

// IsNative detects the explicit discriminator, including malformed native
// envelopes. Such input must never fall back to the legacy parser.
func IsNative(raw string) bool {
	var v map[string]json.RawMessage
	_ = json.Unmarshal([]byte(raw), &v)
	_, ok := v["@type"]
	return ok
}

// StrictJSON rejects duplicate fields at every level, trailing data and deep
// nesting before any typed codec can silently pick one of two values.
func StrictJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 32 {
			return ErrInvalid
		}
		t, err := d.Token()
		if err != nil {
			return ErrInvalid
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, err := d.Token()
				if err != nil {
					return ErrInvalid
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return ErrInvalid
				}
				seen[key] = true
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err := walk(depth + 1); err != nil {
					return err
				}
			}
		default:
			return ErrInvalid
		}
		_, err = d.Token()
		return err
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrInvalid
	}
	return nil
}

func Parse(raw string) (multisig.PubKeyMultisigThreshold, error) {
	var zero multisig.PubKeyMultisigThreshold
	if len(raw) > 4096 || StrictJSON([]byte(raw)) != nil {
		return zero, ErrInvalid
	}
	var wire struct {
		Type      string `json:"@type"`
		Threshold string `json:"threshold"`
		Keys      []struct {
			Type  string `json:"@type"`
			Value string `json:"value"`
		} `json:"pubkeys"`
	}
	d := json.NewDecoder(bytes.NewBufferString(raw))
	d.DisallowUnknownFields()
	if d.Decode(&wire) != nil || wire.Type != Type || len(wire.Keys) > 7 {
		return zero, ErrInvalid
	}
	k, err := strconv.Atoi(wire.Threshold)
	if err != nil || strconv.Itoa(k) != wire.Threshold {
		return zero, ErrInvalid
	}
	keys := make([]crypto.PubKey, 0, len(wire.Keys))
	for _, p := range wire.Keys {
		b, err := base64.StdEncoding.Strict().DecodeString(p.Value)
		if err != nil || len(b) != 33 || base64.StdEncoding.EncodeToString(b) != p.Value || p.Type != "/tm.PubKeySecp256k1" {
			return zero, ErrInvalid
		}
		if _, err := secp256k1.ParsePubKey(b); err != nil {
			return zero, ErrInvalid
		}
		var pk gnosecp.PubKeySecp256k1
		copy(pk[:], b)
		keys = append(keys, pk)
	}
	pk, err := multisig.NewPubKeyMultisigThresholdChecked(k, keys)
	if err != nil {
		return zero, ErrInvalid
	}
	return pk.(multisig.PubKeyMultisigThreshold), nil
}

func JSON(pk multisig.PubKeyMultisigThreshold) (string, error) {
	b, err := amino.MarshalJSONAny(pk)
	return string(b), err
}

func CanonicalOrder(pk multisig.PubKeyMultisigThreshold) bool {
	for i := 1; i < len(pk.PubKeys); i++ {
		a, b := pk.PubKeys[i-1].Address(), pk.PubKeys[i].Address()
		if bytes.Compare(a[:], b[:]) >= 0 {
			return false
		}
	}
	return true
}
