import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './prototype-controls.css'

/** React versions of the final pill-btn, icon-btn, tabs and card in index.html. */
export function PrototypeButton({ primary = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button {...props} className={`prototype-button ${primary ? 'is-primary' : ''} ${className}`} />
}

export function PrototypeIconButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="prototype-icon-button" />
}

export function PrototypeSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`prototype-surface ${className}`}>{children}</section>
}

export function PrototypeNavigation({ activity }: { activity: boolean }) {
  return <nav className="prototype-navigation" aria-label="Main navigation">
    <a href="#connect" aria-current={!activity ? 'page' : undefined}>Vaults</a>
    <a href="#activity" aria-current={activity ? 'page' : undefined}>Activity</a>
  </nav>
}
