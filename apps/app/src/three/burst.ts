/** Вспышка частиц на 3D-фоне из любого места интерфейса (без загрузки three в основной бандл). */
export function burst(x = window.innerWidth / 2, y = window.innerHeight / 2) {
  window.dispatchEvent(new CustomEvent('vaylo:burst', { detail: { x, y } }));
}
