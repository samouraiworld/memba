package engine

// RngNext is mulberry32 over uint32 state. It mirrors the TS rngNext exactly:
// Go's native uint32 multiplication wraps, matching JS Math.imul.
func RngNext(state uint32) (value uint32, next uint32) {
	a := state + 0x6D2B79F5
	t := (a ^ (a >> 15)) * (1 | a)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	value = t ^ (t >> 14)
	return value, a
}
