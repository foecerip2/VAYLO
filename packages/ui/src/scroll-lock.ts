let locks=0;
let previous='';
/** Nested chat/photo/action overlays share the same body lock. */
export function lockBodyScroll(){
  if(locks++===0){previous=document.body.style.overflow;document.body.style.overflow='hidden';}
  let released=false;
  return()=>{if(released)return;released=true;if(--locks===0)document.body.style.overflow=previous;};
}
