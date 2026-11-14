import { Stage } from '../stageshow-kit/stage.tsx'
import type { Act } from '../stageshow-kit/act.ts'
import { Window } from '../stageshow-kit/window.tsx'
import './ProtectionStage.css'

type Scene = { step: 0 | 1 | 2 | 3 }
const initial: Scene = { step: 0 }
const poster: Scene = { step: 3 }

async function script(act: Act<Scene>) {
  await act.wait(900)
  act.mark('price-drop')
  act.put({ step: 1 })
  await act.wait(1600)
  act.mark('agent-action')
  act.put({ step: 2 })
  await act.wait(1600)
  act.mark('protected')
  act.put({ step: 3 })
}

export function ProtectionStage() {
  return <section className="protection-intro" aria-labelledby="protection-intro-title">
    <div className="protection-intro__copy">
      <span className="protection-intro__eyebrow">HOW PROTECTION WORKS</span>
      <h2 id="protection-intro-title">A price drop. A measured response.</h2>
      <p>When risk reaches your chosen limit, the agent can sell part of the collateral to reduce debt. You review its limits before opening a loan.</p>
      <span className="protection-intro__disclaimer">Illustration · no live position or transaction</span>
    </div>
    <div className="protection-intro__visual" aria-hidden="true">
      <Stage<Scene> width={640} height={340} compact={{ below: 570, width: 358, height: 340 }}
        initial={initial} poster={poster} script={script} play="once" className="protection-stage">
        {(state, _rect, layout) => <Window url="cmdk · Position protection" className="protection-stage__window">
          <div className="protection-stage__body" data-compact={layout === 'compact' || undefined} data-step={state.step}>
            <div className="protection-stage__topline"><span>WETH / USDC</span><span>Morpho · Base</span></div>
            <div className="protection-stage__headline">
              <div><span className="protection-stage__label">ETH price</span><strong>{state.step === 0 ? '$2,500' : '$1,750'}</strong></div>
              <div><span className="protection-stage__label">Loan-to-value</span><strong>{state.step === 1 || state.step === 2 ? '71%' : '50%'}</strong></div>
            </div>
            <div className="protection-stage__scale"><div className="protection-stage__risk" /><span className="protection-stage__marker" /></div>
            <div className="protection-stage__thresholds"><span>Target 50%</span><span>Agent acts at 70%</span><span>Liquidation 86%</span></div>
            <div className="protection-stage__event">
              <span className="protection-stage__event-icon">{state.step === 3 ? '✓' : state.step === 0 ? '○' : '↘'}</span>
              <div><strong>{state.step === 0 ? 'Monitoring your position' : state.step === 1 ? 'Risk threshold reached' : state.step === 2 ? 'Reducing debt' : 'Position back at target'}</strong>
                <span>{state.step === 3 ? 'Debt reduced · LTV 50%' : state.step === 2 ? 'Collateral sale in progress' : state.step === 1 ? 'ETH price fell · LTV 71%' : 'Agent watches your LTV limit'}</span></div>
              <span className="protection-stage__event-status">{state.step === 3 ? 'Complete' : state.step === 2 ? 'Acting' : state.step === 1 ? 'Alert' : 'Watching'}</span>
            </div>
          </div>
        </Window>}
      </Stage>
    </div>
  </section>
}
