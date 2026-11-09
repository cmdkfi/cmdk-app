import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

/** React versions of the final pill-btn, icon-btn, tabs and card in index.html. */
export function PrototypeButton({ primary = false, className = '', buttonRef, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  return <button ref={buttonRef} {...props} className={`prototype-button ${primary ? 'is-primary' : ''} ${className}`} />
}

export function PrototypeIconButton({buttonRef,...props}: ButtonHTMLAttributes<HTMLButtonElement> & {buttonRef?:Ref<HTMLButtonElement>}) {
  return <button ref={buttonRef} {...props} className="prototype-icon-button" />
}

export function PrototypeSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`prototype-surface ${className}`}>{children}</section>
}
