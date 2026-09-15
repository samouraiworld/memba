import { NETWORKS } from './config'

export type ProfessionalLayout = 'workspace' | 'form' | 'reading' | 'social' | 'immersive'

/** Layout policy only. Routing, authentication and capability gates remain in App. */
export function professionalPage(pathname: string): { family: string; layout: ProfessionalLayout } {
    const [, network, ...parts] = pathname.split('/')
    if (!Object.hasOwn(NETWORKS, network || '')) return { family: 'system', layout: 'reading' }
    const path = parts.join('/').replace(/\/$/, '')
    if (!path || path === 'dashboard') return { family: 'home', layout: 'workspace' }
    if (/^game(?:\/|$)/.test(path)) return { family: 'games', layout: 'immersive' }
    if (/^(?:create|import|create-token|dao\/create|apps\/submit|nft\/create(?:\/advanced)?|candidature)$/.test(path)
        || /(?:\/propose|\/treasury\/propose)$/.test(path)) return { family: 'creation', layout: 'form' }
    if (/^dao\//.test(path)) return { family: 'governance', layout: /\/channels(?:\/|$)/.test(path) ? 'social' : 'workspace' }
    if (/^(?:multisig|tx|tokens)(?:\/|$)/.test(path)) return { family: 'assets', layout: 'workspace' }
    if (/^(?:validators|alerts)(?:\/|$)/.test(path)) return { family: 'network', layout: 'workspace' }
    if (/^(?:settings|organizations|profile|github|u)(?:\/|$)/.test(path)) return { family: 'account', layout: 'workspace' }
    if (/^(?:blog|changelogs|feedback)(?:\/|$)/.test(path)) return { family: 'editorial', layout: path.startsWith('blog/') ? 'reading' : 'workspace' }
    if (/^feed(?:\/|$)/.test(path)) return { family: 'community', layout: 'social' }
    if (/^(?:gnolove|quests|quest-admin|leaderboard|points)(?:\/|$)/.test(path)) return { family: 'community', layout: 'workspace' }
    if (/^(?:marketplace|marketplace-v2-preview|apps|nft|services)(?:\/|$)/.test(path)) return { family: 'commerce', layout: 'workspace' }
    return { family: 'discovery', layout: 'workspace' }
}
