/** Real authentication/chunk loading after the short entry animation has ended. */
export function LaunchWait(){
  return <div className="launch-wait" role="status"><div><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeOpacity=".15"/><path d="m20 22 12 22 12-22" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Загружаем приложение…</div></div>;
}
