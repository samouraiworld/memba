package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	membav1 "github.com/samouraiworld/memba/backend/gen/memba/v1"
)

// Captured read-only from pearl-1 (node_info.network checked) on 2026-09-17:
// vm/qrender gno.land/r/samcrew/memba_dao:members (chip data URIs shortened).
const liveMembaDAOMembers = "## Members 👥 (1)\n\n" +
	"| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |\n" +
	"|----------|----------------|--------------|-------------|\n" +
	"| Anon | [g1x7\\.\\.\\.uxu0](/u/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) | [![admin colored chip](data:image/svg+xml;base64,PHN2Zz4=) admin](/r/samcrew/memba_dao:role/admin), [![dev colored chip](data:image/svg+xml;base64,PHN2Zz4=) dev](/r/samcrew/memba_dao:role/dev) | [View](/r/samcrew/memba_dao:member/g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0) |\n" +
	"\n\n\n\n## Roles distribution:\n![Pie Chart Roles distribution:](data:image/svg+xml;base64,PHN2Zz4=)\n--------------------------------\n"

const liveMembaDAOMember = "g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"

// testAddr returns a distinct address-shaped string for member n.
func testAddr(n int) string {
	s := fmt.Sprintf("g1member%032d", n)
	return s[:40]
}

// memberRow renders one row the way basedao RenderMembersTable does.
func memberRow(displayName, addr string) string {
	short := addr[:4] + `\.\.\.` + addr[len(addr)-4:]
	return fmt.Sprintf("| %s | [%s](/u/%s) | [![member colored chip](data:image/svg+xml;base64,PHN2Zz4=) member](/r/samcrew/memba_dao:role/member) | [View](/r/samcrew/memba_dao:member/%s) |\n",
		displayName, short, addr, addr)
}

// membersPage renders a members page holding rows for members[from:to].
func membersPage(total int, rows ...string) string {
	return fmt.Sprintf("## Members 👥 (%d)\n\n", total) +
		"| **Name** | **Address 🔗** | **Roles 🎭** | **Profile** |\n" +
		"|----------|----------------|--------------|-------------|\n" +
		strings.Join(rows, "") + "\n\n--------------------------------\n"
}

func TestParseMembaDAOMembersPage_Live(t *testing.T) {
	total, addrs, ok := parseMembaDAOMembersPage(liveMembaDAOMembers)
	if !ok || total != 1 || len(addrs) != 1 || addrs[0] != liveMembaDAOMember {
		t.Fatalf("got total=%d addrs=%v ok=%v", total, addrs, ok)
	}
}

func TestParseMembaDAOMembersPage_ProseAddressIsNotAMember(t *testing.T) {
	page := membersPage(1, memberRow("Anon", testAddr(1))) +
		"> see also " + testAddr(2) + " and /u/" + testAddr(2) + "\n"
	_, addrs, ok := parseMembaDAOMembersPage(page)
	if !ok || len(addrs) != 1 || addrs[0] != testAddr(1) {
		t.Fatalf("got addrs=%v ok=%v", addrs, ok)
	}
}

// A display name with line breaks and table markup: a page whose row count
// exceeds the realm's member count is not trusted.
func TestParseMembaDAOMembersPage_RowCountAboveMemberCountRejected(t *testing.T) {
	member, otherAddress := testAddr(1), testAddr(2)
	nameWithTableMarkup := "x\n" + strings.TrimSuffix(memberRow("admin", otherAddress), "\n") + "\nzz"
	page := membersPage(1, memberRow(nameWithTableMarkup, member))
	_, addrs, ok := parseMembaDAOMembersPage(page)
	if ok {
		t.Fatalf("a page with more rows than members must not be trusted, got %v", addrs)
	}
}

// Table markup inside a display name on the same line is not a row: only the
// realm-generated address cells at the end of the line are read.
func TestParseMembaDAOMembersPage_ReadsOnlyRealmGeneratedCells(t *testing.T) {
	member, otherAddress := testAddr(1), testAddr(2)
	nameWithTableMarkup := strings.TrimSuffix(memberRow("admin", otherAddress), "\n")
	page := membersPage(1, memberRow(nameWithTableMarkup, member))
	_, addrs, ok := parseMembaDAOMembersPage(page)
	if !ok || len(addrs) != 1 || addrs[0] != member {
		t.Fatalf("want only the member's own row, got addrs=%v ok=%v", addrs, ok)
	}
}

