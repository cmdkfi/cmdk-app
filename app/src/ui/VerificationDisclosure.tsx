import type {ReactNode} from 'react'

export function VerificationIcon({kind}:{kind:'chevron'|'copy'|'check'|'refresh'|'more'}) {
 return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{kind==='chevron'?<path d="m6 9 6 6 6-6"/>:kind==='check'?<path d="m5 12 4 4L19 6"/>:kind==='copy'?<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>:kind==='refresh'?<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></>:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>}</svg>
}

export function VerificationDisclosure({title,status,children}:{title:string;status?:string;children:ReactNode}) {
 return <details className="verification-disclosure verification-accordion"><summary><span>{title}</span>{status&&<span className="verification-section-status">{status}</span>}<span className="verification-chevron"><VerificationIcon kind="chevron"/></span></summary><div className="verification-section-body">{children}</div></details>
}
