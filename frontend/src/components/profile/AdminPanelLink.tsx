import { lazy, Suspense } from "react"
import { useClerkAuth } from "../../hooks/useClerkAuth"

// Must lazy load since Clerk is isolated
const ClerkProvider = lazy(() => import("../auth/ClerkProvider"))

function AdminPanelLinkInner() {
    const auth = useClerkAuth()
    
    // Only show if Clerk loaded, logged in, and user has the admin role
    if (!auth.isLoaded || !auth.isSignedIn || !auth.isAdmin) return null

    return (
        <a 
            href="https://panel.memba.samourai.app" 
            target="_blank" 
            rel="noopener noreferrer"
            style={{ 
                display: "inline-flex", 
                alignItems: "center", 
                gap: 6,
                color: "#00d4aa",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                background: "rgba(0, 212, 170, 0.08)",
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(0, 212, 170, 0.2)",
                marginLeft: 12
            }}
            title="Open Admin Panel"
        >
            <span style={{ fontSize: 14 }}>⚙️</span> Admin Panel ↗
        </a>
    )
}

export function AdminPanelLink() {
    return (
        <Suspense fallback={null}>
            <ClerkProvider>
                <AdminPanelLinkInner />
            </ClerkProvider>
        </Suspense>
    )
}
