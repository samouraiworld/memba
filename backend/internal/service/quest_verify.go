package service

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"

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
	verifyDAOPath          = "gno.land/r/samcrew/memba_dao"
	verifyCandidaturePath  = "gno.land/r/samcrew/memba_dao_candidature_v2"
	verifyTokenFactoryPath = "gno.land/r/samcrew/tokenfactory_v2"
)

// questRPCURL returns the RPC endpoint for server-side quest verification.
// Prefers GNO_RPC_URL; falls back to the test13 default — NOT test12, which is
// gnoRPCURL()'s legacy default (render_proxy.go). Set GNO_RPC_URL in prod.
func questRPCURL() string {
	if url := os.Getenv("GNO_RPC_URL"); url != "" {
		return url
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
)

// verifyQuestCompletable returns nil if `questID` may be granted to `addr`
// through the auto-complete path, or a connect error explaining why not.
// This is the server-side authority that closes the direct-RPC fabrication
// hole (P0-1): the client's claim that it "verified" is never trusted.
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
// condition, mirroring frontend/src/lib/questVerifier.ts. on_chain quests with
// no case here are NOT grantable (return false) — they stay "coming soon" in
// the curated catalog until a verifier lands (Phase 3).
func (s *MultisigService) defaultVerifyOnChainQuest(_ context.Context, addr, questID string) (bool, error) {
	switch questID {
	case "register-username":
		out, err := abciQuery(questRPCURL(), "vm/qrender", verifyUserRegistryPath+"\n"+addr)
		if err != nil {
			return false, err
		}
		return out != "" && !strings.Contains(strings.ToLower(out), "not found") && !strings.Contains(out, "404"), nil
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
	case "join-dao":
		out, err := abciQuery(questRPCURL(), "vm/qrender", verifyDAOPath+"\n")
		if err != nil {
			return false, err
		}
		return strings.Contains(out, addr), nil
	case "create-token":
		out, err := abciQuery(questRPCURL(), "vm/qrender", verifyTokenFactoryPath+"\n")
		if err != nil {
			return false, err
		}
		return strings.Contains(out, addr), nil
	case "submit-candidature":
		out, err := abciQuery(questRPCURL(), "vm/qrender", verifyCandidaturePath+"\napplication/"+addr)
		if err != nil {
			return false, err
		}
		return out != "" && !strings.Contains(out, "Not Found") && !strings.Contains(out, "404"), nil
	default:
		// on_chain quest without a server verifier yet — not grantable.
		return false, nil
	}
}

// accountInfo reads sequence + account_number for an address from the chain.
func accountInfo(addr string) (seq, accNum int, err error) {
	out, err := abciQuery(questRPCURL(), "auth/accounts/"+addr, "")
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
