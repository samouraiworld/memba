/**
 * Settings → Privacy: what the optional account stores, why, where, for how
 * long, and how to take it out. Every statement here must stay true: change
 * it with the code it describes.
 *
 * @module os/account/PrivacyView
 */
export function PrivacyView() {
    return <>
        <header><h2>Privacy</h2><p className="os-sub">This page covers the optional Memba account and its emails. Browsing, your wallet and everything on chain need no account.</p></header>
        <div className="os-set-card"><h3>What we store, and why</h3>
            <ul>
                <li>Your sign-in identity and your verified email address, to know it is you and where to write.</li>
                <li>The emails you chose (announcements, newsletter, early access and its apps), each with when you asked, the wording you saw and when you confirmed: proof that you asked.</li>
                <li>For validator alerts: your name, email, webhooks, alert contacts and daily report time, kept by gnomonitoring, Samourai's validator monitoring service.</li>
            </ul>
            <p>Nothing is sold or shared for advertising. Emails carry no open or click tracking.</p>
            <p>Like every Memba page, these pages report the page address to Plausible (anonymous page views, no cookies) and to Sentry (error reports), with confirmation-link tokens and meeting codes removed first.</p>
        </div>
        <div className="os-set-card"><h3>Where</h3>
            <ul>
                <li>Memba's backend, hosted by Fly.io in Paris, with its database backups in an S3-compatible bucket.</li>
                <li>Clerk, the sign-in service, which stores your sign-in identity in the United States.</li>
                <li>Resend, which sends Memba's emails and stores your address and chosen emails in the United States, under a data processing agreement with standard contractual clauses.</li>
                <li>gnomonitoring, for validator alerts only.</li>
            </ul>
        </div>
        <div className="os-set-card"><h3>How long</h3>
            <p>Until you delete your account. A request you never confirm is deleted within about 8 days (it expires after 7, and a daily cleanup removes it). Deleted data can remain up to 7 days in the backups of Memba's database, and in the database file itself until its space is reused.</p>
        </div>
        <div className="os-set-card"><h3>Your data</h3>
            <p>Settings → Account: download your account and every email request you made, stop any email, or delete your account. Deleting removes your Memba data with its consent history, your address at Resend, your validator alerts and your sign-in account. On-chain data cannot be deleted by anyone and is not affected.</p>
            <p>Questions: <a href="mailto:privacy@memba.club">privacy@memba.club</a>.</p>
        </div>
    </>
}
