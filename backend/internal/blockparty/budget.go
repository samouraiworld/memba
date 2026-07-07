package blockparty

// MoveBudget is the ranked-daily move cap for a modifier. Server-authoritative:
// SubmitScore rejects logs longer than this, and GetDailyChallenge returns it so
// the client stops the ranked run at the same point.
func MoveBudget(modifier string) int {
	if modifier == "rush" {
		return 24
	}
	return 30
}
