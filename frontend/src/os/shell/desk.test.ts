import { afterEach, describe, expect, it } from "vitest"
import {
    addItem, cellPosition, cleanUp, deskKey, FEATURED_DESK, freeSlot, itemForTarget, itemTarget, loadDesk, moveItem,
    nearestCell, removeItem, saveDesk, type DeskItem,
} from "./desk"
import { parseOsPath } from "./osPath"

const ADDR = "g103kjrkw6l0a9le0a0q0dsgy0uyt4jyha55cd4l"
afterEach(() => localStorage.clear())

describe("desk grid", () => {
    it("fills columns from the right edge, top to bottom", () => {
        let items: DeskItem[] = []
        for (const ref of ["daos", "wallet", "feed"]) items = addItem(items, { ty: "app", ref }, 2)
        expect(items.map(({ c, r }) => [c, r])).toEqual([[0, 0], [0, 1], [1, 0]])
        expect(freeSlot(removeItem(items, 1), 2)).toEqual({ c: 0, r: 1 })
    })

    it("never pins the same thing twice", () => {
        const items = addItem(addItem([], { ty: "dao", ref: "memba_dao" }), { ty: "dao", ref: "memba_dao" })
        expect(items).toHaveLength(1)
    })

    it("swaps with the item already in the drop cell", () => {
        const items: DeskItem[] = [{ ty: "app", ref: "feed", c: 0, r: 0 }, { ty: "app", ref: "wallet", c: 0, r: 1 }]
        const moved = moveItem(items, 0, 0, 1)
        expect(moved).toEqual([{ ty: "app", ref: "feed", c: 0, r: 1 }, { ty: "app", ref: "wallet", c: 0, r: 0 }])
        expect(moveItem(items, 1, 99, -4)[1]).toMatchObject({ c: 7, r: 0 })
    })

    it("cleans up into packed columns", () => {
        const items = Array.from({ length: 7 }, (_, i) => ({ ty: "app" as const, ref: "feed", c: 7, r: i % 6 }))
        expect(cleanUp(items).map(({ c, r }) => [c, r])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1]])
    })

    it("snaps a pixel position back to its cell", () => {
        for (const [c, r] of [[0, 0], [3, 2], [7, 5]]) {
            const p = cellPosition(c, r, 1400)
            expect(nearestCell(p.x + 20, p.y - 30, 1400)).toEqual({ c, r })
        }
    })
})

describe("desk items", () => {
    it("open what they stand for, validated like links", () => {
        expect(itemTarget({ ty: "prop", ref: "memba_dao:12" })).toEqual({ kind: "proposal", dao: "memba_dao", n: 12 })
        expect(itemTarget({ ty: "msig", ref: ADDR })).toEqual({ kind: "multisig", address: ADDR })
        expect(itemTarget({ ty: "app", ref: "nope" })).toBeNull()
        expect(itemTarget({ ty: "dao", ref: "a/b" })).toBeNull()
        expect(itemTarget({ ty: "prop", ref: "memba_dao:x" })).toBeNull()
    })

    it("come from pinnable windows only", () => {
        expect(itemForTarget(parseOsPath("/os/dao/memba_dao/proposals/12"))).toEqual({ ty: "prop", ref: "memba_dao:12" })
        expect(itemForTarget(parseOsPath("/os/nope"))).toBeNull()
        expect(itemForTarget(null)).toBeNull()
    })
})

describe("desk storage", () => {
    it("gives guests the featured desk and a new wallet an empty one", () => {
        expect(loadDesk(null)).toEqual(FEATURED_DESK)
        expect(loadDesk(ADDR)).toEqual([])
    })

    it("keeps one desk per wallet", () => {
        saveDesk(ADDR, [{ ty: "app", ref: "feed", c: 0, r: 0 }])
        expect(loadDesk(ADDR)).toHaveLength(1)
        expect(loadDesk(null)).toEqual(FEATURED_DESK)
        expect(localStorage.getItem(deskKey(ADDR))).toContain("feed")
    })

    it("drops malformed or hostile entries", () => {
        localStorage.setItem(deskKey(ADDR), JSON.stringify([
            { ty: "app", ref: "feed", c: 99, r: -3 }, { ty: "script", ref: "x" }, { ty: "dao", ref: "<img>" }, null, "x",
        ]))
        expect(loadDesk(ADDR)).toEqual([{ ty: "app", ref: "feed", c: 7, r: 0 }])
        localStorage.setItem(deskKey(ADDR), "not json")
        expect(loadDesk(ADDR)).toEqual([])
    })
})
