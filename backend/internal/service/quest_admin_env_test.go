package service

import "testing"

func TestQuestAdminAddresses_DefaultWhenUnset(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", "")
	admins := questAdminAddresses()
	if !admins["g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"] {
		t.Fatal("expected the built-in default admin when QUEST_ADMIN_ADDRESSES is unset")
	}
}

func TestQuestAdminAddresses_EnvOverride(t *testing.T) {
	t.Setenv("QUEST_ADMIN_ADDRESSES", " g1aaa , ,g1bbb ")
	admins := questAdminAddresses()
	if !admins["g1aaa"] || !admins["g1bbb"] {
		t.Fatalf("expected {g1aaa, g1bbb} from env (trimmed, blanks dropped), got %v", admins)
	}
	if admins["g1x7k4628w93a7wzdhqc06atzx0v50rnshweuxu0"] {
		t.Fatal("env override must REPLACE the default, not merge with it")
	}
}
