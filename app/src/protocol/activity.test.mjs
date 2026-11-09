import test from 'node:test'
import assert from 'node:assert/strict'
import {activityActor} from './activity.ts'
test('executor agent paths are attributed without guessing from transaction sender',()=>{for(const name of ['Reduced','Migrated','Exited','SessionEnded'])assert.equal(activityActor(name,'vault','owner'),'agent')})
test('third party on-behalf repayment is not mislabeled as owner action',()=>{assert.equal(activityActor('Repay','third-party','owner'),'unknown');assert.equal(activityActor('Repay','OWNER','owner'),'user');assert.equal(activityActor('Closed','vault','owner'),'user')})

import {activityAbi,groupActivity} from './activity.ts'
test('vault repayment is decoded and multiple logs stay grouped under one operation',()=>{
 assert.ok(activityAbi.some(item=>item.type==='event'&&item.name==='Repaid'))
 const first={key:'a',vault:'v1',hash:'0x1',name:'Repay'},second={...first,key:'b',name:'Repaid'}
 const result=groupActivity([first,second,first,{...first,key:'c',vault:'v2'}])
 assert.equal(result.length,2);assert.equal(result[0].events.length,2);assert.equal(result[0].primary.name,'Repaid')
 assert.equal(activityActor('Repaid','vault','owner'),'user')
})
