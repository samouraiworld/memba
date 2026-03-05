import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DeploymentPipeline, type DeploymentPipelineProps } from "./DeploymentPipeline"

// Mock config module to avoid import issues in test env
vi.mock("../../lib/config", () => ({
    getExplorerBaseUrl: () => "https://gnoscan.io",
}))

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

    it("shows TX hash link in completion state", () => {
        const result = { txHash: "abc123def456789012345678", entityLabel: "Token" }
        render(
            <DeploymentPipeline
                {...baseProps}
                currentStep="complete"
                result={result}
            />,
        )
        const txLink = screen.getByText("abc123def4567890…")
        expect(txLink).toBeInTheDocument()
        expect(txLink.closest("a")).toHaveAttribute("href", "https://gnoscan.io/tx/abc123def456789012345678")
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
        expect(explorerLink.closest("a")).toHaveAttribute("href", "https://gnoscan.io/r/user/mydao")
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
})
