const KEY = 'admin_3d';
export const is3DEnabled = () => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};
export const set3DEnabled = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('admin-3d'));
};
