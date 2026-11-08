import test from 'node:test'
import assert from 'node:assert/strict'
import {activityActor} from './activity.ts'
test('executor agent paths are attributed without guessing from transaction sender',()=>{for(const name of ['Reduced','Migrated','Exited','SessionEnded'])assert.equal(activityActor(name,'vault','owner'),'agent')})
test('third party on-behalf repayment is not mislabeled as owner action',()=>{assert.equal(activityActor('Repay','third-party','owner'),'unknown');assert.equal(activityActor('Repay','OWNER','owner'),'user');assert.equal(activityActor('Closed','vault','owner'),'user')})
