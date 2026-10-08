// Package activitywatch relays confirmed realm activity to the shared Memba
// Discord channel. It is independent of the Launchpad accounting alarm.
package activitywatch

import (
	"errors"
	"net/url"
	"regexp"
	"strings"
)

const DefaultRPC = "https://rpc.mainnet.samourai.live"

type Config struct {
	ChainID, RPCURL, WebhookURL string
	// Exact realm paths or subtree selectors ending in /*. No substring matches.
	Realms []string
}

var pathPattern = regexp.MustCompile(`^gno\.land/r/[a-zA-Z0-9_/-]+$`)
var chainPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func ConfigFromEnv(getenv func(string) string) Config {
	c := Config{ChainID: getenv("GNO_CHAIN_ID"), RPCURL: getenv("MEMBA_ACTIVITY_WATCH_RPC_URL"), WebhookURL: getenv("LAUNCHPAD_WATCH_WEBHOOK_URL")}
	if c.RPCURL == "" {
		c.RPCURL = DefaultRPC
	}
	s := getenv("MEMBA_ACTIVITY_WATCH_REALMS")
	if s == "" {
		s = "gno.land/r/samcrew/*"
	}
	for _, r := range strings.Split(s, ",") {
		c.Realms = append(c.Realms, strings.TrimSpace(r))
	}
	return c
}

func (c Config) validate() error {
	if !chainPattern.MatchString(c.ChainID) || len(c.Realms) == 0 || len(c.Realms) > 100 {
		return errors.New("activity watcher needs a chain and 1–100 realm selectors")
	}
	for _, s := range c.Realms {
		p := strings.TrimSuffix(s, "/*")
		if !pathPattern.MatchString(p) || strings.Contains(p, "//") || strings.HasSuffix(p, "/") || len(p) > 250 {
			return errors.New("invalid activity realm selector")
		}
	}
	u, err := url.Parse(c.RPCURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("activity watcher needs an HTTPS RPC URL without credentials or query")
	}
	u, err = url.Parse(c.WebhookURL)
	if err != nil || u.Scheme != "https" || u.Host != "discord.com" || u.User != nil || u.Fragment != "" {
		return errors.New("activity watcher needs a discord.com HTTPS webhook")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "webhooks" || parts[2] == "" || parts[3] == "" {
		return errors.New("invalid Discord webhook path")
	}
	return nil
}

func (c Config) watches(path string) bool {
	for _, s := range c.Realms {
		if strings.HasSuffix(s, "/*") {
			if strings.HasPrefix(path, strings.TrimSuffix(s, "*")) {
				return true
			}
		} else if path == s {
			return true
		}
	}
	return false
}
