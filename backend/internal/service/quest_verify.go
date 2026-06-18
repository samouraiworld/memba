package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
)

// questVerification maps each quest ID to its verification class, mirroring
// `verification:` in frontend/src/lib/gnobuilders.ts. Guarded by
// TestQuestVerificationParity so the two can't silently drift.
//
// It is the authority for what CompleteQuest/SyncQuests will grant without
// proof:
//   - self_report / social -> NOT self-completable (use SubmitQuestClaim)
//   - on_chain             -> re-verified on-chain at grant time
//   - off_chain            -> low-trust accept (localStorage-class, low XP)
var questVerification = map[string]string{
	// Developer — Package Deployment
	"deploy-hello-pkg": "on_chain", "deploy-counter-pkg": "on_chain", "deploy-avl-pkg": "on_chain",
	"deploy-interface-pkg": "on_chain", "deploy-test-pkg": "self_report", "deploy-import-pkg": "on_chain",
	"deploy-event-pkg": "on_chain", "deploy-ownable-pkg": "on_chain", "deploy-upgradable-pkg": "on_chain",
	"deploy-governance-pkg": "on_chain",
	// Developer — Realm Deployment
	"deploy-hello-realm": "on_chain", "deploy-grc20-realm": "on_chain", "deploy-grc721-realm": "on_chain",
	"deploy-board-realm": "on_chain", "deploy-dao-realm": "on_chain", "deploy-crossing-realm": "on_chain",
	"deploy-escrow-realm": "on_chain", "deploy-marketplace-realm": "on_chain", "deploy-multisig-realm": "on_chain",
	"deploy-full-dapp": "self_report",
	// Developer — Advanced
	"write-10-tests": "self_report", "fix-upstream-bug": "self_report", "audit-realm": "self_report",
	"deploy-3-chains": "on_chain", "build-mcp-tool": "self_report", "gas-optimization": "self_report",
	"render-masterclass": "on_chain", "gnodaokit-extension": "self_report", "deploy-ibc-realm": "on_chain",
	"mentor-developer": "self_report",
	// Everyone — Getting Started
	"connect-wallet": "off_chain", "setup-profile": "off_chain", "register-username": "on_chain",
	"first-transaction": "on_chain", "visit-5-pages": "off_chain", "use-cmdk": "off_chain",
	"switch-network": "off_chain", "view-validator": "off_chain", "faucet-claim": "on_chain",
	"read-docs": "off_chain",
	// Everyone — DAO Participation
	"join-dao": "on_chain", "create-dao": "on_chain", "vote-proposal": "on_chain",
	"create-proposal": "on_chain", "vote-5-proposals": "on_chain", "execute-proposal": "on_chain",
	"post-board": "on_chain", "reply-board": "on_chain", "browse-proposals": "off_chain",
	"submit-candidature": "on_chain",
	// Everyone — Token & NFT
	"create-token": "on_chain", "send-tokens": "on_chain", "mint-nft": "on_chain",
	"list-nft": "on_chain", "hold-5-tokens": "on_chain",
	// Everyone — Social & Community
	"follow-twitter": "social", "join-discord": "social", "share-link": "off_chain",
	"submit-feedback": "off_chain", "invite-member": "off_chain",
	// Champion
	"complete-all-everyone": "off_chain", "top-10-leaderboard": "off_chain", "earn-500-xp": "off_chain",
	"earn-1000-xp": "off_chain", "3-dao-member": "on_chain", "create-team": "off_chain",
	"10-board-posts": "on_chain", "treasury-contributor": "on_chain", "gnolove-top-20": "off_chain",
	"ai-report-reader": "off_chain", "multisig-signer": "on_chain", "channel-active": "on_chain",
	"weekly-login": "off_chain", "help-newcomer": "on_chain", "validator-delegator": "on_chain",
	// Hidden & Seasonal
	"easter-egg-konami": "off_chain", "night-owl": "off_chain", "speed-runner": "off_chain",
	"first-100-users": "off_chain", "perfect-week": "off_chain", "directory-deep-dive": "off_chain",
	"all-networks": "off_chain", "genesis-dao-voter": "on_chain", "bug-hunter": "self_report",
	"season-1-complete": "off_chain",
}

