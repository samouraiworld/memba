package memba_nft_offers_v1

import (
    "std"
    "strings"

    "gno.land/p/demo/avl"
    "gno.land/p/demo/ufmt"
    "gno.land/p/samcrew/grc721"
    "gno.land/p/samcrew/memba_market_core"
    "gno.land/r/samcrew/memba_collections"
)

var (
    offers avl.Tree // offerKey(collectionID, buyer) -> *FloorOffer
    totalVolume int64
    paused bool
    feeRecipient std.Address
)

const (
    MinOfferDurationBlk = 1800
    MaxOfferDurationBlk = 1296000
    MaxOffersPerAddr = 50
    MaxOffers = 10000
    MinPrice = 1000000 // 1 GNOT
)

type FloorOffer struct {
    CollectionID string
    Buyer        std.Address
    Amount       int64
    CreatedBlk   int64
    ExpiryBlk    int64
}

func init() {
    feeRecipient = memba_market_core.AdminAddress
}

func offerKey(collectionID string, buyer std.Address) string {
    return collectionID + ":" + buyer.String()
}

func MakeFloorOffer(collectionID string, durationBlks int64) {
    if paused {
        panic("offers: paused")
    }

    // IsUserCall guard
    caller := std.PrevRealm().Addr()
    origin := std.GetOrigCaller()
    if caller != origin {
        panic("offers: smart contract calls not allowed")
    }

    amount := std.GetOrigSend().AmountOf("ugnot")
    if amount < MinPrice {
        panic("offers: amount below MinPrice")
    }

    if durationBlks < MinOfferDurationBlk {
        durationBlks = MinOfferDurationBlk
    }
    if durationBlks > MaxOfferDurationBlk {
        durationBlks = MaxOfferDurationBlk
    }

    expiry := std.GetHeight() + durationBlks
    key := offerKey(collectionID, caller)

    if offers.Has(key) {
        panic("offers: active offer exists, cancel first")
    }

    offer := &FloorOffer{
        CollectionID: collectionID,
        Buyer:        caller,
        Amount:       amount,
        CreatedBlk:   std.GetHeight(),
        ExpiryBlk:    expiry,
    }

    offers.Set(key, offer)

    // Emit event
    std.Emit("OfferMade", 
        "collection_id", collectionID,
        "token_id", "",
        "buyer", caller.String(),
        "amount", ufmt.Sprintf("%d", amount),
        "denom", "ugnot",
        "expiry_blk", ufmt.Sprintf("%d", expiry),
    )
}

func CancelFloorOffer(collectionID string) {
    caller := std.GetOrigCaller()
    key := offerKey(collectionID, caller)

    val, ok := offers.Get(key)
    if !ok {
        panic("offers: offer not found")
    }

    offer := val.(*FloorOffer)
    
    // MinOfferLifetimeBlk guard (from memba_market_core)
    if std.GetHeight() < offer.CreatedBlk + memba_market_core.MinOfferLifetimeBlk {
        panic("offers: cannot cancel before MinOfferLifetimeBlk")
    }

    offers.Remove(key)
    
    // Refund buyer
    banker := std.GetBanker(std.GetOrigPkgAddr())
    banker.SendCoins(std.GetOrigPkgAddr(), caller, std.Coins{{Denom: "ugnot", Amount: offer.Amount}})

    std.Emit("OfferCancelled", 
        "collection_id", collectionID,
        "token_id", "",
        "buyer", caller.String(),
    )
}

func AcceptFloorOffer(collectionID string, tid grc721.TokenID, buyer std.Address) {
    if paused {
        panic("offers: paused")
    }

    seller := std.GetOrigCaller()
    if buyer == seller {
        panic("offers: cannot accept own offer")
    }

    key := offerKey(collectionID, buyer)
    val, ok := offers.Get(key)
    if !ok {
        panic("offers: offer not found")
    }
    offer := val.(*FloorOffer)

    if std.GetHeight() >= offer.ExpiryBlk {
        panic("offers: expired")
    }

    // The moat seam: SplitProceeds + MarketTransfer
    // This requires actual memba_collections and memba_market_core methods
    // Since this is a stub, we simulate the structure
    
    offers.Remove(key)

    // Simulate emitting sale
    std.Emit("OfferAccepted", "collection_id", collectionID, "buyer", buyer.String())
}

func ClaimExpiredFloorOffer(collectionID string, buyer std.Address) {
    key := offerKey(collectionID, buyer)
    val, ok := offers.Get(key)
    if !ok {
        panic("offers: offer not found")
    }
    offer := val.(*FloorOffer)

    if std.GetHeight() < offer.ExpiryBlk {
        panic("offers: not expired")
    }

    offers.Remove(key)
    
    banker := std.GetBanker(std.GetOrigPkgAddr())
    banker.SendCoins(std.GetOrigPkgAddr(), buyer, std.Coins{{Denom: "ugnot", Amount: offer.Amount}})

    std.Emit("OfferExpiredClaimed", "collection_id", collectionID, "buyer", buyer.String())
}
