/** Asset substitution shared by HTML and build output. No remote fetches or runtime feature activation. */
export const PROFESSIONAL_BRAND = {
    icon: '/brand/folded-m/favicon-32.png',
    touchIcon: '/brand/folded-m/apple-touch-icon.png',
    share: '/brand/folded-m/share.png',
} as const
export function professionalBrandHtml(html: string): string {
    return html.replaceAll('/memba-icon.png', PROFESSIONAL_BRAND.icon)
        .replaceAll('/apple-touch-icon.png', PROFESSIONAL_BRAND.touchIcon)
        .replaceAll('/og-image.jpg', PROFESSIONAL_BRAND.share)
        .replace('content="image/jpeg"', 'content="image/png"')
}
