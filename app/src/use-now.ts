import {useEffect,useState} from 'react'
export function useNow() {
 const [now,setNow]=useState(()=>Date.now()/1000)
 useEffect(()=>{const update=()=>setNow(Date.now()/1000);const timer=window.setInterval(update,1000);document.addEventListener('visibilitychange',update);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',update)}},[])
 return now
}
