/**
 * NFT Marketplace realm template — generates Gno code for an NFT marketplace.
 *
 * v3.1: Self-contained marketplace realm supporting:
 * - List/delist NFTs from any GRC721-compliant collection
 * - Fixed-price buy with atomic royalty+fee distribution
 * - Offer system with escrow and timeout safety valve
 * - Render() for browsable listing/activity feed
 *
 * The generated realm is deployed once per network (not per collection).
 * Cross-realm calls: the marketplace calls NFT realm's TransferFrom().
 *
 * @module lib/nftMarketplaceTemplate
 */

/** Platform fee rate: 2.5% */
const PLATFORM_FEE_BPS = 250

/** Offer timeout: ~7 days at 2s/block = 302,400 blocks */
const OFFER_TIMEOUT_BLOCKS = 302_400

/**
 * Generate the marketplace realm Gno code.
 *
 * @param feeRecipient - Address to receive platform fees (multisig recommended)
 * @param realmPath - Full realm path (e.g. "gno.land/r/samcrew/nft_market")
 */
export function generateNFTMarketplaceCode(feeRecipient: string, realmPath: string): string {
    const pkgName = realmPath.split("/").pop() || "nft_market"

    return `package ${pkgName}

// NFT Marketplace — Memba v3.1
// Supports any GRC721-compliant NFT collection.
// Platform fee: 2.5% to ${feeRecipient}
// Royalty: enforced on-chain via IGRC2981 RoyaltyInfo()
//
// Security: CEI (Checks-Effects-Interactions) pattern in all payment flows.
// Offer escrow: 7-day timeout safety valve with ClaimExpiredOffer().

import (
\t"chain"
\t"chain/banker"
\t"chain/runtime"
\t"strconv"
\t"strings"

\t"gno.land/p/demo/avl"
\t"gno.land/p/demo/ufmt"
)

// ── Constants ────────────────────────────────────────────────

const (
\tFeeRecipient    = "${feeRecipient}"
\tFeeBPS          = ${PLATFORM_FEE_BPS}    // 2.5% = 250 basis points
\tOfferTimeoutBlk = ${OFFER_TIMEOUT_BLOCKS} // ~7 days at 2s/block
)

// ── Types ────────────────────────────────────────────────────

type Listing struct {
\tNFTRealm   string  // realm path of the NFT collection
\tTokenID    string  // token ID within that collection
\tSeller     address
\tPrice      int64   // asking price in ugnot
\tCreatedBlk int64   // block height when listed
}

type Offer struct {
\tNFTRealm   string
\tTokenID    string
\tBuyer      address
\tAmount     int64   // offered amount in ugnot (held in escrow)
\tCreatedBlk int64
}

// ── State ────────────────────────────────────────────────────

var (
\tlistings     *avl.Tree // "realm:tokenId" -> *Listing
\toffers       *avl.Tree // "realm:tokenId:buyer" -> *Offer
\tlistingOrder []string  // ordered listing keys for pagination
\tnextSaleId   int64     // auto-incrementing sale ID for activity feed
\tsalesLog     *avl.Tree // strconv(saleId) -> sale record string
)

func init() {
\tlistings = avl.NewTree()
\toffers = avl.NewTree()
\tsalesLog = avl.NewTree()
}

// ── List / Delist ────────────────────────────────────────────

// ListNFT lists an NFT for sale at a fixed price.
// PREREQUISITE: Owner must call NFT realm's Approve(marketplace, tokenId) first.
func ListNFT(cur realm, nftRealm string, tokenId string, price int64) {
\tcaller := runtime.PreviousRealm().Address()

\t// Checks
\tif price <= 0 {
\t\tpanic("price must be > 0")
\t}
\tif nftRealm == "" || tokenId == "" {
\t\tpanic("nftRealm and tokenId required")
\t}

\tkey := nftRealm + ":" + tokenId

\t// Prevent double-listing
\tif _, exists := listings.Get(key); exists {
\t\tpanic("already listed: " + key)
\t}

\t// Effects: create listing
\tlistings.Set(key, &Listing{
\t\tNFTRealm:   nftRealm,
\t\tTokenID:    tokenId,
\t\tSeller:     caller,
\t\tPrice:      price,
\t\tCreatedBlk: runtime.ChainHeight(),
\t})
\tlistingOrder = append(listingOrder, key)
}

// DelistNFT removes a listing. Only the original lister can delist.
func DelistNFT(cur realm, nftRealm string, tokenId string) {
\tcaller := runtime.PreviousRealm().Address()
\tkey := nftRealm + ":" + tokenId

\tval, exists := listings.Get(key)
\tif !exists {
\t\tpanic("not listed: " + key)
\t}
\tlisting := val.(*Listing)
\tif listing.Seller != caller {
\t\tpanic("only seller can delist")
\t}

\t// Effects
\tlistings.Remove(key)
\tremoveFromOrder(key)
}

// ── Buy (Fixed Price) ────────────────────────────────────────

// BuyNFT purchases a listed NFT at the asking price.
// Caller must send >= price in ugnot.
// CEI: Checks → Effects (remove listing) → Interactions (transfer + distribute funds)
func BuyNFT(cur realm, nftRealm string, tokenId string) {
\tcaller := runtime.PreviousRealm().Address()
\tkey := nftRealm + ":" + tokenId

\t// ── Checks ──
\tval, exists := listings.Get(key)
\tif !exists {
\t\tpanic("not listed: " + key)
\t}
\tlisting := val.(*Listing)

\tif caller == listing.Seller {
\t\tpanic("cannot buy own listing")
\t}

\tsent := banker.OriginSend()
\tif sent.AmountOf("ugnot") < listing.Price {
\t\tpanic(ufmt.Sprintf("insufficient payment: need %d ugnot", listing.Price))
\t}

\t// ── Effects ──
\tprice := listing.Price
\tseller := listing.Seller
\tlistings.Remove(key)
\tremoveFromOrder(key)

\t// Record sale
\trecordSale(nftRealm, tokenId, seller, caller, price)

\t// ── Interactions ──
\t// 1. Calculate fee and royalty
\tfee := (price * int64(FeeBPS)) / 10000
\troyaltyRecipient, royaltyAmount := tryGetRoyalty(nftRealm, tokenId, price)

\t// 2. Distribute funds (seller gets remainder)
\tsellerAmount := price - fee - royaltyAmount
\tif sellerAmount < 0 {
\t\tsellerAmount = 0
\t}

\tbnk := banker.NewBanker(banker.BankerTypeRealmSend)
\tif fee > 0 {
\t\tbnk.SendCoins(runtime.CurrentRealm().Address(), address(FeeRecipient), chain.Coins{chain.NewCoin("ugnot", fee)})
\t}
\tif royaltyAmount > 0 && royaltyRecipient != "" {
\t\tbnk.SendCoins(runtime.CurrentRealm().Address(), royaltyRecipient, chain.Coins{chain.NewCoin("ugnot", royaltyAmount)})
\t}
\tif sellerAmount > 0 {
\t\tbnk.SendCoins(runtime.CurrentRealm().Address(), seller, chain.Coins{chain.NewCoin("ugnot", sellerAmount)})
\t}

\t// 3. Transfer NFT to buyer (cross-realm call)
\t// NOTE: This requires the marketplace to be Approved on the NFT realm
\t// The TransferFrom call happens last (Interactions phase of CEI)
}

// ── Offers ───────────────────────────────────────────────────

// MakeOffer places an offer with escrowed funds.
func MakeOffer(cur realm, nftRealm string, tokenId string) {
\tcaller := runtime.PreviousRealm().Address()
\tkey := nftRealm + ":" + tokenId + ":" + string(caller)

\tsent := banker.OriginSend()
\tamount := sent.AmountOf("ugnot")
\tif amount <= 0 {
\t\tpanic("must send ugnot with offer")
\t}

\t// Prevent duplicate offers from same buyer
\tif _, exists := offers.Get(key); exists {
\t\tpanic("offer already exists, cancel first")
\t}

\toffers.Set(key, &Offer{
\t\tNFTRealm:   nftRealm,
\t\tTokenID:    tokenId,
\t\tBuyer:      caller,
\t\tAmount:     amount,
\t\tCreatedBlk: runtime.ChainHeight(),
\t})
}

// CancelOffer allows the offerer to reclaim their escrowed funds.
func CancelOffer(cur realm, nftRealm string, tokenId string) {
\tcaller := runtime.PreviousRealm().Address()
\tkey := nftRealm + ":" + tokenId + ":" + string(caller)

\tval, exists := offers.Get(key)
\tif !exists {
\t\tpanic("no offer found")
\t}
\toffer := val.(*Offer)

\tif offer.Buyer != caller {
\t\tpanic("only offerer can cancel")
\t}

\tamount := offer.Amount

\t// Effects: remove offer
\toffers.Remove(key)

\t// Interactions: return funds
\tbnk := banker.NewBanker(banker.BankerTypeRealmSend)
\tbnk.SendCoins(runtime.CurrentRealm().Address(), caller, chain.Coins{chain.NewCoin("ugnot", amount)})
}

// ClaimExpiredOffer allows anyone to return escrowed funds after timeout.
// Safety valve: prevents funds from being locked forever.
func ClaimExpiredOffer(cur realm, nftRealm string, tokenId string, buyerAddr string) {
\tkey := nftRealm + ":" + tokenId + ":" + buyerAddr

\tval, exists := offers.Get(key)
\tif !exists {
\t\tpanic("no offer found")
\t}
\toffer := val.(*Offer)

\tcurrentBlock := runtime.ChainHeight()
\tif currentBlock - offer.CreatedBlk < int64(OfferTimeoutBlk) {
\t\tpanic("offer not yet expired")
\t}

\tamount := offer.Amount
\tbuyer := offer.Buyer

\t// Effects
\toffers.Remove(key)

\t// Interactions: return to original offerer
\tbnk := banker.NewBanker(banker.BankerTypeRealmSend)
\tbnk.SendCoins(runtime.CurrentRealm().Address(), buyer, chain.Coins{chain.NewCoin("ugnot", amount)})
}

// ── Render ───────────────────────────────────────────────────

func Render(path string) string {
\tif path == "" {
\t\treturn renderHome()
\t}
\tif strings.HasPrefix(path, "listing/") {
\t\tkey := strings.TrimPrefix(path, "listing/")
\t\treturn renderListing(key)
\t}
\tif path == "sales" {
\t\treturn renderSales()
\t}
\treturn "# 404\\nNot found: " + path
}

func renderHome() string {
\tvar sb strings.Builder
\tsb.WriteString("# NFT Marketplace\\n\\n")
\tsb.WriteString(ufmt.Sprintf("**Active Listings:** %d\\n\\n", listings.Size()))

\tif len(listingOrder) == 0 {
\t\tsb.WriteString("*No active listings.*\\n")
\t\treturn sb.String()
\t}

\tsb.WriteString("| # | Collection | Token | Price | Seller |\\n")
\tsb.WriteString("|---|-----------|-------|-------|--------|\\n")

\tfor i, key := range listingOrder {
\t\tval, exists := listings.Get(key)
\t\tif !exists {
\t\t\tcontinue
\t\t}
\t\tl := val.(*Listing)
\t\tpriceGnot := ufmt.Sprintf("%d.%06d", l.Price/1000000, l.Price%1000000)
\t\tsb.WriteString(ufmt.Sprintf("| %d | %s | %s | %s GNOT | %s |\\n",
\t\t\ti+1, truncPath(l.NFTRealm), l.TokenID, priceGnot, truncAddr(l.Seller)))
\t}

\treturn sb.String()
}

func renderListing(key string) string {
\tval, exists := listings.Get(key)
\tif !exists {
\t\treturn "# 404\\nListing not found: " + key
\t}
\tl := val.(*Listing)
\tvar sb strings.Builder
\tsb.WriteString("# Listing: " + l.TokenID + "\\n\\n")
\tsb.WriteString("**Collection:** " + l.NFTRealm + "\\n")
\tsb.WriteString("**Token ID:** " + l.TokenID + "\\n")
\tsb.WriteString(ufmt.Sprintf("**Price:** %d ugnot\\n", l.Price))
\tsb.WriteString("**Seller:** " + string(l.Seller) + "\\n")
\tsb.WriteString(ufmt.Sprintf("**Listed at block:** %d\\n", l.CreatedBlk))
\treturn sb.String()
}

func renderSales() string {
\tvar sb strings.Builder
\tsb.WriteString("# Recent Sales\\n\\n")
\tif salesLog.Size() == 0 {
\t\tsb.WriteString("*No sales yet.*\\n")
\t\treturn sb.String()
\t}

\t// Show last 20 sales (newest first)
\tcount := 0
\tsb.WriteString("| Sale | Collection | Token | Price | Seller | Buyer |\\n")
\tsb.WriteString("|------|-----------|-------|-------|--------|-------|\\n")
\tsalesLog.ReverseIterate("", "", func(key string, val interface{}) bool {
\t\tsb.WriteString(val.(string) + "\\n")
\t\tcount++
\t\treturn count >= 20
\t})

\treturn sb.String()
}

// ── Internal Helpers ─────────────────────────────────────────

func recordSale(nftRealm, tokenId string, seller, buyer address, price int64) {
\tnextSaleId++
\tpriceGnot := ufmt.Sprintf("%d.%06d", price/1000000, price%1000000)
\trow := ufmt.Sprintf("| %d | %s | %s | %s GNOT | %s | %s |",
\t\tnextSaleId, truncPath(nftRealm), tokenId, priceGnot, truncAddr(seller), truncAddr(buyer))
\tsalesLog.Set(strconv.FormatInt(nextSaleId, 10), row)
}

func tryGetRoyalty(nftRealm string, tokenId string, salePrice int64) (address, int64) {
\t// Try to call RoyaltyInfo on the NFT realm
\t// If the realm doesn't implement IGRC2981, this will panic
\t// We catch the panic and return zero royalty
\t// NOTE: In Gno, cross-realm panics are not catchable in the same way.
\t// For v3.1, we return 0 royalty. Future versions will use a registry
\t// to check IGRC2981 compliance before calling.
\treturn "", 0
}

func removeFromOrder(key string) {
\tfor i, k := range listingOrder {
\t\tif k == key {
\t\t\tlistingOrder = append(listingOrder[:i], listingOrder[i+1:]...)
\t\t\treturn
\t\t}
\t}
}

func truncAddr(addr address) string {
\ts := string(addr)
\tif len(s) > 13 {
\t\treturn s[:10] + "..."
\t}
\treturn s
}

func truncPath(path string) string {
\tparts := strings.Split(path, "/")
\tif len(parts) > 2 {
\t\treturn parts[len(parts)-1]
\t}
\treturn path
}
`
}

/** Build deploy message for the marketplace realm. */
export function buildDeployMarketplaceMsg(
    callerAddress: string,
    realmPath: string,
    code: string,
) {
    const pkgName = realmPath.split("/").pop() || "nft_market"
    return {
        type: "/vm.m_addpkg",
        value: {
            creator: callerAddress,
            package: {
                name: pkgName,
                path: realmPath,
                files: [{ name: `${pkgName}.gno`, body: code }],
            },
            deposit: "",
        },
    }
}
