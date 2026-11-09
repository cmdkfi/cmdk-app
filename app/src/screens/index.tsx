import type { Route } from '../flow/routes.ts'
import { Placeholder } from './Placeholder.tsx'

export type ScreenProps = { href: (route: Route) => string }

export function Choose({ href }: ScreenProps) {
  return <Placeholder label="S1 · Choose" title="Borrow USDC against ETH. Keep risk on autopilot." phase="Phase 2">
    <a className="prototype-button is-primary" href={href('settings')}>Continue</a>
  </Placeholder>
}

export function Settings({ href }: ScreenProps) {
  return <Placeholder label="S2 · Settings" title="Your protection, in one picture" phase="Phase 2">
    <a className="prototype-button" href={href('start')}>Back</a>
    <a className="prototype-button is-primary" href={href('connect')}>Continue to wallet</a>
  </Placeholder>
}

export function Connect({ href }: ScreenProps) {
  return <Placeholder label="S3 · Connect" title="Connect MetaMask" phase="Phase 2">
    <a className="prototype-button" href={href('settings')}>Back</a>
  </Placeholder>
}

export function Progress() {
  return <Placeholder label="S4 · Progress" title="Opening your position" phase="Phase 3" />
}

export function Position() {
  return <Placeholder label="S5 · Position" title="Your position" phase="Phase 4" />
}