func TestParseMembaDAOMembersPage_MismatchedCellsAreNotRows(t *testing.T) {
	a, b := testAddr(1), testAddr(2)
	row := strings.Replace(memberRow("Anon", a), "member/"+a, "member/"+b, 1)
	if _, addrs, ok := parseMembaDAOMembersPage(membersPage(1, row)); ok {
		t.Fatalf("a row whose address cell and member link disagree must not count, got %v", addrs)
	}
}

func TestParseMembaDAOMembersPage_RequiresRealmHeader(t *testing.T) {
	for label, page := range map[string]string{
		"no header":      strings.TrimPrefix(membersPage(1, memberRow("Anon", testAddr(1))), "## Members 👥 (1)\n\n"),
		"header late":    "# Something\n" + membersPage(1, memberRow("Anon", testAddr(1))),
		"empty":          "",
		"not found page": "404: not found",
	} {
		if _, _, ok := parseMembaDAOMembersPage(page); ok {
			t.Errorf("%s: must not parse", label)
		}
	}
}

// membersRealmStub serves memba_dao :members pages from `pages` (key = render
// arg, e.g. "members" or "members?page=2") and counts requests.
func membersRealmStub(t *testing.T, pages map[string]string, hits *int32) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Params struct {
				Path string `json:"path"`
				Data string `json:"data"`
			} `json:"params"`
		}
		_ = json.Unmarshal(body, &req)
		raw, _ := base64.StdEncoding.DecodeString(req.Params.Data)
		arg := strings.TrimPrefix(string(raw), membaDAOPath+":")
		if req.Params.Path != "vm/qrender" || arg == string(raw) {
			t.Errorf("unexpected query %s %q", req.Params.Path, raw)
		}
		writeAbciData(w, pages[arg])
	}))
	t.Cleanup(srv.Close)
	t.Setenv("QUEST_RPC_URL", srv.URL)
	t.Setenv("RPC_FALLBACK_URLS", srv.URL)
}

func twoPageDAO(extraOnPage2 ...string) map[string]string {
	var p1 []string
	for i := 1; i <= 10; i++ {
		p1 = append(p1, memberRow("Anon", testAddr(i)))
	}
	p2 := append([]string{memberRow("Anon", testAddr(11))}, extraOnPage2...)
	return map[string]string{
		"members":        membersPage(11, p1...),
		"members?page=2": membersPage(11, p2...),
	}
}

func TestVerifyJoinDAO_MemberOnSecondPage(t *testing.T) {
	var hits int32
	membersRealmStub(t, twoPageDAO(), &hits)

	ok, err := verifyJoinDAO(context.Background(), testAddr(11))
	if err != nil || !ok {
		t.Fatalf("member on page 2: ok=%v err=%v", ok, err)
	}
	ok, err = verifyJoinDAO(context.Background(), testAddr(3))
	if err != nil || !ok {
		t.Fatalf("member on page 1: ok=%v err=%v", ok, err)
	}
	ok, err = verifyJoinDAO(context.Background(), testAddr(99))
	if err != nil || ok {
		t.Fatalf("non-member: ok=%v err=%v", ok, err)
	}
}

// Rejects member rows whose address cell is not realm-generated: an address
// that appears only inside a display name is not a member.
func TestVerifyJoinDAO_AddressOnlyInDisplayNameIsNotMember(t *testing.T) {
	otherAddress := testAddr(42)
	pages := twoPageDAO()
	nameWithTableMarkup := "x\n" + strings.TrimSuffix(memberRow("admin", otherAddress), "\n") + "\nzz"
	pages["members?page=2"] = membersPage(11, memberRow(nameWithTableMarkup, testAddr(11)))

	var hits int32
	membersRealmStub(t, pages, &hits)
	ok, err := verifyJoinDAO(context.Background(), otherAddress)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("an address that is not in a realm-generated cell must not verify membership")
	}
}