// test13 realm paths used by server-side verification (mirror config.ts).
const (
	verifyUserRegistryPath = "gno.land/r/sys/users"
	verifyCandidaturePath  = "gno.land/r/samcrew/memba_dao_candidature_v2"
)

// questRPCURL returns the RPC endpoint for server-side quest verification.
// It deliberately does NOT read GNO_RPC_URL — that var is set to test12 in
// prod (fly.toml), while every realm we verify lives on test13. Mirrors the
// dedicated NFT_RPC_URL pattern in cmd/memba/main.go.
func questRPCURL() string {
	for _, env := range []string{"QUEST_RPC_URL", "NFT_RPC_URL"} {
		if url := os.Getenv(env); url != "" {
			return url
		}
	}
	return "https://rpc.test13.testnets.gno.land:443"
}

var (
	errProofRequired     = errors.New("quest requires submitted proof — use SubmitQuestClaim")
	errVerifyUnavailable = errors.New("on-chain verification unavailable, try again")
	errQuestNotMet       = errors.New("quest requirements not met on-chain")
)

var (
	seqRe    = regexp.MustCompile(`"sequence":\s*"?(\d+)"?`)
	accNumRe = regexp.MustCompile(`"account_number":\s*"?(\d+)"?`)
	// addrRe matches a well-formed bech32 gno address. We only ever interpolate
	// a matching address into an on-chain query expression/path (defence-in-depth
	// against VM-eval injection — the address comes from a validated token, but
	// is never trusted raw into a qeval string).
	addrRe = regexp.MustCompile(`^g1[a-z0-9]{38}$`)
)

// verifyQuestCompletable returns nil if `questID` may be granted to `addr`
// through the auto-complete path, or a connect error explaining why not.
// This is the server-side authority that closes the direct-RPC fabrication
// hole (P0-1): the client's claim that it passed the frontend verifier is
// never trusted.
func (s *MultisigService) verifyQuestCompletable(ctx context.Context, addr, questID string) error {
	switch questVerification[questID] {
	case "self_report", "social":
		return connect.NewError(connect.CodeInvalidArgument, errProofRequired)
	case "on_chain":
		ok, err := s.runOnChainVerify(ctx, addr, questID)
		if err != nil {
			return connect.NewError(connect.CodeFailedPrecondition, errVerifyUnavailable)
		}
		if !ok {
			return connect.NewError(connect.CodeFailedPrecondition, errQuestNotMet)
		}
		return nil
	default:
		// off_chain + legacy ids (view-profile/directory-tabs): low-trust accept.
		return nil
	}
}

// runOnChainVerify dispatches to the test seam if present, else the real impl.
func (s *MultisigService) runOnChainVerify(ctx context.Context, addr, questID string) (bool, error) {
	if s.verifyOnChainQuest != nil {
		return s.verifyOnChainQuest(ctx, addr, questID)
	}
	return s.defaultVerifyOnChainQuest(ctx, addr, questID)
}

// defaultVerifyOnChainQuest re-queries the chain to confirm an on_chain quest's
// condition. on_chain quests with no case here are NOT grantable (return false)
// — they stay "coming soon" in the curated catalog until a verifier lands.
//
// Only path-keyed checks are implemented here: register-username and
// submit-candidature query a render path that embeds the user's address, and
// the account checks are keyed by address — none are spoofable. Membership /
// ownership quests (join-dao, create-token, …) need structured render parsing
// (a substring scan over full render output could be spoofed by a realm that
// echoes an attacker-controlled address) and are deferred to Phase 3.
func (s *MultisigService) defaultVerifyOnChainQuest(_ context.Context, addr, questID string) (bool, error) {
	if !addrRe.MatchString(addr) {
		return false, nil // malformed address — never interpolate into a query
	}
	switch questID {
	case "register-username":
		// r/sys/users.Render IGNORES its path arg, so a qrender returns the same
		// content for any address (an always-passes bug). ResolveAddress returns
		// *UserData — "(nil ...)" when the address has no @username registered.
		out, err := questEval(verifyUserRegistryPath + `.ResolveAddress("` + addr + `")`)
		if err != nil {
			return false, err
		}
		return out != "" && !strings.HasPrefix(strings.TrimSpace(out), "(nil"), nil
	case "submit-candidature":
		out, err := questRender(verifyCandidaturePath, "application/"+addr)
		if err != nil {
			return false, err
		}
		return renderExists(out), nil
	case "first-transaction":
		seq, _, err := accountInfo(addr)
		if err != nil {
			return false, err
		}
		return seq > 0, nil
	case "faucet-claim":
		seq, accNum, err := accountInfo(addr)
		if err != nil {
			return false, err
		}
		return seq > 0 || accNum > 0, nil
	default:
		// on_chain quest without a server verifier yet — not grantable.
		return false, nil
	}
}

