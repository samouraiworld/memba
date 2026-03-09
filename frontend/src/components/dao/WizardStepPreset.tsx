/**
 * WizardStepPreset — Step 1 of the DAO creation wizard.
 *
 * Lets the user choose a DAO preset (Community, Team, Treasury, Enterprise),
 * set name/description, and auto-generate a realm path.
 */
import { DAO_PRESETS, validateRealmPath, type DAOPreset } from "../../lib/daoTemplate"
import { FormField, inputStyle, ROLE_COLORS, ROLE_ICONS } from "./wizardShared"
import { House, UsersThree, Vault, Buildings } from "@phosphor-icons/react"
import type { ReactNode } from "react"

/** Map emoji icon strings from DAO_PRESETS to Phosphor components */
const PRESET_ICONS: Record<string, ReactNode> = {
    "🏠": <House size={22} />,
    "👥": <UsersThree size={22} />,
    "💰": <Vault size={22} />,
    "🏢": <Buildings size={22} />,
}

interface Props {
    name: string
    description: string
    realmPath: string
    selectedPreset: string | null
    walletAddress: string
    onNameChange: (v: string) => void
    onDescriptionChange: (v: string) => void
    onRealmPathChange: (v: string) => void
    onApplyPreset: (preset: DAOPreset) => void
    onAutoFill: () => void
    onNext: () => void
}

export function WizardStepPreset({
    name, description, realmPath, selectedPreset, walletAddress,
    onNameChange, onDescriptionChange, onRealmPathChange, onApplyPreset, onAutoFill, onNext,
}: Props) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Preset Cards */}
            <div className="k-card" style={{ padding: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0", marginBottom: 12 }}>DAO Type</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                    {DAO_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            onClick={() => onApplyPreset(preset)}
                            style={{
                                background: selectedPreset === preset.id ? "rgba(0,212,170,0.08)" : "rgba(255,255,255,0.02)",
                                border: selectedPreset === preset.id ? "1px solid rgba(0,212,170,0.4)" : "1px solid rgba(255,255,255,0.06)",
                                borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                                textAlign: "left", transition: "all 0.2s",
                            }}
                        >
                            <div style={{ fontSize: 20, marginBottom: 6 }}>{PRESET_ICONS[preset.icon] || preset.icon}</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: selectedPreset === preset.id ? "#00d4aa" : "#f0f0f0", marginBottom: 4 }}>
                                {preset.name}
                            </div>
                            <div style={{ fontSize: 10, color: "#888", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.4 }}>
                                {preset.description}
                            </div>
                            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {preset.roles.map((r) => (
                                    <span key={r} style={{
                                        fontSize: 9, padding: "2px 6px", borderRadius: 4,
                                        background: `${ROLE_COLORS[r] || "#888"}15`,
                                        color: ROLE_COLORS[r] || "#888",
                                        fontFamily: "JetBrains Mono, monospace",
                                    }}>
                                        {ROLE_ICONS[r] || "•"} {r}
                                    </span>
                                ))}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Name & Path */}
            <div className="k-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
                <FormField label="DAO Name" hint="Display name for your DAO">
                    <input
                        id="dao-name-input"
                        type="text"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="My DAO"
                        style={inputStyle}
                        maxLength={50}
                    />
                </FormField>

                <FormField label="Description" hint="Short description (optional)">
                    <textarea
                        id="dao-desc-input"
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        placeholder="A governance DAO for..."
                        style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                        maxLength={200}
                    />
                </FormField>

                <FormField label="Realm Path" hint="On-chain path (e.g., gno.land/r/username/mydao)">
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            id="dao-path-input"
                            type="text"
                            value={realmPath}
                            onChange={(e) => onRealmPathChange(e.target.value)}
                            placeholder="gno.land/r/username/mydao"
                            style={{ ...inputStyle, flex: 1 }}
                        />
                        {walletAddress && (
                            <button className="k-btn-secondary" onClick={onAutoFill} style={{ fontSize: 11, padding: "8px 12px", whiteSpace: "nowrap" }}>
                                Auto-fill
                            </button>
                        )}
                    </div>
                    {realmPath && validateRealmPath(realmPath) && (
                        <p style={{ color: "#f5a623", fontSize: 11, marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
                            ⚠ {validateRealmPath(realmPath)}
                        </p>
                    )}
                </FormField>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button className="k-btn-primary" onClick={onNext} style={{ fontSize: 13, padding: "10px 24px" }}>
                        Next: Members & Roles →
                    </button>
                </div>
            </div>
        </div>
    )
}