func TestVerifyJoinDAO_EmptyOrMissingRealm(t *testing.T) {
	var hits int32
	membersRealmStub(t, map[string]string{}, &hits)
	ok, err := verifyJoinDAO(context.Background(), liveMembaDAOMember)
	if err != nil || ok {
		t.Fatalf("missing realm: ok=%v err=%v", ok, err)
	}
}

func TestVerifyJoinDAO_PageWalkIsBounded(t *testing.T) {
	var hits int32
	huge := map[string]string{}
	for p := 1; p <= maxJoinDAOMemberPages+10; p++ {
		var rows []string
		for i := 0; i < 10; i++ {
			rows = append(rows, memberRow("Anon", testAddr(p*100+i)))
		}
		arg := "members"
		if p > 1 {
			arg = fmt.Sprintf("members?page=%d", p)
		}
		huge[arg] = membersPage(1_000_000, rows...)
	}
	membersRealmStub(t, huge, &hits)
	_, _ = verifyJoinDAO(context.Background(), testAddr(99))
	if n := atomic.LoadInt32(&hits); n != int32(maxJoinDAOMemberPages) {
		t.Fatalf("walked %d pages, want exactly the cap %d", n, maxJoinDAOMemberPages)
	}
}

// ── Quest catalogue: no quest sends users to gnodaokit ──

func TestQuestCatalogDoesNotPointToGnodaokit(t *testing.T) {
	const frontendPath = "../../../frontend/src/lib/gnobuilders.ts"
	data, err := os.ReadFile(frontendPath)
	if err != nil {
		t.Fatalf("read frontend quests (%s): %v", frontendPath, err)
	}
	quest := regexp.MustCompile(`(?m)^\s*\{ id: "[a-z0-9-]+".*$`)
	for _, line := range quest.FindAllString(string(data), -1) {
		if l := strings.ToLower(line); strings.Contains(l, "gnodaokit") || strings.Contains(l, "basedao") {
			t.Errorf("quest points to gnodaokit: %s", strings.TrimSpace(line))
		}
	}
	for _, id := range []string{"gnodaokit-extension"} {
		if _, ok := questVerification[id]; ok {
			t.Errorf("%s must not be verifiable", id)
		}
		if selfReportQuests[id] {
			t.Errorf("%s must not be claimable", id)
		}
		if _, ok := validQuests[id]; !ok {
			t.Errorf("%s must stay in validQuests so existing completions keep their XP", id)
		}
	}
}

// A retired quest id stays in validQuests for existing XP, but is never granted
// again: not through CompleteQuest, SyncQuests or SubmitQuestClaim.
func TestRetiredQuestIsNotGrantable(t *testing.T) {
	h := setup(t)
	h.stubChainVerify(true)
	token := h.makeToken(t, "g1alice")
	ctx := context.Background()

	if _, err := h.svc.CompleteQuest(ctx, connect.NewRequest(&membav1.CompleteQuestRequest{
		AuthToken: token, QuestId: "gnodaokit-extension",
	})); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("CompleteQuest: want InvalidArgument, got %v", err)
	}

	resp, err := h.svc.SyncQuests(ctx, connect.NewRequest(&membav1.SyncQuestsRequest{
		AuthToken:   token,
		Completions: []*membav1.QuestCompletion{{QuestId: "gnodaokit-extension"}},
	}))
	if err != nil {
		t.Fatal("SyncQuests:", err)
	}
	if resp.Msg.State.TotalXp != 0 {
		t.Fatalf("SyncQuests granted %d XP for a retired quest", resp.Msg.State.TotalXp)
	}

	if _, err := h.svc.SubmitQuestClaim(ctx, connect.NewRequest(&membav1.SubmitQuestClaimRequest{
		AuthToken: token, QuestId: "gnodaokit-extension", ProofUrl: "https://example.com/proof",
	})); err == nil {
		t.Fatal("SubmitQuestClaim must reject a retired quest")
	}
}
