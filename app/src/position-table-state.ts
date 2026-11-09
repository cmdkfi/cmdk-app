export type PositionTableRead<Row>={source:string;rows:Row[];errors:string[];time?:number;staleSnapshot:boolean}
export function positionTableRead<Row>(previous:PositionTableRead<Row>|null,source:string,rows:Row[],errors:string[],now:number):PositionTableRead<Row>{
 const same=previous?.source===source
 return {source,rows:errors.length&&same&&previous.rows.length?previous.rows:rows,errors,time:errors.length?same?previous.time:undefined:now,staleSnapshot:errors.length>0}
}
