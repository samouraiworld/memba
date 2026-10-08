// Package evmsafe checks, read-only over JSON-RPC, that an address is a Safe
// Memba recognises and who its owners are. It is the server's own check, run
// before Memba stores anything about a Safe for an account: the Safe
// Transaction Service and the browser are never trusted for it.
//
// The tables mirror frontend/src/lib/chain/evm/safe/known.ts (same sources,
// same chains: Base 8453 and Base Sepolia 84532, where every entry has the
// same address and code).
package evmsafe

// Singleton is a Safe implementation a proxy may point at.
type Singleton struct {
	Version  string
	L2       bool
	Address  string // lowercase 0x hex
	CodeHash string // lowercase 0x hex keccak256 of the runtime code
}

// Singletons: safe-global/safe-deployments v1.3.0 (canonical and eip155),
// v1.4.1 and v1.5.0; addresses and codehashes checked on both chains.
var Singletons = []Singleton{
	{"1.3.0", false, "0xd9db270c1b5e3bd161e8c8503c55ceabee709552", "0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e"},
	{"1.3.0", false, "0x69f4d1788e39c87893c980c06edf4b7f686e2938", "0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e"},
	{"1.3.0", true, "0x3e5c63644e683549055b9be8653de26e0b4cd36e", "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f"},
	{"1.3.0", true, "0xfb1bffc9d739b8d520daf37df666da4c687191ea", "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f"},
	{"1.4.1", false, "0x41675c099f32341bf84bfc5382af534df5c7461a", "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4"},
	{"1.4.1", true, "0x29fcb43b46531bca003ddc8fcb67ffe91900c762", "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff"},
	{"1.5.0", false, "0xff51a5898e281db6dfc7855790607438df2ca44b", "0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2"},
	{"1.5.0", true, "0xedd160febbd92e350d4d398fb636302fccd67c7e", "0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc"},
}

// ProxyCodeHashes are the runtime codehashes of the Safe proxies the v1.3.0,
// v1.4.1 and v1.5.0 factories create (the singleton sits in storage, so every
// proxy of one factory has the same code).
var ProxyCodeHashes = map[string]string{
	"0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000": "1.3.0",
	"0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c": "1.4.1",
	"0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f": "1.5.0",
}

// Chains are the EIP-155 chains these tables describe.
var Chains = map[uint64]bool{8453: true, 84532: true}

func singletonAt(addr string) (Singleton, bool) {
	for _, s := range Singletons {
		if s.Address == addr {
			return s, true
		}
	}
	return Singleton{}, false
}