// renderExists reports whether a vm/qrender result represents a present record
// (non-empty and not a "not found" / 404 page).
func renderExists(out string) bool {
	if out == "" {
		return false
	}
	lower := strings.ToLower(out)
	return !strings.Contains(lower, "not found") && !strings.Contains(lower, "404")
}

// questRender runs a vm/qrender query (pkgPath + ":" + renderArg) against the
// quest RPC and returns the rendered text ("" when the realm/path is absent).
func questRender(pkgPath, renderArg string) (string, error) {
	return questAbciQuery(questRPCURL(), "vm/qrender", pkgPath+":"+renderArg)
}

// questEval runs a vm/qeval expression (e.g. `pkg.Func("arg")`) against the
// quest RPC, returning the printed result ("" when the realm/expr is absent).
func questEval(expr string) (string, error) {
	return questAbciQuery(questRPCURL(), "vm/qeval", expr)
}

// accountInfo reads sequence + account_number for an address from the chain.
// An unfunded/non-existent account yields ("", nil) -> (0, 0) (requirement not
// met), not an error.
func accountInfo(addr string) (seq, accNum int, err error) {
	out, err := questAbciQuery(questRPCURL(), "auth/accounts/"+addr, "")
	if err != nil {
		return 0, 0, err
	}
	if m := seqRe.FindStringSubmatch(out); m != nil {
		seq, _ = strconv.Atoi(m[1])
	}
	if m := accNumRe.FindStringSubmatch(out); m != nil {
		accNum, _ = strconv.Atoi(m[1])
	}
	return seq, accNum, nil
}

// questAbciResponse is like abciResponse (render_proxy.go) but tolerates an
// ABCI ResponseBase.Error that is a JSON object (e.g. /std.InvalidAddressError
// for an unfunded account) rather than a string — which would otherwise fail
// to unmarshal and look like a transport error.
type questAbciResponse struct {
	Result struct {
		Response struct {
			ResponseBase struct {
				Data  string          `json:"Data"`
				Error json.RawMessage `json:"Error"`
			} `json:"ResponseBase"`
		} `json:"response"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// questAbciQuery sends an ABCI query for server-side verification using the
// wire format gno.land requires: the `data` param base64-encoded. A non-empty
// ABCI ResponseBase.Error (missing account, "not found" render) is treated as
// an EMPTY result — "requirement not met" — not a transport failure. Only
// genuine transport/RPC errors return a non-nil error, which the caller maps
// to errVerifyUnavailable (reject, don't grant).
func questAbciQuery(rpcURL, path, data string) (string, error) {
	reqBody := abciQueryRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "abci_query",
		Params: abciQueryParams{
			Path: path,
			Data: base64.StdEncoding.EncodeToString([]byte(data)),
		},
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(rpcURL, "application/json", strings.NewReader(string(payload)))
	if err != nil {
		return "", fmt.Errorf("rpc request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	var result questAbciResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse response: %w", err)
	}
	if result.Error != nil {
		return "", fmt.Errorf("rpc error: %s", result.Error.Message)
	}

	rb := result.Result.Response.ResponseBase
	if len(rb.Error) > 0 && string(rb.Error) != "null" {
		// ABCI-level error (missing account / not found) = requirement not met.
		return "", nil
	}
	if rb.Data == "" {
		return "", nil
	}
	decoded, err := base64.StdEncoding.DecodeString(rb.Data)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}
	return string(decoded), nil
}
