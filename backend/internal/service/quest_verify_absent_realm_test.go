package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// writeAbciPkgNotFound answers like a gno.land node queried for a package that
// does not exist on its chain (vm/qrender on gnoland-1 for memba_dao,
// memba_dao_candidature_v3 and tokenfactory_v2, observed 2026-09-24).
func writeAbciPkgNotFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"result":{"response":{"ResponseBase":{"Data":"","Error":{"@type":"/vm.InvalidPkgPathError"},"Log":"package not found"}}}}`))
}

// absentRealmNode starts a node that reports every package as absent, points the
// quest RPC at it, and returns a counter of hits on the (unused) backup node.
func absentRealmNode(t *testing.T) *int {
	t.Helper()
	node := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeAbciPkgNotFound(w)
	}))
	t.Cleanup(node.Close)
	backupHits := new(int)
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		*backupHits++
		writeAbciData(w, "SHOULD_NOT_BE_USED")
	}))
	t.Cleanup(backup.Close)
	t.Setenv("QUEST_RPC_URL", node.URL)
	t.Setenv("RPC_FALLBACK_URLS", backup.URL)
	return backupHits
}

func TestQuestAbciQuery_PackageNotFoundIsDistinctAndDoesNotFailOver(t *testing.T) {
	backupHits := absentRealmNode(t)

	_, err := questAbciQuery(context.Background(), questRPCURL(), "vm/qrender", "gno.land/r/samcrew/memba_dao:members")
	if !errors.Is(err, errPackageNotFound) {
		t.Fatalf("err = %v, want errPackageNotFound", err)
	}
	if *backupHits != 0 {
		t.Fatalf("backup hit %d times; a node's package-not-found answer must not fail over", *backupHits)
	}
}

// The three quests whose realms are not deployed on gnoland-1 must report the
// missing realm, not "requirements not met".
func TestDefaultVerify_AbsentRealmReportsNotDeployed(t *testing.T) {
	absentRealmNode(t)
	h := setup(t)
	addr := "g1abcdefghijklmnopqrstuvwxyz0123456789ab"

	for questID, realm := range map[string]string{
		"join-dao":           membaDAOPath,
		"submit-candidature": verifyCandidaturePath,
		"create-token":       tokenFactoryPath,
	} {
		t.Run(questID, func(t *testing.T) {
			ok, err := h.svc.defaultVerifyOnChainQuest(context.Background(), addr, questID, "")
			if ok {
				t.Fatal("an absent realm must never verify")
			}
			var nd *realmNotDeployedError
			if !errors.As(err, &nd) {
				t.Fatalf("err = %v, want *realmNotDeployedError", err)
			}
			if nd.path != realm {
				t.Fatalf("reported realm %q, want %q", nd.path, realm)
			}
		})
	}
}

// A deploy quest's proof path that doesn't exist stays "not met": it is the
// user's realm that is missing, not one the quest depends on.
func TestPathExists_PackageNotFoundIsFalse(t *testing.T) {
	absentRealmNode(t)

	ok, err := pathExists(context.Background(), "gno.land/r/alice/hello")
	if err != nil || ok {
		t.Fatalf("pathExists = (%v, %v), want (false, nil)", ok, err)
	}
}

func TestCompleteQuest_AbsentRealmIsNotAvailableNotFailed(t *testing.T) {
	h := setup(t)
	h.svc.verifyOnChainQuest = func(_ context.Context, _, _, _ string) (bool, error) {
		return false, &realmNotDeployedError{path: membaDAOPath}
	}
	token := h.makeToken(t, "g1alice")

	_, err := h.svc.CompleteQuest(context.Background(), connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "join-dao",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition (err %v)", connect.CodeOf(err), err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "not available on this network yet") || !strings.Contains(msg, membaDAOPath) {
		t.Fatalf("message %q must say the realm is not deployed on this network", msg)
	}
	if strings.Contains(msg, errQuestNotMet.Error()) || strings.Contains(msg, errVerifyUnavailable.Error()) {
		t.Fatalf("message %q must not read as a user failure or an outage", msg)
	}
}
