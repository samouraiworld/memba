import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DeploymentPipeline, type DeploymentPipelineProps } from "./DeploymentPipeline"

// Mock config module to avoid import issues in test env
vi.mock("../../lib/config", () => ({
    getExplorerBaseUrl: () => "https://pearl.testnets.gno.land",
    GNO_CHAIN_ID: "pearl-1",
}))

// 32-byte hash in both wallet shapes: Adena ≥1.20.5 hands back lowercase hex,
// older Adena and the raw broadcast_tx_commit fallback hand back base64.
const TX_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
const TX_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

const baseProps: DeploymentPipelineProps = {
    active: true,
    currentStep: "preparing",
    onNavigate: vi.fn(),
}

describe("DeploymentPipeline", () => {
    it("renders nothing when active is false", () => {
        const { container } = render(<DeploymentPipeline {...baseProps} active={false} />)
        expect(container.firstChild).toBeNull()
    })

    it("renders nothing when step is idle", () => {
        const { container } = render(<DeploymentPipeline {...baseProps} currentStep="idle" />)
        expect(container.firstChild).toBeNull()
    })

    it("shows all 4 step labels when active", () => {
        render(<DeploymentPipeline {...baseProps} />)
        expect(screen.getByText("Preparing")).toBeInTheDocument()
        expect(screen.getByText("Signing")).toBeInTheDocument()
        expect(screen.getByText("Broadcasting")).toBeInTheDocument()
        expect(screen.getByText("Confirmed")).toBeInTheDocument()
    })

    it("shows Deploying header during progress", () => {
        render(<DeploymentPipeline {...baseProps} currentStep="signing" />)
        expect(screen.getByText("🚀 Deploying...")).toBeInTheDocument()
    })

    it("renders completion card when step is complete", () => {
        const result = {
            txHash: "abc123def456",
            realmPath: "gno.land/r/user/mydao",
            entityLabel: "DAO",
            entityName: "My DAO",
        }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
            />,
        )
        expect(screen.getByText("🎉 Deployment Complete")).toBeInTheDocument()
        expect(screen.getByText("DAO deployed successfully!")).toBeInTheDocument()
        expect(screen.getByText("My DAO")).toBeInTheDocument()
        expect(screen.getByText("gno.land/r/user/mydao")).toBeInTheDocument()
        expect(screen.getByText("Open DAO →")).toBeInTheDocument()
    })

    it("links the TX hash to gnoscan's chain-aware transaction page", () => {
        const result = { txHash: TX_HEX, entityLabel: "Token" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
            />,
        )
        const txLink = screen.getByText("0001020304050607…")
        expect(txLink.closest("a")).toHaveAttribute(
            "href",
            `https://gnoscan.io/transactions/details?txhash=${TX_HEX}&chainId=pearl-1`,
        )
    })

    it("shows a base64 wallet hash in the same hex form and links it the same way", () => {
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={{ txHash: TX_B64, entityLabel: "Token" }}
            />,
        )
        const txLink = screen.getByText("0001020304050607…")
        expect(txLink.closest("a")).toHaveAttribute(
            "href",
            `https://gnoscan.io/transactions/details?txhash=${TX_HEX}&chainId=pearl-1`,
        )
    })

    it("renders an unrecognized hash as plain text rather than a dead link", () => {
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={{ txHash: "abc123def456789012345678", entityLabel: "Token" }}
            />,
        )
        const txText = screen.getByText("abc123def4567890…")
        expect(txText.tagName).toBe("CODE")
        expect(txText.closest("a")).toBeNull()
        expect(document.getElementById("deploy-tx-link")).toBeNull()
    })

    it("shows explorer link for realm paths", () => {
        const result = { realmPath: "gno.land/r/user/mydao", entityLabel: "DAO" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
            />,
        )
        const explorerLink = screen.getByText("View on Explorer →")
        expect(explorerLink.closest("a")).toHaveAttribute("href", "https://pearl.testnets.gno.land/r/user/mydao")
    })

    it("shows error when step is error", () => {
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="error"
                error="Insufficient gas"
            />,
        )
        expect(screen.getByText("⚠️ Deployment Failed")).toBeInTheDocument()
        expect(screen.getByText("Insufficient gas")).toBeInTheDocument()
    })

    it("calls onNavigate when navigate button clicked", () => {
        const onNavigate = vi.fn()
        const result = { entityLabel: "DAO" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
                onNavigate={onNavigate}
            />,
        )
        fireEvent.click(screen.getByText("Open DAO →"))
        expect(onNavigate).toHaveBeenCalledOnce()
    })

    it("calls onRetry when retry button clicked", () => {
        const onRetry = vi.fn()
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="error"
                error="Failed"
                onRetry={onRetry}
            />,
        )
        fireEvent.click(screen.getByText("↻ Retry"))
        expect(onRetry).toHaveBeenCalledOnce()
    })

    it("calls onClose when close button clicked", () => {
        const onClose = vi.fn()
        const result = { entityLabel: "DAO" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
                onClose={onClose}
            />,
        )
        fireEvent.click(screen.getByLabelText("Close"))
        expect(onClose).toHaveBeenCalledOnce()
    })

    // v2.9: Modal overlay tests
    it("renders modal overlay when active", () => {
        render(<DeploymentPipeline {...baseProps} />)
        expect(screen.getByTestId("deploy-overlay")).toBeInTheDocument()
    })

    it("locks body scroll when active", () => {
        const { unmount } = render(<DeploymentPipeline {...baseProps} />)
        expect(document.body.style.overflow).toBe("hidden")
        unmount()
        expect(document.body.style.overflow).toBe("")
    })

    it("calls onClose on overlay click when dismissible", () => {
        const onClose = vi.fn()
        const result = { entityLabel: "DAO" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
                onClose={onClose}
            />,
        )
        fireEvent.click(screen.getByTestId("deploy-overlay"))
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("does NOT close on overlay click during progress", () => {
        const onClose = vi.fn()
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="signing"
                onClose={onClose}
            />,
        )
        fireEvent.click(screen.getByTestId("deploy-overlay"))
        expect(onClose).not.toHaveBeenCalled()
    })
})
