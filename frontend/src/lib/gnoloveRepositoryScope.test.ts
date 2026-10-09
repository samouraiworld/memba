import { describe, it, expect } from "vitest"
import { resolveRepositoryScope } from "./gnoloveRepositoryScope"
import type { TRepository } from "./gnoloveSchemas"

const repo = (id: string, status?: string): TRepository => ({ id, owner: id.split("/")[0], name: id.split("/")[1], baseBranch: "main", status })
describe("repository scope", () => {
    it("defaults honestly to core and preserves custom links", () => {
        expect(resolveRepositoryScope([], false)).toEqual(["gnolang/gno"])
        expect(resolveRepositoryScope(["samouraiworld/memba"], false)).toEqual(["samouraiworld/memba"])
    })
    it("waits for the catalogue instead of sending an omitted filter", () => {
        expect(resolveRepositoryScope([], true)).toBeNull()
        expect(resolveRepositoryScope([], true, [])).toBeNull()
        expect(resolveRepositoryScope([], true, [repo("org/private", "private")])).toBeNull()
    })
    it("includes every available repo with the legacy API and omits private/unavailable entries", () => {
        expect(resolveRepositoryScope([], true, [repo("gnolang/gno"), repo("samouraiworld/memba"), repo("org/unavailable", "unavailable"), repo("org/private", "private")])).toEqual(["gnolang/gno", "samouraiworld/memba"])
    })
})
